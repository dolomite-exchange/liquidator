import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import {
  ApiAsyncAction,
  ApiOraclePrice,
  BigNumber as ZapBigNumber,
  DolomiteZap,
  MinimalApiToken,
  ZapOutputParam,
} from '@dolomite-exchange/zap-sdk';
import { ReferralOutput } from '@dolomite-exchange/zap-sdk/dist/src/lib/ApiTypes';
import { ethers } from 'ethers';
import { DateTime } from 'luxon';
import { SOLID_ACCOUNT } from '../clients/dolomite';
import { getAccountRiskOverride } from '../lib/account-risk-override-getter';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam } from '../lib/api-types';
import { ChainId } from '../lib/chain-id';
import { getLiquidationMode, LiquidationMode } from '../lib/liquidation-mode';
import Logger from '../lib/logger';
import { getAmountsForLiquidation, getOwedPriceForLiquidation } from '../lib/utils';
import {
  emitEventFinalizingEvent,
  prepareForLiquidation,
  retryDepositOrWithdrawalAction,
} from './async-liquidations-helper';
import { getLargestBalanceUSD } from './balance-helpers';
import { getGasPriceWei, getRawGasPriceWei, isGasSpikeProtectionEnabled } from './gas-price-helpers';
import { liquidateV6 } from './liquidator-proxy-v6-helper';
import { dolomite } from './web3';

const collateralPreferences: Integer[] = (process.env.COLLATERAL_PREFERENCES ?? '')?.split(',')
  .map((pref) => new BigNumber(pref.trim()));
const owedPreferences: Integer[] = (process.env.OWED_PREFERENCES ?? '')?.split(',')
  .map((pref) => new BigNumber(pref.trim()));

const minValueLiquidatedForGenericSell = new BigNumber(process.env.MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL as string);

const gasSpikeThresholdUsd = new BigNumber(process.env.GAS_SPIKE_THRESHOLD_USD as string);

const NETWORK_ID = Number(process.env.NETWORK_ID);
let oogaBoogaReferralInfo: ReferralOutput | undefined;
if (NETWORK_ID === ChainId.Berachain) {
  oogaBoogaReferralInfo = {
    odosReferralCode: undefined,
    oogaBoogaApiKey: process.env.OOGA_BOOGA_API_KEY,
    referralAddress: undefined,
  };
  if (!oogaBoogaReferralInfo.oogaBoogaApiKey) {
    throw new Error('No API key found for Ooga Booga');
  }
}

const ONE_HOUR = 60 * 60;
const IS_LIQUIDATION = true;
const THIRTY_BASIS_POINTS = 0.003;
const BLOCK_TAG = 'latest';
const USE_PROXY_SERVER = false;
export const zap = new DolomiteZap({
  network: NETWORK_ID,
  subgraphUrl: process.env.SUBGRAPH_URL!,
  web3Provider: new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL, NETWORK_ID),
  cacheSeconds: ONE_HOUR,
  defaultIsLiquidation: IS_LIQUIDATION,
  defaultSlippageTolerance: THIRTY_BASIS_POINTS,
  defaultBlockTag: BLOCK_TAG,
  referralInfo: oogaBoogaReferralInfo,
  useProxyServer: USE_PROXY_SERVER,
  gasMultiplier: new ZapBigNumber(2),
});

if (zap.validAggregators.length === 0) {
  throw new Error('No zap aggregators found!');
}

export async function emitWithdrawalExecuted(action: ApiAsyncAction): Promise<TxResult | undefined> {
  Logger.info({
    at: 'dolomite-helpers#retryAsyncAction',
    message: 'Emitting withdrawal executed for action',
    accountOwner: action.owner,
    accountNumber: action.accountNumber.toFixed(),
    key: action.key,
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

  return emitEventFinalizingEvent(action, converter);
}

export async function emitDepositCancelled(action: ApiAsyncAction): Promise<TxResult | undefined> {
  Logger.info({
    at: 'dolomite-helpers#retryAsyncAction',
    message: 'Emitting deposit cancelled for action',
    accountOwner: action.owner,
    accountNumber: action.accountNumber.toFixed(),
    key: action.key,
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

  return emitEventFinalizingEvent(action, converter);
}

export async function retryAsyncAction(action: ApiAsyncAction): Promise<TxResult | undefined> {
  Logger.info({
    at: 'dolomite-helpers#retryAsyncAction',
    message: 'Starting retry for async action',
    accountOwner: action.owner,
    accountNumber: action.accountNumber.toFixed(),
    key: action.key,
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
  protocolBalanceMap: { [marketId: string]: Integer },
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
      protocolBalanceMap,
      riskParams,
      marginAccountToActionsMap,
      lastBlockTimestamp,
      false,
    );
  } else if (liquidationMode === LiquidationMode.Simple) {
    return _liquidateAccountSimple(liquidAccount, marginAccountToActionsMap, marketMap);
  } else {
    throw new Error(`Unknown liquidation mode: ${liquidationMode}`);
  }
}

export async function liquidateExpiredAccount(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  protocolBalanceMap: { [marketId: string]: Integer },
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
      protocolBalanceMap,
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
  marketMap: { [marketId: string]: ApiMarket },
  owedMarkets: Integer[] = owedPreferences,
  collateralMarkets: Integer[] = collateralPreferences,
  minValueLiquidated: Integer = new BigNumber(process.env.MIN_VALUE_LIQUIDATED as string),
): Promise<TxResult | undefined> {
  if (marginAccountToActionsMap[liquidAccount.id]) {
    return Promise.reject(new Error('_liquidateAccountSimple# Cannot perform simple liquidations on async account'));
  }

  const gasPrice = getGasPriceWei();

  if (isGasSpikeProtectionEnabled()) {
    const { gasEstimate } = await dolomite.liquidatorProxyV1.liquidate(
      SOLID_ACCOUNT.owner,
      SOLID_ACCOUNT.number,
      liquidAccount.owner,
      liquidAccount.number,
      new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION as string),
      minValueLiquidated,
      owedMarkets.map((p) => new BigNumber(p)),
      collateralMarkets.map((p) => new BigNumber(p)),
      {
        gasPrice: gasPrice.toFixed(),
        from: SOLID_ACCOUNT.owner,
        confirmationType: ConfirmationType.Simulate,
      },
    );
    const debtAmountUsd: Integer = owedMarkets.reduce((acc, m) => {
      const amountWei = liquidAccount.balances[m.toFixed()].wei;
      const priceUsd = marketMap[m.toFixed()].oraclePrice;
      return acc.plus(amountWei.times(priceUsd))
    }, INTEGERS.ZERO);

    if (_isGasSpikeFound(gasEstimate, debtAmountUsd, marketMap)) {
      return undefined;
    }

    return dolomite.liquidatorProxyV1.liquidate(
      SOLID_ACCOUNT.owner,
      SOLID_ACCOUNT.number,
      liquidAccount.owner,
      liquidAccount.number,
      new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION as string),
      minValueLiquidated,
      owedMarkets.map((p) => new BigNumber(p)),
      collateralMarkets.map((p) => new BigNumber(p)),
      {
        gas: _convertGasEstimateToGas(gasEstimate!),
        gasPrice: gasPrice.toFixed(),
        from: SOLID_ACCOUNT.owner,
        confirmationType: ConfirmationType.Hash,
      },
    );
  } else {
    return dolomite.liquidatorProxyV1.liquidate(
      SOLID_ACCOUNT.owner,
      SOLID_ACCOUNT.number,
      liquidAccount.owner,
      liquidAccount.number,
      new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION as string),
      minValueLiquidated,
      owedMarkets.map((p) => new BigNumber(p)),
      collateralMarkets.map((p) => new BigNumber(p)),
      {
        gasPrice: gasPrice.toFixed(),
        from: SOLID_ACCOUNT.owner,
        confirmationType: ConfirmationType.Hash,
      },
    );
  }
}

async function _liquidateAccountAndSellWithGenericLiquidity(
  liquidAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  protocolBalanceMap: { [marketId: string]: Integer },
  riskParams: ApiRiskParam,
  marginAccountToActionsMap: Record<string, ApiAsyncAction[] | undefined>,
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): Promise<TxResult | undefined> {
  const riskOverride = getAccountRiskOverride(liquidAccount, riskParams);
  const owedBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    true,
    marketMap,
    protocolBalanceMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const heldBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    false,
    marketMap,
    protocolBalanceMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const owedMarket = marketMap[owedBalance.marketId];
  const heldMarket = marketMap[heldBalance.marketId];
  const owedPriceAdj = getOwedPriceForLiquidation(owedMarket, heldMarket, riskOverride, riskParams);
  const heldProtocolBalance = protocolBalanceMap[heldBalance.marketId] ?? INTEGERS.MAX_UINT;
  const isHeldBalanceLargerThanProtocol = heldBalance.wei.abs().gt(heldProtocolBalance);
  const { owedWei, heldWei, isVaporizable } = getAmountsForLiquidation(
    owedBalance.wei.abs(),
    owedPriceAdj,
    heldBalance.wei.abs(),
    heldMarket.oraclePrice,
    heldProtocolBalance,
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

  const owedValueUsd = owedBalance.wei.abs().times(owedMarket.oraclePrice);
  if (owedValueUsd.isLessThan(minValueLiquidatedForGenericSell)) {
    Logger.info({
      message: 'Skipping generic sell because owed value is too small',
      liquidAccount: liquidAccount.id,
      owedMarketId: owedMarket.marketId,
      heldMarketId: heldMarket.marketId,
      owedBalance: owedBalance.wei.abs().toFixed(),
      heldBalance: heldBalance.wei.abs().toFixed(),
    });

    // TODO: turn this back on when the risk override setter can cope with solid account having no debt
    // const owedMarkets = Object.values(liquidAccount.balances)
    //   .filter(b => b.par.lt(INTEGERS.ZERO))
    //   .map(b => new BigNumber(b.marketId));
    // const heldMarkets = Object.values(liquidAccount.balances)
    //   .filter(b => b.par.gt(INTEGERS.ZERO))
    //   .filter(b => !isIsolationModeMarket(b.marketId))
    //   .map(b => new BigNumber(b.marketId));
    // TODO: check held markets length > 0
    // return _liquidateAccountSimple(
    //   liquidAccount,
    //   marginAccountToActionsMap,
    //   marketMap,
    //   owedMarkets,
    //   heldMarkets,
    // );
    return undefined;
  } else if (
    Object.keys(marketIdToActionsMap).length === 0
    && zap.getIsAsyncAssetByMarketId(new ZapBigNumber(heldMarket.marketId))
  ) {
    Logger.info({
      message: 'Performing async liquidation preparation',
      owedMarketId: owedMarket.marketId,
      heldMarketId: heldMarket.marketId,
      owedBalance: owedBalance.wei.abs().toFixed(),
      heldBalance: heldBalance.wei.abs().toFixed(),
      owedWeiForLiquidation: owedWei.toFixed(),
      heldWeiForLiquidation: heldWei.toFixed(),
      owedPriceAdj: owedPriceAdj.toFixed(),
      heldPrice: heldMarket.oraclePrice.toFixed(),
    });
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
        SOLID_ACCOUNT.owner,
        { isLiquidation: true },
      );
    } else {
      const marketToOracleMap = Object.keys(marketMap).reduce((acc, marketId) => {
        acc[marketId] = {
          oraclePrice: new ZapBigNumber(marketMap[marketId].oraclePrice.toFixed()),
        };
        return acc;
      }, {} as Record<string, ApiOraclePrice>);
      Logger.info({
        message: 'Performing async liquidation...',
        actions: Object.values(marketIdToActionsMap),
      })
      outputs = await zap.getSwapExactAsyncTokensForTokensParamsForLiquidation(
        heldToken,
        new ZapBigNumber(heldWei),
        owedToken,
        new ZapBigNumber(owedWei),
        SOLID_ACCOUNT.owner,
        marketIdToActionsMap,
        marketToOracleMap,
        { isLiquidation: true, isVaporizable },
      );
    }

    const gasPrice = getGasPriceWei();
    const inputAmount = !isHeldBalanceLargerThanProtocol ? INTEGERS.MAX_UINT : heldWei;
    const outputAmount = !isHeldBalanceLargerThanProtocol ? INTEGERS.MAX_UINT : owedWei;

    let firstError: Error | undefined;
    if (isGasSpikeProtectionEnabled()) {
      for (let i = 0; i < outputs.length; i += 1) {
        try {
          const { gasEstimate } = await liquidateV6(
            liquidAccount,
            inputAmount,
            outputs[i],
            outputAmount,
            (isExpiring && owedBalance.expiresAt) ? owedBalance.expiresAt.toNumber() : null,
            {
              gasPrice: gasPrice.toFixed(),
              from: SOLID_ACCOUNT.owner,
              confirmationType: ConfirmationType.Simulate,
            },
          );

          const debtAmountUsd = owedWei.times(owedMarket.oraclePrice);
          if (_isGasSpikeFound(gasEstimate, debtAmountUsd, marketMap)) {
            return undefined;
          }

          return await liquidateV6(
            liquidAccount,
            inputAmount,
            outputs[i],
            outputAmount,
            (isExpiring && owedBalance.expiresAt) ? owedBalance.expiresAt.toNumber() : null,
            {
              gas: _convertGasEstimateToGas(gasEstimate!),
              gasPrice: gasPrice.toFixed(),
              from: SOLID_ACCOUNT.owner,
              confirmationType: ConfirmationType.Hash,
            },
          );
        } catch (e: any) {
          if (!firstError) {
            firstError = e;
          }
        }
      }
    } else {
      for (let i = 0; i < outputs.length; i += 1) {
        try {
          return await liquidateV6(
            liquidAccount,
            INTEGERS.MAX_UINT,
            outputs[i],
            INTEGERS.MAX_UINT,
            (isExpiring && owedBalance.expiresAt) ? owedBalance.expiresAt.toNumber() : null,
            {
              gasPrice: getGasPriceWei().toFixed(),
              from: SOLID_ACCOUNT.owner,
              confirmationType: ConfirmationType.Hash,
            },
          );
        } catch (e: any) {
          if (!firstError) {
            firstError = e;
          }
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
    SOLID_ACCOUNT.owner,
    SOLID_ACCOUNT.number,
    expiredAccount.owner,
    expiredAccount.number,
    new BigNumber(owedBalance.marketId),
    new BigNumber(heldBalance.marketId),
    owedBalance.expiresAt,
    {
      gasPrice: getGasPriceWei().toFixed(),
      from: SOLID_ACCOUNT.owner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}

async function _prepareLiquidationForAsyncMarket(
  liquidAccount: ApiAccount,
  heldMarket: ApiMarket,
  heldBalance: ApiBalance,
  marketMap: Record<string, ApiMarket>,
): Promise<TxResult | undefined> {
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
          message: 'Could not retrieve output market for async liquidation',
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
        SOLID_ACCOUNT.owner,
        {
          isLiquidation: true,
          gasPriceInWei: new ZapBigNumber(getGasPriceWei().toFixed()),
          subAccountNumber: new ZapBigNumber(liquidAccount.number.toFixed()),
          disallowAggregator: true,
          slippageTolerance: 0.06,
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

  const debtAmountUsd: Integer = Object.keys(liquidAccount.balances).reduce((acc, m) => {
    const amountWei = liquidAccount.balances[m].wei;
    if (amountWei.gt(INTEGERS.ZERO)) {
      return acc;
    }

    const priceUsd = marketMap[m].oraclePrice;
    return acc.plus(amountWei.abs().times(priceUsd))
  }, INTEGERS.ZERO);

  const gasPrice = getGasPriceWei();
  if (
    isGasSpikeProtectionEnabled()
    && _isGasSpikeFound(bestZapResult.executionFee.dividedToIntegerBy(gasPrice).toNumber(), debtAmountUsd, marketMap)
  ) {
    return undefined;
  }

  return prepareForLiquidation(
    liquidAccount,
    new BigNumber(heldMarket.marketId),
    heldBalance.wei,
    new BigNumber(bestZapResult.marketIdsPath[bestZapResult.marketIdsPath.length - 1].toFixed()),
    new BigNumber('2'), // can't use 1 because GMX V2 subtracts '1' from the min to get 'half' when checking outputs
    undefined,
    bestZapResult.traderParams[0].tradeData,
    {
      value: bestZapResult.executionFee.toFixed(),
    },
  );
}

function _convertGasEstimateToGas(gasEstimate: number): number {
  return Math.floor(gasEstimate * 1.5);
}

const ONE_DOLLAR = new BigNumber('1000000000000000000000000000000000000');

function _isGasSpikeFound(
  gasEstimate: number | undefined,
  debtAmountUsd: Integer,
  marketMap: { [marketId: string]: ApiMarket },
): boolean {
  if (gasEstimate === undefined) {
    throw new Error('No gas estimate was found! Check that ConfirmationType.Simulate was used!')
  }

  const gasPrice = getRawGasPriceWei();
  const payablePriceUsd: Integer = Object.values(marketMap)
    .find(m => m.tokenAddress.toLowerCase() === dolomite.payableToken.address.toLowerCase())!.oraclePrice;
  const rewardAmountUsd = debtAmountUsd.times('5').dividedToIntegerBy('100');
  const gasPriceUsd = gasPrice.times(gasEstimate).times(payablePriceUsd);
  if (gasPriceUsd.gt(rewardAmountUsd) && gasPriceUsd.gt(gasSpikeThresholdUsd)) {
    Logger.info({
      at: 'dolomite-helpers#_isGasSpikeFound',
      message: 'Skipping liquidation due to gas spike',
      transactionCostUsd: `$${gasPrice.times(gasEstimate).times(payablePriceUsd).div(ONE_DOLLAR).toFixed(6)}`,
      rewardAmountUsd: `$${rewardAmountUsd.div(ONE_DOLLAR).toFixed(6)}`,
    });
    return true;
  }

  Logger.info({
    at: 'dolomite-helpers#_isGasSpikeFound',
    message: 'Gas spike not found',
    transactionCostUsd: `$${gasPrice.times(gasEstimate).times(payablePriceUsd).div(ONE_DOLLAR).toFixed(6)}`,
    rewardAmountUsd: `$${rewardAmountUsd.div(ONE_DOLLAR).toFixed(6)}`,
  });
  return false;
}
