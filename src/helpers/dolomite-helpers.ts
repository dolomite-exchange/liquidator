import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import {
  ApiAsyncAction,
  BigNumber as ZapBigNumber,
  DolomiteZap,
  MinimalApiToken,
  ZapOutputParam,
} from '@dolomite-exchange/zap-sdk';
import { ethers } from 'ethers';
import { DateTime } from 'luxon';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam } from '../lib/api-types';
import { getLiquidationMode, LiquidationMode } from '../lib/liquidation-mode';
import Logger from '../lib/logger';
import { getAmountsForLiquidation, getOwedPriceForLiquidation } from '../lib/utils';
import { prepareForLiquidation, retryDepositOrWithdrawalAction } from './async-liquidations-helper';
import { getLargestBalanceUSD } from './balance-helpers';
import { getGasPriceWei } from './gas-price-helpers';
import { dolomite } from './web3';

const solidAccount = {
  owner: process.env.ACCOUNT_WALLET_ADDRESS as string,
  number: new BigNumber(process.env.DOLOMITE_ACCOUNT_NUMBER as string),
};
const collateralPreferences: Integer[] = (process.env.COLLATERAL_PREFERENCES ?? '')?.split(',')
  .map((pref) => new BigNumber(pref.trim()));
const owedPreferences: Integer[] = (process.env.OWED_PREFERENCES ?? '')?.split(',')
  .map((pref) => new BigNumber(pref.trim()));

const minValueLiquidatedForGenericSell = new BigNumber(process.env.MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL as string);

const NETWORK_ID = Number(process.env.NETWORK_ID);
const ONE_HOUR = 60 * 60;
const IS_LIQUIDATION = true;
const THIRTY_BASIS_POINTS = 0.003;
const BLOCK_TAG = 'latest';
const USE_PROXY_SERVER = false;
const zap = new DolomiteZap({
  network: NETWORK_ID,
  subgraphUrl: process.env.SUBGRAPH_URL!,
  web3Provider: new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL, NETWORK_ID),
  cacheSeconds: ONE_HOUR,
  defaultIsLiquidation: IS_LIQUIDATION,
  defaultSlippageTolerance: THIRTY_BASIS_POINTS,
  defaultBlockTag: BLOCK_TAG,
  referralInfo: undefined,
  useProxyServer: USE_PROXY_SERVER,
  gasMultiplier: new ZapBigNumber(2),
});

export async function retryAsyncAction(action: ApiAsyncAction): Promise<TxResult | undefined> {
  Logger.info({
    at: 'dolomite-helpers#retryAsyncAction',
    message: 'Starting retry for async action',
    accountOwner: action.owner,
    accountNumber: action.accountNumber.toFixed(),
  });

  const converter = zap.getIsolationModeConverterByMarketId(action.inputToken.marketId);
  if (!converter) {
    Logger.error({
      at: 'dolomite-helpers#retryAsyncAction',
      message: 'Could not find converter',
      id: action.id,
      marketId: action.inputToken.marketId.toFixed(),
    });
    return undefined;
  }

  return retryDepositOrWithdrawalAction(action, converter);
}

export async function liquidateAccount(
  liquidAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  balanceMap: { [marketId: string]: Integer },
  riskParams: ApiRiskParam,
  marginAccountToActionsMap: Record<string, ApiAsyncAction[] | undefined>,
  lastBlockTimestamp: DateTime,
): Promise<TxResult | undefined> {
  if (process.env.LIQUIDATIONS_ENABLED !== 'true') {
    return undefined;
  }

  Logger.info({
    at: 'dolomite-helpers#liquidateAccount',
    message: 'Starting account liquidation',
    accountOwner: liquidAccount.owner,
    accountNumber: liquidAccount.number,
  });

  const liquidatable = await dolomite.getters.isAccountLiquidatable(
    liquidAccount.owner,
    new BigNumber(liquidAccount.number),
  );

  if (!liquidatable) {
    Logger.info({
      at: 'dolomite-helpers#liquidateAccount',
      message: 'Account is not liquidatable',
      accountOwner: liquidAccount.owner,
      accountNumber: liquidAccount.number,
    });

    return undefined
  }

  const borrowMarkets: string[] = [];
  const supplyMarkets: string[] = [];

  Object.keys(liquidAccount.balances)
    .forEach((marketId) => {
      const par = new BigNumber(liquidAccount.balances[marketId].par);

      if (par.lt(INTEGERS.ZERO)) {
        borrowMarkets.push(marketId);
      } else if (par.gt(INTEGERS.ZERO)) {
        supplyMarkets.push(marketId);
      }
    });

  if (borrowMarkets.length === 0) {
    return Promise.reject(new Error('Supposedly liquidatable account has no borrows'));
  }

  if (supplyMarkets.length === 0) {
    return Promise.reject(new Error('Supposedly liquidatable account has no supplies'));
  }

  const liquidationMode = getLiquidationMode();
  if (liquidationMode === LiquidationMode.Generic) {
    return _liquidateAccountAndSellWithGenericLiquidity(
      liquidAccount,
      marketMap,
      balanceMap,
      riskParams,
      marginAccountToActionsMap,
      lastBlockTimestamp,
      false,
    );
  } else if (liquidationMode === LiquidationMode.Simple) {
    return _liquidateAccountSimple(liquidAccount, marginAccountToActionsMap);
  } else {
    throw new Error(`Unknown liquidation mode: ${liquidationMode}`);
  }
}

export async function liquidateExpiredAccount(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  balanceMap: { [marketId: string]: Integer },
  riskParams: ApiRiskParam,
  marginAccountToActionsMap: Record<string, ApiAsyncAction[] | undefined>,
  lastBlockTimestamp: DateTime,
) {
  if (process.env.EXPIRATIONS_ENABLED?.toLowerCase() !== 'true') {
    return Promise.reject(new Error('Expirations are not enabled'));
  }

  Logger.info({
    at: 'dolomite-helpers#liquidateExpiredAccount',
    message: 'Starting account expiry liquidation',
    accountOwner: expiredAccount.owner,
    accountNumber: expiredAccount.number,
  });

  const liquidationMode = getLiquidationMode();
  if (liquidationMode === LiquidationMode.Generic) {
    return _liquidateAccountAndSellWithGenericLiquidity(
      expiredAccount,
      marketMap,
      balanceMap,
      riskParams,
      marginAccountToActionsMap,
      lastBlockTimestamp,
      true,
    );
  } else if (liquidationMode === LiquidationMode.Simple) {
    return _liquidateExpiredAccountInternalSimple(
      expiredAccount,
      marketMap,
      marginAccountToActionsMap,
      lastBlockTimestamp,
    );
  } else {
    return Promise.reject(new Error(`Unknown liquidation mode: ${liquidationMode}`))
  }
}

async function _liquidateAccountSimple(
  liquidAccount: ApiAccount,
  marginAccountToActionsMap: Record<string, ApiAsyncAction[] | undefined>,
  owedMarkets: Integer[] = owedPreferences,
  collateralMarkets: Integer[] = collateralPreferences,
  minValueLiquidated: Integer = new BigNumber(process.env.MIN_VALUE_LIQUIDATED as string),
): Promise<TxResult> {
  if (marginAccountToActionsMap[liquidAccount.id]) {
    return Promise.reject(new Error('_liquidateAccountSimple# Cannot perform simple liquidations on async account'));
  }

  const gasPrice = getGasPriceWei();

  return dolomite.liquidatorProxyV1.liquidate(
    solidAccount.owner,
    solidAccount.number,
    liquidAccount.owner,
    liquidAccount.number,
    new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION as string),
    minValueLiquidated,
    owedMarkets.map((p) => new BigNumber(p)),
    collateralMarkets.map((p) => new BigNumber(p)),
    {
      gasPrice: gasPrice.toFixed(),
      from: solidAccount.owner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}

async function _liquidateAccountAndSellWithGenericLiquidity(
  liquidAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  balanceMap: { [marketId: string]: Integer },
  riskParams: ApiRiskParam,
  marginAccountToActionsMap: Record<string, ApiAsyncAction[] | undefined>,
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): Promise<TxResult> {
  const owedBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    true,
    marketMap,
    balanceMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const heldBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    false,
    marketMap,
    balanceMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const owedMarket = marketMap[owedBalance.marketId];
  const heldMarket = marketMap[heldBalance.marketId];
  const owedPriceAdj = getOwedPriceForLiquidation(owedMarket, heldMarket, riskParams);
  const { owedWei, heldWei, isVaporizable } = getAmountsForLiquidation(
    owedBalance.wei.abs(),
    owedPriceAdj,
    heldBalance.wei.abs(),
    heldMarket.oraclePrice,
    balanceMap[heldBalance.marketId] ?? INTEGERS.MAX_UINT,
  );
  /* eslint-disable @typescript-eslint/indent */
  const marketIdToActionsMap = (marginAccountToActionsMap[liquidAccount.id] ?? [])
    .filter(action => {
      return action.inputToken.marketId.eq(heldMarket.marketId)
    })
    .reduce<Record<string, ApiAsyncAction[]>>(
      (memo, action) => {
        const marketId = action.outputToken.marketId.toFixed();
        if (!memo[marketId]) {
          memo[marketId] = [];
        }
        memo[marketId] = memo[marketId].concat(action);
        return memo;
      },
      {},
    );
  /* eslint-enable @typescript-eslint/indent */

  const hasIsolationModeMarket = zap.getIsolationModeConverterByMarketId(new ZapBigNumber(owedMarket.marketId))
    || zap.getIsolationModeConverterByMarketId(new ZapBigNumber(heldMarket.marketId));
  const owedValueUsd = owedBalance.wei.abs().times(owedMarket.oraclePrice);
  if (!hasIsolationModeMarket && owedValueUsd.isLessThan(minValueLiquidatedForGenericSell)) {
    Logger.info({
      message: `Performing simple ${isExpiring ? 'expiration' : 'liquidation'} instead of external sell`,
      owedMarketId: owedMarket.marketId,
      heldMarketId: heldMarket.marketId,
      owedBalance: owedBalance.wei.abs().toFixed(),
      heldBalance: heldBalance.wei.abs().toFixed(),
      owedWeiForLiquidation: owedWei.toFixed(),
      heldWeiForLiquidation: heldWei.toFixed(),
      owedPriceAdj: owedPriceAdj.toFixed(),
      heldPrice: heldMarket.oraclePrice.toFixed(),
    });

    if (isExpiring) {
      return _liquidateExpiredAccountInternalSimple(
        liquidAccount,
        marketMap,
        marginAccountToActionsMap,
        lastBlockTimestamp,
        [new BigNumber(heldBalance.marketId)],
        [new BigNumber(owedBalance.marketId)],
      );
    } else {
      return _liquidateAccountSimple(
        liquidAccount,
        marginAccountToActionsMap,
        [new BigNumber(owedBalance.marketId)],
        [new BigNumber(heldBalance.marketId)],
        INTEGERS.ZERO,
      );
    }
  } else if (
    Object.keys(marketIdToActionsMap).length === 0
    && zap.getIsAsyncAssetByMarketId(new ZapBigNumber(heldMarket.marketId))
  ) {
    return _prepareLiquidationForAsyncMarket(
      liquidAccount,
      heldMarket,
      heldBalance,
      marketMap,
    );
  } else {
    Logger.info({
      message: 'Performing liquidation via generic liquidity',
      owedMarketId: owedMarket.marketId,
      heldMarketId: heldMarket.marketId,
      owedBalance: owedBalance.wei.abs().toFixed(),
      heldBalance: heldBalance.wei.abs().toFixed(),
      owedWeiForLiquidation: owedWei.toFixed(),
      heldWeiForLiquidation: heldWei.toFixed(),
      owedPriceAdj: owedPriceAdj.toFixed(),
      heldPrice: heldMarket.oraclePrice.toFixed(),
    });

    const heldToken: MinimalApiToken = {
      marketId: new ZapBigNumber(heldMarket.marketId),
      symbol: heldMarket.symbol,
    };
    const owedToken: MinimalApiToken = {
      marketId: new ZapBigNumber(owedMarket.marketId),
      symbol: owedMarket.symbol,
    };
    let outputs: ZapOutputParam[];
    if (Object.keys(marketIdToActionsMap).length === 0) {
      outputs = await zap.getSwapExactTokensForTokensParams(
        heldToken,
        new ZapBigNumber(heldWei),
        owedToken,
        new ZapBigNumber(owedWei),
        solidAccount.owner,
        { isLiquidation: true },
      );
    } else {
      const marketToOracleMap = Object.keys(marketMap).reduce((acc, marketId) => {
        acc[marketId] = new ZapBigNumber(marketMap[marketId].oraclePrice.toFixed());
        return acc;
      }, {});
      outputs = await zap.getSwapExactAsyncTokensForTokensParamsForLiquidation(
        heldToken,
        new ZapBigNumber(heldWei),
        owedToken,
        new ZapBigNumber(owedWei),
        solidAccount.owner,
        marketIdToActionsMap,
        marketToOracleMap,
        { isLiquidation: true, isVaporizable },
      );
    }

    let firstError: unknown;
    for (let i = 0; i < outputs.length; i += 1) {
      try {
        return await dolomite.liquidatorProxyV4WithGenericTrader.liquidate(
          solidAccount.owner,
          solidAccount.number,
          liquidAccount.owner,
          liquidAccount.number,
          outputs[i].marketIdsPath.map((p) => new BigNumber(p)),
          INTEGERS.MAX_UINT,
          INTEGERS.MAX_UINT,
          outputs[i].traderParams,
          outputs[i].makerAccounts,
          isExpiring ? (owedBalance.expiresAt ?? null) : null,
          {
            gasPrice: getGasPriceWei().toFixed(),
            from: solidAccount.owner,
            confirmationType: ConfirmationType.Hash,
          },
        );
      } catch (e) {
        if (!firstError) {
          firstError = e;
        }
      }
    }

    return Promise.reject(firstError);
  }
}

async function _liquidateExpiredAccountInternalSimple(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  marginAccountToActionsMap: Record<string, ApiAsyncAction[] | undefined>,
  lastBlockTimestamp: DateTime,
  heldMarketIds: Integer[] = collateralPreferences,
  owedMarketIds: Integer[] = owedPreferences,
): Promise<TxResult> {
  if (marginAccountToActionsMap[expiredAccount.id]) {
    return Promise.reject(new Error('_liquidateAccountSimple# Cannot perform simple expirations on async account'));
  }

  const preferredHeldBalances = heldMarketIds.reduce<ApiBalance[]>((memo, marketId) => {
    const balance = expiredAccount.balances[marketId.toFixed()];
    if (balance.wei.gt(INTEGERS.ZERO)) {
      return [...memo, balance];
    }
    return memo
  }, []);
  const preferredOwedBalances = owedMarketIds.reduce<ApiBalance[]>((memo, marketId) => {
    const balance = expiredAccount.balances[marketId.toFixed()];
    if (balance.expiresAt && balance.expiresAt.lt(lastBlockTimestamp.toSeconds()) && balance.wei.lt(INTEGERS.ZERO)) {
      return [...memo, balance];
    }
    return memo
  }, []);
  const preferredBalances = [...preferredHeldBalances, ...preferredOwedBalances];
  const owedBalance = getLargestBalanceUSD(
    preferredBalances,
    true,
    marketMap,
    {},
    lastBlockTimestamp,
    true,
  );
  const heldBalance = getLargestBalanceUSD(
    preferredBalances,
    false,
    marketMap,
    {},
    lastBlockTimestamp,
    true,
  );

  if (!owedBalance?.expiresAt) {
    throw new Error('Could not find an expired balance');
  }
  if (!heldBalance) {
    throw new Error(`Could not find a held balance: ${JSON.stringify(preferredBalances, null, 2)}`);
  }

  return dolomite.expiryProxy.expire(
    solidAccount.owner,
    solidAccount.number,
    expiredAccount.owner,
    expiredAccount.number,
    new BigNumber(owedBalance.marketId),
    new BigNumber(heldBalance.marketId),
    owedBalance.expiresAt,
    {
      gasPrice: getGasPriceWei().toFixed(),
      from: solidAccount.owner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}

async function _prepareLiquidationForAsyncMarket(
  liquidAccount: ApiAccount,
  heldMarket: ApiMarket,
  heldBalance: ApiBalance,
  marketMap: Record<string, ApiMarket>,
): Promise<TxResult> {
  const outputMarketIds = zap.getAsyncAssetOutputMarketsByMarketId(new ZapBigNumber(heldMarket.marketId));
  if (!outputMarketIds) {
    Logger.error({
      message: `Could not find output markets for ${heldMarket.marketId.toString()}`,
      heldMarket: {
        ...heldMarket,
        oraclePrice: heldMarket.oraclePrice.toFixed(),
      },
    });
    return Promise.reject(new Error(`Could not find output markets for ${heldMarket.marketId.toString()}`));
  }

  const zapResults = await Promise.all(
    outputMarketIds.map(outputMarketId => {
      const outputMarket = marketMap[outputMarketId.toFixed()];
      if (!outputMarket) {
        Logger.error({
          message: 'Could not retrieve oracle prices for async liquidation',
          heldMarket: heldMarket.marketId.toString(),
          outputMarket: outputMarketId.toFixed(),
        })
      }

      const heldToken: MinimalApiToken = {
        marketId: new ZapBigNumber(heldMarket.marketId),
        symbol: heldMarket.symbol,
      };
      const outputToken: MinimalApiToken = {
        marketId: new ZapBigNumber(outputMarket.marketId),
        symbol: outputMarket.symbol,
      };
      return zap.getSwapExactTokensForTokensParams(
        heldToken,
        new ZapBigNumber(heldBalance.wei.toFixed()),
        outputToken,
        new ZapBigNumber('1'),
        solidAccount.owner,
        {
          isLiquidation: true,
          gasPriceInWei: new ZapBigNumber(getGasPriceWei().toFixed()),
          subAccountNumber: new ZapBigNumber(liquidAccount.number.toFixed()),
          disallowAggregator: true,
        },
      );
    }),
  );

  const bestZapResult = zapResults.reduce<ZapOutputParam | undefined>((best, zapResult) => {
    const other = zapResult[0];
    if (!best) {
      return zapResult[0];
    }
    if (!other) {
      return best;
    }

    const bestOutputMarket = marketMap[best.marketIdsPath[best.marketIdsPath.length - 1].toFixed()];
    const otherOutputMarket = marketMap[other.marketIdsPath[other.marketIdsPath.length - 1].toFixed()];
    if (!bestOutputMarket || !otherOutputMarket) {
      return best;
    }

    const bestExpectedOut = best.expectedAmountOut.times(bestOutputMarket.oraclePrice);
    const otherExpectedOut = other.expectedAmountOut.times(otherOutputMarket.oraclePrice);
    return bestExpectedOut.gt(otherExpectedOut) ? best : other;
  }, undefined)

  if (!bestZapResult) {
    const message = `Could not find valid zap for ${heldMarket.marketId.toString()}`;
    Logger.error({
      message,
      heldMarket: {
        ...heldMarket,
        oraclePrice: heldMarket.oraclePrice.toFixed(),
      },
    });
    return Promise.reject(new Error(message));
  } else if (!bestZapResult.executionFee || bestZapResult.executionFee.eq(INTEGERS.ZERO)) {
    const message = `Zap does not have an execution fee for ${heldMarket.marketId.toString()}`;
    Logger.error({
      message,
      heldMarket: {
        ...heldMarket,
        oraclePrice: heldMarket.oraclePrice.toFixed(),
      },
    });
    return Promise.reject(new Error(message));
  } else if (bestZapResult.marketIdsPath.length !== 2) {
    const message = 'Zap markets path must be of length 2';
    Logger.error({
      message,
    });
    return Promise.reject(new Error(message));
  }

  return prepareForLiquidation(
    liquidAccount,
    new BigNumber(heldMarket.marketId),
    heldBalance.wei,
    new BigNumber(bestZapResult.marketIdsPath[bestZapResult.marketIdsPath.length - 1].toFixed()),
    new BigNumber(bestZapResult.amountWeisPath[bestZapResult.marketIdsPath.length - 1].toFixed()),
    undefined,
    bestZapResult.traderParams[0].tradeData,
    {
      value: bestZapResult.executionFee.toFixed(),
    },
  );
}
