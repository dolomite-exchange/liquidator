import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { AccountOperation } from '@dolomite-exchange/dolomite-margin/dist/src/modules/operate/AccountOperation';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { DateTime } from 'luxon';
import { getParaswapSwapCalldataForLiquidation } from '../clients/paraswap';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam } from '../lib/api-types';
import { LIQUIDATION_MODE, LiquidationMode } from '../lib/liquidation-mode';
import Logger from '../lib/logger';
import { getAmountsForLiquidation, getOwedPriceForLiquidation } from '../lib/math-utils';
import { getGasPriceWei } from './gas-price-helpers';
import { dolomite } from './web3';

const solidAccount = {
  owner: process.env.ACCOUNT_WALLET_ADDRESS,
  number: new BigNumber(process.env.DOLOMITE_ACCOUNT_NUMBER),
};
const collateralPreferences: string[] = process.env.COLLATERAL_PREFERENCES?.split(',')
  .map((pref) => pref.trim());
const owedPreferences: string[] = process.env.OWED_PREFERENCES?.split(',')
  .map((pref) => pref.trim());

export function isExpired(
  expiresAt: Integer | null,
  latestBlockTimestamp: DateTime,
): boolean {
  const expiresAtPlusDelay = expiresAt?.plus(process.env.EXPIRED_ACCOUNT_DELAY_SECONDS);
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

  if (LIQUIDATION_MODE === LiquidationMode.SellWithExternalLiquidity) {
    return liquidateAccountInternalAndSellWithExternalLiquidity(
      liquidAccount,
      marketMap,
      riskParams,
      lastBlockTimestamp,
      false,
    );
  } else if (LIQUIDATION_MODE === LiquidationMode.SellWithInternalLiquidity) {
    return liquidateAccountInternalAndSellWithInternalLiquidity(liquidAccount, marketMap, lastBlockTimestamp, false);
  } else if (LIQUIDATION_MODE === LiquidationMode.Simple) {
    return liquidateAccountInternal(liquidAccount);
  } else {
    throw new Error(`Unknown liquidation mode: ${LIQUIDATION_MODE}`);
  }
}

async function liquidateAccountInternal(
  liquidAccount: ApiAccount,
): Promise<TxResult> {
  const gasPrice = getGasPriceWei();

  return dolomite.liquidatorProxyV1.liquidate(
    solidAccount.owner,
    solidAccount.number,
    liquidAccount.owner,
    liquidAccount.number,
    new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION),
    new BigNumber(process.env.MIN_OVERHEAD_VALUE),
    owedPreferences.map((p) => new BigNumber(p)),
    collateralPreferences.map((p) => new BigNumber(p)),
    {
      gasPrice: gasPrice.toFixed(),
      from: solidAccount.owner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}

export async function liquidateExpiredAccount(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  riskParams: ApiRiskParam,
  lastBlockTimestamp: DateTime,
) {
  if (process.env.EXPIRATIONS_ENABLED.toLowerCase() !== 'true') {
    return false;
  }

  Logger.info({
    at: 'dolomite-helpers#liquidateExpiredAccount',
    message: 'Starting account expiry liquidation',
    accountOwner: expiredAccount.owner,
    accountNumber: expiredAccount.number,
  });

  if (LIQUIDATION_MODE === LiquidationMode.SellWithExternalLiquidity) {
    return liquidateAccountInternalAndSellWithExternalLiquidity(
      expiredAccount,
      marketMap,
      riskParams,
      lastBlockTimestamp,
      true,
    );
  } else if (LIQUIDATION_MODE === LiquidationMode.SellWithInternalLiquidity) {
    return liquidateAccountInternalAndSellWithInternalLiquidity(expiredAccount, marketMap, lastBlockTimestamp, true);
  } else if (LIQUIDATION_MODE === LiquidationMode.Simple) {
    return liquidateExpiredAccountInternalSimple(expiredAccount, marketMap, lastBlockTimestamp);
  } else {
    throw new Error(`Unknown liquidation mode: ${LIQUIDATION_MODE}`);
  }
}

async function liquidateAccountInternalAndSellWithExternalLiquidity(
  liquidAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  riskParams: ApiRiskParam,
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): Promise<TxResult> {
  const owedBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    true,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const heldBalance = getLargestBalanceUSD(
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
  Logger.info({
    message: 'Performing liquidation via external liquidity',
    owedBalance: owedBalance.wei.abs().toFixed(),
    heldBalance: heldBalance.wei.abs().toFixed(),
    owedWeiForLiquidation: owedWei.toFixed(),
    heldWeiForLiquidation: heldWei.toFixed(),
    owedPriceAdj: owedPriceAdj.toFixed(),
    heldPrice: heldMarket.oraclePrice.toFixed(),
  });
  const paraswapCallData = await getParaswapSwapCalldataForLiquidation(
    heldMarket,
    heldWei,
    owedMarket,
    owedWei,
    solidAccount.owner,
    dolomite.liquidatorProxyV2WithExternalLiquidity.address,
  );

  return dolomite.liquidatorProxyV2WithExternalLiquidity.liquidate(
    solidAccount.owner,
    solidAccount.number,
    liquidAccount.owner,
    liquidAccount.number,
    new BigNumber(owedBalance.marketId),
    new BigNumber(heldBalance.marketId),
    isExpiring ? (owedBalance.expiresAt ?? null) : null,
    paraswapCallData,
    {
      gasPrice: getGasPriceWei().toFixed(),
      from: solidAccount.owner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}

async function liquidateAccountInternalAndSellWithInternalLiquidity(
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

  const bridgeAddress = process.env.BRIDGE_TOKEN_ADDRESS.toLowerCase();
  const owedBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    true,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );
  const heldBalance = getLargestBalanceUSD(
    Object.values(liquidAccount.balances),
    false,
    marketMap,
    lastBlockTimestamp,
    isExpiring,
  );

  const owedToken = owedBalance.tokenAddress.toLowerCase();
  const heldToken = heldBalance.tokenAddress.toLowerCase();

  let tokenPath: string[];
  if (owedToken === bridgeAddress || heldToken === bridgeAddress) {
    tokenPath = [heldBalance.tokenAddress, owedBalance.tokenAddress];
  } else {
    tokenPath = [heldBalance.tokenAddress, bridgeAddress, owedBalance.tokenAddress];
  }

  const minOwedOutputDiscount = new BigNumber(process.env.MIN_OWED_OUTPUT_AMOUNT_DISCOUNT);
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

async function liquidateExpiredAccountInternalSimple(
  expiredAccount: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  lastBlockTimestamp: DateTime,
) {
  const expiredMarkets: string[] = [];
  const operation = dolomite.operation.initiate();

  const weis: { [marketId: string]: Integer } = {};
  const prices: { [marketId: string]: Integer } = {};
  const liquidationRewardPremiums: { [marketId: string]: Integer } = {};
  const collateralPreferencesBN = collateralPreferences.map((p) => new BigNumber(p));

  for (let i = 0; i < collateralPreferences.length; i += 1) {
    const marketId = collateralPreferences[i];
    const balance = expiredAccount.balances[marketId];

    if (!balance) {
      weis[marketId] = INTEGERS.ZERO;
    } else {
      weis[marketId] = new BigNumber(balance.wei);
    }

    const market = marketMap[marketId];
    if (!market) {
      throw new Error(`Could not find API market with ID ${marketId}`);
    }

    prices[marketId] = market.oraclePrice;
    liquidationRewardPremiums[marketId] = market.liquidationRewardPremium;
  }

  Object.keys(expiredAccount.balances)
    .forEach((marketId) => {
      const balance = expiredAccount.balances[marketId];

      // 0 indicates the balance never expires
      if (!balance.expiresAt || balance.expiresAt.eq(0)) {
        return;
      }

      // Can't expire positive balances
      if (!new BigNumber(balance.par).isNegative()) {
        return;
      }

      const expiryTimestamp = balance.expiresAt;
      const lastBlockTimestampBN = new BigNumber(Math.floor(lastBlockTimestamp.toMillis() / 1000));
      const delayHasPassed = expiryTimestamp.plus(process.env.EXPIRED_ACCOUNT_DELAY_SECONDS)
        .lte(lastBlockTimestampBN);

      if (delayHasPassed) {
        expiredMarkets.push(marketId);
        operation.fullyLiquidateExpiredAccount(
          solidAccount.owner,
          solidAccount.number,
          expiredAccount.owner,
          expiredAccount.number,
          new BigNumber(marketId),
          expiryTimestamp,
          lastBlockTimestampBN,
          weis,
          prices,
          liquidationRewardPremiums,
          collateralPreferencesBN,
        );
      }
    });

  if (expiredMarkets.length === 0) {
    throw new Error('Supposedly expirable account has no expirable balances');
  }

  return commitLiquidation(expiredAccount, operation);
}

async function commitLiquidation(
  liquidAccount: ApiAccount,
  operation: AccountOperation,
): Promise<boolean> {
  const gasPrice = getGasPriceWei();

  Logger.info({
    at: 'dolomite-helpers#commitLiquidation',
    message: 'Sending account liquidation transaction',
    accountOwner: liquidAccount.owner,
    accountNumber: liquidAccount.number,
    gasPrice,
    from: solidAccount,
  });

  const response = await operation.commit({
    gasPrice: gasPrice.toFixed(),
    from: solidAccount.owner,
    confirmationType: ConfirmationType.Hash,
  });

  if (!response) {
    Logger.info({
      at: 'dolomite-helpers#commitLiquidation',
      message: 'Liquidation transaction has already been received',
      accountOwner: liquidAccount.owner,
      accountNumber: liquidAccount.number,
    });

    return false;
  }

  Logger.info({
    at: 'dolomite-helpers#commitLiquidation',
    message: 'Successfully submitted liquidation transaction',
    accountOwner: liquidAccount.owner,
    accountNumber: liquidAccount.number,
    response,
  });

  return !!response;
}

function getLargestBalanceUSD(
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
    .sort((a, b) => balanceUSDSorterDesc(a, b, marketMap))[0]
}

function balanceUSDSorterDesc(
  balance1: ApiBalance,
  balance2: ApiBalance,
  marketMap: { [marketId: string]: ApiMarket },
): number {
  const market1 = marketMap[balance1.marketId];
  const market2 = marketMap[balance1.marketId];
  const balanceUSD1 = balance1.wei.abs().times(market1.oraclePrice);
  const balanceUSD2 = balance2.wei.abs().times(market2.oraclePrice);
  return balanceUSD1.gt(balanceUSD2) ? -1 : 1;
}
