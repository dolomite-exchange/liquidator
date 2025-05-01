import {
  AmountDenomination,
  AmountReference,
  BigNumber,
  ConfirmationType,
  Decimal,
} from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import v8 from 'v8';
import { getDolomiteRiskParams } from '../src/clients/dolomite';
import { getGasPriceWei, updateGasPrice } from '../src/helpers/gas-price-helpers';
import { dolomite, loadAccounts } from '../src/helpers/web3';
import { getAccountRiskOverride } from '../src/lib/account-risk-override-getter';
import { ApiAccount, ApiBalance } from '../src/lib/api-types';
import '../src/lib/env';
import { ChainId } from '../src/lib/chain-id';
import Logger from '../src/lib/logger';
import { DECIMAL_BASE, isCollateralized } from '../src/lib/utils';
import AccountStore from '../src/stores/account-store';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';

const SMALL_BORROW_THRESHOLD = new BigNumber('10.00');

const TEN = new BigNumber('10');

const TICKERS_TO_IGNORE = ['djUSDC'];

const MARGIN_PREMIUM_BASE = new BigNumber('1000000000000000000');
const MARGIN_PREMIUM_SPECULATIVE: BigNumber | undefined = undefined;
// const MARGIN_PREMIUM_SPECULATIVE = new BigNumber('86956521739130434'); // 125% collateralization
// const MARGIN_PREMIUM_SPECULATIVE = new BigNumber('156521739130434782'); // 133% collateralization
// const MARGIN_PREMIUM_SPECULATIVE = new BigNumber('304347826086956521'); // 150% collateralization

const ONE_DOLLAR = new BigNumber(10).pow(36);

const NETWORK_TO_PRICE_OVERRIDE_MAP: Record<ChainId, Record<string, Decimal | undefined>> = {
  [ChainId.ArbitrumOne]: {},
  [ChainId.Base]: {},
  [ChainId.Berachain]: {
    // 1: new BigNumber('6'), // BERA
  },
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
}

function formatApiBalance(balance: ApiBalance): string {
  return `${balance.wei.div(TEN.pow(balance.tokenDecimals)).toFormat(6)} ${balance.tokenSymbol}`;
}

function shouldIgnoreAccount(account: ApiAccount): boolean {
  return Object.values(account.balances).some(b => TICKERS_TO_IGNORE.includes(b.tokenSymbol));
}

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore);
  const accountStore = new AccountStore(blockStore, marketStore);

  await blockStore._update();

  const blockNumber = blockStore.getBlockNumber()!;
  const { riskParams } = await getDolomiteRiskParams(blockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (riskParams.dolomiteMargin !== libraryDolomiteMargin) {
    const message = `Invalid dolomite margin address found!\n
    { network: ${riskParams.dolomiteMargin} library: ${libraryDolomiteMargin} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignoredMarkets: process.env.IGNORED_MARKETS?.split(',').map(m => parseInt(m, 10)) ?? [],
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();
  await accountStore._update();
  await updateGasPrice(dolomite);

  Logger.info({
    message: 'Finished updating accounts and markets',
  });

  const marketMap = marketStore.getMarketMap();

  // These accounts are not actually liquidatable, but rather accounts that have ANY debt.
  const accounts = accountStore.getLiquidatableDolomiteAccounts();

  let smallLiquidBorrowCount = 0;
  let smallLiquidDebtAmount = INTEGERS.ZERO;
  const liquidAccounts: (ApiAccount & { borrowUSD: Decimal; supplyUSD: Decimal })[] = [];
  const allAccounts: (ApiAccount & { borrowUSD: Decimal; supplyUSD: Decimal })[] = [];
  const totalAccountsWithBadDebt = [] as (ApiAccount & { borrow: BigNumber; supply: BigNumber; })[];
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const riskOverride = getAccountRiskOverride(account, riskParams);
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
      borrowAdj: INTEGERS.ZERO,
      supplyAdj: INTEGERS.ZERO,
    };
    const {
      supply,
      borrow,
      supplyAdj,
      borrowAdj,
    } = Object.values(account.balances)
      .reduce((acc, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const priceMultiplier = new BigNumber(10).pow(36 - balance.tokenDecimals);
        const priceOverrideRaw = NETWORK_TO_PRICE_OVERRIDE_MAP[networkId as ChainId][market.marketId];
        const priceOverride = priceOverrideRaw ? new BigNumber(priceOverrideRaw).times(priceMultiplier) : undefined;
        const value = balance.wei.times(priceOverride ?? market.oraclePrice).div(ONE_DOLLAR);
        const adjust = riskOverride
          ? MARGIN_PREMIUM_BASE
          : MARGIN_PREMIUM_BASE.plus(MARGIN_PREMIUM_SPECULATIVE ?? market.marginPremium);
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          acc.borrow = acc.borrow.plus(value.abs());
          acc.borrowAdj = acc.borrowAdj.plus(value.abs().times(adjust).div(MARGIN_PREMIUM_BASE));
        } else {
          // decrease the supply size by the premium
          acc.supply = acc.supply.plus(value);
          acc.supplyAdj = acc.supplyAdj.plus(value.times(MARGIN_PREMIUM_BASE).div(adjust));
        }
        return acc;
      }, initial);

    if (supply.gt(INTEGERS.ZERO)) {
      allAccounts.push({
        ...account,
        supplyUSD: supply,
        borrowUSD: borrow,
      });
    }

    const marginRatio = (riskOverride?.marginRatioOverride ?? riskParams.liquidationRatio).div(DECIMAL_BASE);
    if (borrow.gt(supply)) {
      if (borrow.gt(SMALL_BORROW_THRESHOLD)) {
        Logger.warn({
          message: `Found bad debt for more than $${SMALL_BORROW_THRESHOLD.toFormat(2)}`,
          account: account.id,
          markets: Object.values(account.balances).map(b => [b.marketId.toFixed(), b.wei.toFixed()]),
          supplyUSD: supply.toFormat(6),
          borrowUSD: borrow.toFormat(6),
        });

        if (process.env.VAPORIZE_EXCESS === 'true') {
          await loadAccounts();
          const vaporMarket = Object.values(account.balances).find(b => b.wei.lt(INTEGERS.ZERO));
          const txResult = await dolomite.operation.initiate()
            .vaporize({
              primaryAccountOwner: dolomite.getDefaultAccount(),
              primaryAccountId: INTEGERS.ZERO,
              vaporAccountOwner: account.owner,
              vaporAccountId: account.number,
              vaporMarketId: new BigNumber(vaporMarket!.marketId),
              payoutMarketId: new BigNumber(vaporMarket!.marketId !== 0 ? 0 : 2),
              amount: {
                value: INTEGERS.ZERO,
                denomination: AmountDenomination.Principal,
                reference: AmountReference.Target,
              },
            })
            .commit({
              gasPrice: getGasPriceWei().toFixed(),
              confirmationType: ConfirmationType.Hash,
            });

          Logger.info({
            message: 'Vaporization transaction hash:',
            transactionHash: txResult.transactionHash,
          });

          await sleep(3_000);
        }
      }

      totalAccountsWithBadDebt.push({
        ...account,
        borrow,
        supply,
      });
    } else if (!isCollateralized(account, marketMap, riskParams) && !shouldIgnoreAccount(account)) {
      if (borrowAdj.lt(SMALL_BORROW_THRESHOLD)) {
        smallLiquidBorrowCount += 1;
        smallLiquidDebtAmount = smallLiquidDebtAmount.plus(borrow);
      } else {
        liquidAccounts.push({
          ...account,
          supplyUSD: supply,
          borrowUSD: borrow,
        });
      }
    } else if (borrowAdj.times(marginRatio).times(1.01).gt(supplyAdj) && !shouldIgnoreAccount(account)) {
      if (borrow.gt(SMALL_BORROW_THRESHOLD)) {
        const extraData = riskOverride ? {} : {
          supplyAdj: supplyAdj.toFormat(6),
          borrowAdj: borrowAdj.toFormat(6),
        };
        Logger.info({
          message: 'Found almost liquid account!',
          account: account.id,
          markets: Object.values(account.balances).map(formatApiBalance),
          supplyUSD: supply.toFormat(6),
          borrowUSD: borrow.toFormat(6),
          ...extraData,
        });
      }
    }
  }

  function computeAverageAndFormat<T>(values: T[], getter: (t: T) => Decimal): string {
    return values.reduce((acc, b) => acc.plus(getter(b)), INTEGERS.ZERO)
      .div(values.length)
      .toFormat(2);
  }

  allAccounts.sort((a, b) => (a.borrowUSD.gt(b.borrowUSD) ? 1 : -1));
  Logger.info({
    message: 'Stats on accounts with debt',
    medianAccountDebt: `$${allAccounts[Math.floor(allAccounts.length / 2)].borrowUSD.toFormat(4)}`,
    biggestAccountDebt: `$${allAccounts[allAccounts.length - 1].borrowUSD.toFormat(2)}`,
    averageAccountDebt: `$${computeAverageAndFormat(allAccounts, a => a.borrowUSD)}`,
  });

  allAccounts.sort((a, b) => (a.supplyUSD.gt(b.supplyUSD) ? 1 : -1));
  Logger.info({
    message: 'Stats on accounts with supply',
    medianAccountSupply: `$${allAccounts[Math.floor(allAccounts.length / 2)].supplyUSD.toFormat(4)}`,
    biggestAccountSupply: `$${allAccounts[allAccounts.length - 1].supplyUSD.toFormat(2)}`,
    averageAccountSupply: `$${computeAverageAndFormat(allAccounts, a => a.supplyUSD)}`,
  });

  liquidAccounts.sort((a, b) => (a.borrowUSD.lt(b.borrowUSD) ? 1 : -1)).forEach(account => {
    Logger.warn({
      message: 'Found liquid account!',
      account: account.id,
      markets: Object.values(account.balances).map(formatApiBalance),
      supplyUSD: `$${account.supplyUSD.toFormat(66)}`,
      borrowUSD: `$${account.borrowUSD.toFormat(66)}`,
    });
  });

  const totalAccountDebt = accounts.reduce((acc, account) => {
    const totalBorrowUsd = Object.values(account.balances).reduce((memo, balance) => {
      if (balance.wei.gte(INTEGERS.ZERO)) {
        return memo;
      }
      const market = marketMap[balance.marketId.toString()];
      return memo.plus(balance.wei.times(market.oraclePrice).div(ONE_DOLLAR).abs());
    }, INTEGERS.ZERO);
    return acc.plus(totalBorrowUsd);
  }, INTEGERS.ZERO).toNumber();

  const debtCountFormatted = accounts.length.toLocaleString(undefined, { useGrouping: true });
  Logger.info({
    message: `Found ${debtCountFormatted} accounts with debt`,
    debtCount: debtCountFormatted,
    debtAmount: `$${formatNumber(totalAccountDebt)}`,
  });

  const totalLiquidDebtAmount = liquidAccounts.reduce((acc, b) => acc.plus(b.borrowUSD), INTEGERS.ZERO).toNumber();
  Logger.info({
    message: `Found ${liquidAccounts.length} regular liquidatable accounts`,
    liquidCount: liquidAccounts.length,
    debtAmount: `$${formatNumber(totalLiquidDebtAmount)}`,
  });

  Logger.info({
    message: `Found ${smallLiquidBorrowCount} small liquidatable accounts`,
    smallBorrowThreshold: `$${SMALL_BORROW_THRESHOLD.toFormat(4)}`,
    liquidCount: smallLiquidBorrowCount,
    debtAmount: `$${formatNumber(smallLiquidDebtAmount.toNumber())}`,
  });

  if (totalAccountsWithBadDebt.length === 0) {
    Logger.info({
      message: `No bad debt found across ${accounts.length} active margin accounts!`,
    });
  } else {
    const totalBadDebt = totalAccountsWithBadDebt.reduce(
      (memo, account) => memo.plus(account.supply.minus(account.borrow)),
      INTEGERS.ZERO,
    ).abs().toNumber();
    Logger.info({
      accountsWithBadDebtLength: totalAccountsWithBadDebt.length,
      totalBadDebt: `$${formatNumber(totalBadDebt)}`,
    });
  }

  return true;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
