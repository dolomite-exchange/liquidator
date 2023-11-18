import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { BigNumber as ZapBigNumber, DolomiteZap, MinimalApiToken } from '@dolomite-exchange/zap-sdk';
import { ethers } from 'ethers';
import { DateTime } from 'luxon';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam } from '../lib/api-types';
import { getLiquidationMode, LiquidationMode } from '../lib/liquidation-mode';
import Logger from '../lib/logger';
import { getAmountsForLiquidation, getOwedPriceForLiquidation } from '../lib/math-utils';
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

const minValueLiquidatedForExternalSell = new BigNumber(process.env.MIN_VALUE_LIQUIDATED_FOR_EXTERNAL_SELL as string);

const NETWORK_ID = Number(process.env.NETWORK_ID);
const ONE_HOUR = 60 * 60;
const IS_LIQUIDATION = true;
const THIRTY_BASIS_POINTS = 0.003;
const BLOCK_TAG = 'latest';
const USE_PROXY_SERVER = false;
const zap = new DolomiteZap(
  NETWORK_ID,
  process.env.SUBGRAPH_URL!,
  new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL, NETWORK_ID),
  ONE_HOUR,
  IS_LIQUIDATION,
  THIRTY_BASIS_POINTS,
  BLOCK_TAG,
  undefined,
  USE_PROXY_SERVER,
);

export function isExpired(
  expiresAt: Integer | null,
  latestBlockTimestamp: DateTime,
): boolean {
  const expiresAtPlusDelay = expiresAt?.plus(process.env.EXPIRED_ACCOUNT_DELAY_SECONDS as string);
  return expiresAtPlusDelay?.lt(latestBlockTimestamp.toSeconds()) ?? false;
}

export async function liquidateAccount(
  liquidAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  riskParams: ApiRiskParam,
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

    return undefined;
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
    return Promise.reject(new Error('Supposedly liquidatable account has no collateral'));
  }

  const liquidationMode = getLiquidationMode();
  if (liquidationMode === LiquidationMode.Generic) {
    return _liquidateAccountAndSellWithGenericLiquidity(
      liquidAccount,
      marketMap,
      riskParams,
      lastBlockTimestamp,
      false,
    );
  } else if (liquidationMode === LiquidationMode.SellWithInternalLiquidity) {
    return _liquidateAccountAndSellWithInternalLiquidity(liquidAccount, marketMap, lastBlockTimestamp, false);
  } else if (liquidationMode === LiquidationMode.Simple) {
    return _liquidateAccountSimple(liquidAccount);
  } else {
    throw new Error(`Unknown liquidation mode: ${liquidationMode}`);
  }
}

export async function liquidateExpiredAccount(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  riskParams: ApiRiskParam,
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
      riskParams,
      lastBlockTimestamp,
      true,
    );
  } else if (liquidationMode === LiquidationMode.SellWithInternalLiquidity) {
    return _liquidateAccountAndSellWithInternalLiquidity(expiredAccount, marketMap, lastBlockTimestamp, true);
  } else if (liquidationMode === LiquidationMode.Simple) {
    return _liquidateExpiredAccountInternalSimple(expiredAccount, marketMap, lastBlockTimestamp);
  } else {
    return Promise.reject(new Error(`Unknown liquidation mode: ${liquidationMode}`))
  }
}

async function _liquidateAccountSimple(
  liquidAccount: ApiAccount,
  owedMarkets: Integer[] = owedPreferences,
  collateralMarkets: Integer[] = collateralPreferences,
  minValueLiquidated: Integer = new BigNumber(process.env.MIN_VALUE_LIQUIDATED as string),
): Promise<TxResult> {
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
  riskParams: ApiRiskParam,
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): Promise<TxResult> {
  const owedBalance = _getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    true,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const heldBalance = _getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    false,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const owedMarket = marketMap[owedBalance.marketId];
  const heldMarket = marketMap[heldBalance.marketId];
  const owedPriceAdj = getOwedPriceForLiquidation(owedMarket, heldMarket, riskParams);
  const { owedWei, heldWei } = getAmountsForLiquidation(
    owedBalance.wei.abs(),
    owedPriceAdj,
    heldBalance.wei.abs(),
    heldMarket.oraclePrice,
  );

  const hasIsolationModeMarket = zap.getIsolationModeConverterByMarketId(new ZapBigNumber(owedMarket.marketId))
    || zap.getIsolationModeConverterByMarketId(new ZapBigNumber(heldMarket.marketId));
  if (!hasIsolationModeMarket && owedBalance.wei.abs()
    .times(owedMarket.oraclePrice)
    .isLessThan(minValueLiquidatedForExternalSell)) {
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
        lastBlockTimestamp,
        [new BigNumber(heldBalance.marketId)],
        [new BigNumber(owedBalance.marketId)],
      );
    } else {
      return _liquidateAccountSimple(
        liquidAccount,
        [new BigNumber(owedBalance.marketId)],
        [new BigNumber(heldBalance.marketId)],
        INTEGERS.ZERO,
      );
    }
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
    const outputs = await zap.getSwapExactTokensForTokensParams(
      heldToken,
      new ZapBigNumber(heldWei),
      owedToken,
      new ZapBigNumber(owedWei),
      solidAccount.owner,
    );

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

async function _liquidateAccountAndSellWithInternalLiquidity(
  liquidAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): Promise<TxResult> {
  if (!process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL) {
    const message = 'REVERT_ON_FAIL_TO_SELL_COLLATERAL is not provided';
    Logger.error({
      at: 'dolomite-helpers#liquidateAccountInternalAndSellCollateral',
      message,
    });
    process.exit(-1);
    return Promise.reject(new Error(message));
  }

  const owedBalance = _getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    true,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const heldBalance = _getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    false,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );

  const owedToken = owedBalance.tokenAddress.toLowerCase();
  const heldToken = heldBalance.tokenAddress.toLowerCase();

  let tokenPath: string[];
  const bridgeAddress = (process.env.BRIDGE_TOKEN_ADDRESS as string).toLowerCase();
  if (owedToken === bridgeAddress || heldToken === bridgeAddress) {
    tokenPath = [heldBalance.tokenAddress, owedBalance.tokenAddress];
  } else {
    tokenPath = [heldBalance.tokenAddress, bridgeAddress, owedBalance.tokenAddress];
  }

  const minOwedOutputDiscount = new BigNumber(process.env.MIN_OWED_OUTPUT_AMOUNT_DISCOUNT as string);
  if (minOwedOutputDiscount.gte(INTEGERS.ONE)) {
    return Promise.reject(new Error('MIN_OWED_OUTPUT_AMOUNT_DISCOUNT must be less than 1.00'));
  } else if (minOwedOutputDiscount.lt(INTEGERS.ZERO)) {
    return Promise.reject(new Error('MIN_OWED_OUTPUT_AMOUNT_DISCOUNT must be greater than or equal to 0'));
  }

  const minOwedOutputAmount = owedBalance.wei.abs()
    .times(INTEGERS.ONE.minus(minOwedOutputDiscount))
    .integerValue(BigNumber.ROUND_FLOOR);
  const revertOnFailToSellCollateral = process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL.toLowerCase() === 'true';

  const gasPrice = getGasPriceWei();

  return dolomite.liquidatorProxyV1WithAmm.liquidate(
    solidAccount.owner,
    solidAccount.number,
    liquidAccount.owner,
    liquidAccount.number,
    new BigNumber(owedBalance.marketId),
    new BigNumber(heldBalance.marketId),
    tokenPath,
    isExpiring ? (owedBalance.expiresAt ?? null) : null,
    minOwedOutputAmount,
    revertOnFailToSellCollateral,
    {
      gasPrice: gasPrice.toFixed(),
      from: solidAccount.owner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}

async function _liquidateExpiredAccountInternalSimple(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  lastBlockTimestamp: DateTime,
  heldMarketIds: Integer[] = collateralPreferences,
  owedMarketIds: Integer[] = owedPreferences,
): Promise<TxResult> {
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
  const owedBalance = _getLargestBalanceUSD(
    preferredBalances,
    true,
    marketMap,
    lastBlockTimestamp,
    true,
  );
  const heldBalance = _getLargestBalanceUSD(
    preferredBalances,
    false,
    marketMap,
    lastBlockTimestamp,
    true,
  );

  if (!owedBalance?.expiresAt) {
    throw new Error('Could not find an expired balance');
  }
  if (!heldBalance) {
    throw new Error('Could not find a held balance: ' + JSON.stringify(preferredBalances, null, 2));
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

export function _getLargestBalanceUSD(
  balances: ApiBalance[],
  isOwed: boolean,
  marketMap: { [marketId: string]: ApiMarket },
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): ApiBalance {
  return balances
    .filter(balance => {
      if (isOwed) {
        if (isExpiring) {
          // Return any market that has expired and is borrowed (negative)
          return isExpired(balance.expiresAt, lastBlockTimestamp) && balance.wei.lt('0');
        } else {
          return balance.wei.lt('0');
        }
      } else {
        return balance.wei.gte('0');
      }
    })
    .sort((a, b) => _balanceUSDSorterDesc(a, b, marketMap))[0]
}

function _balanceUSDSorterDesc(
  balance1: ApiBalance,
  balance2: ApiBalance,
  marketMap: { [marketId: string]: ApiMarket },
): number {
  const market1 = marketMap[balance1.marketId];
  const market2 = marketMap[balance2.marketId];
  const balanceUSD1 = balance1.wei.abs().times(market1.oraclePrice);
  const balanceUSD2 = balance2.wei.abs().times(market2.oraclePrice);
  return balanceUSD1.gt(balanceUSD2) ? -1 : 1;
}
