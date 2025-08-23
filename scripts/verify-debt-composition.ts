import { BigNumber, Decimal, Integer } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import v8 from 'v8';
import {
  getDolomiteRiskParams,
  getLiquidatableDolomiteAccountsWithCertainBorrowAsset,
  getLiquidatableDolomiteAccountsWithCertainSupplyAsset,
} from '../src/clients/dolomite';
import { updateGasPrice } from '../src/helpers/gas-price-helpers';
import { dolomite } from '../src/helpers/web3';
import { ApiAccount, ApiBalance, ApiMarket } from '../src/lib/api-types';
import '../src/lib/env';
import { ChainId } from '../src/lib/chain-id';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import AccountStore from '../src/stores/account-store';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';
import { writeFileSync } from 'node:fs';

const LARGE_AMOUNT_THRESHOLD_USD = new BigNumber(`${100_000}`);
// const LARGE_AMOUNT_THRESHOLD_USD = new BigNumber(`${0}`);

const TEN = new BigNumber('10');

const MARGIN_PREMIUM_BASE = new BigNumber('1000000000000000000');
const MARGIN_PREMIUM_SPECULATIVE: BigNumber | undefined = undefined;

const ONE_DOLLAR = new BigNumber(10).pow(36);

interface TransformedApiBalance extends ApiBalance {
  amountUsd: Decimal;
}

interface TransformedApiAccount extends ApiAccount {
  borrowUSD: Decimal;
  supplyUSD: Decimal;
  balances: Record<string, TransformedApiBalance>;
}

const NETWORK_TO_PRICE_OVERRIDE_MAP: Record<ChainId, Record<string, Decimal | undefined>> = {
  [ChainId.ArbitrumOne]: {},
  [ChainId.Base]: {},
  [ChainId.Berachain]: {},
  [ChainId.Botanix]: {},
  [ChainId.Ethereum]: {},
  [ChainId.Ink]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
}

function formatApiAccount(account: TransformedApiAccount): object {
  return {
    owner: account.owner,
    number: account.number.toFixed(0),
    supplyUsd: account.supplyUSD.toFormat(2),
    borrowUsd: account.borrowUSD.toFormat(2),
    balances: Object.keys(account.balances)
      .map(k => account.balances[k])
      .sort((a, b) => a.amountUsd.minus(b.amountUsd).toNumber())
      .map(b => formatApiBalance(b)),
  };
}

function formatApiBalance(balance: TransformedApiBalance): string {
  return `${balance.wei.div(TEN.pow(balance.tokenDecimals))
    .toFormat(6)} (${balance.amountUsd.toFormat(2)} USD) ${balance.tokenSymbol}`;
}

function formatAccountData(
  accounts: ApiAccount[],
  marketMap: Record<string, ApiMarket>,
  marketId: Integer,
  value: 'supply' | 'borrow',
) {
  const formattedAccounts = accounts.map(a => ({
    owner: a.owner,
    number: a.number.toFixed(),
  }))
  writeFileSync(
    `${__dirname}/output/${value}-${process.env.MARKET_ID}-accounts.json`,
    JSON.stringify(formattedAccounts, null, 2),
  );
  const transformedAccounts = getTransformedAccounts(accounts, marketMap);
  transformedAccounts.sort((a, b) => {
    if (a.borrowUSD.eq(b.borrowUSD)) {
      return a.supplyUSD.gt(b.supplyUSD) ? 1 : -1;
    }
    return a.borrowUSD.gt(b.borrowUSD) ? 1 : -1;
  });

  if (accounts.length > 0) {
    const medianAccount = transformedAccounts[Math.floor(transformedAccounts.length / 2)];
    const biggestAccount = transformedAccounts[transformedAccounts.length - 1];
    const averageAccountDebt = transformedAccounts.reduce((acc, b) => acc.plus(b.borrowUSD), INTEGERS.ZERO)
      .div(transformedAccounts.length);
    let totalOfMarketId = INTEGERS.ZERO;
    for (const account of transformedAccounts) {
      const balances = Object.values(account.balances);
      for (const balance of balances) {
        if (marketId.eq(balance.marketId)) {
          totalOfMarketId = totalOfMarketId.plus(balance.wei);
        }
      }
    }

    Logger.info({
      message: `Stats on ${value} accounts`,
      medianAccountDebt: `$${medianAccount.borrowUSD.toFormat(2)}`,
      biggestAccountDebt: `$${biggestAccount.borrowUSD.toFormat(2)}`,
      averageAccountDebt: `$${averageAccountDebt.toFormat(2)}`,
      totalOfMarketId: totalOfMarketId.toFixed(),
      largeAccounts: {
        thresholdUsd: `$${LARGE_AMOUNT_THRESHOLD_USD.toFormat(2)}`,
        accounts: transformedAccounts.filter(a => a.borrowUSD.abs().gte(LARGE_AMOUNT_THRESHOLD_USD))
          .map(formatApiAccount),
      },
    });
  } else {
    Logger.info({
      message: `No stats on ${value} accounts found!`,
    });
  }
}

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore, false);
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

  const marketCount = await dolomite.getters.getNumMarkets();
  const marketId = new BigNumber(process.env.MARKET_ID ?? '');
  if (marketId.isNaN()) {
    const message = 'Invalid MARKET_ID'
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (!marketId.isInteger()) {
    const message = 'MARKET_ID must be integer'
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (marketId.gte(marketCount) || marketId.lt(INTEGERS.ZERO)) {
    const message = 'MARKET_ID out of range'
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  const marketName = await dolomite.token.getName(await dolomite.getters.getMarketTokenAddress(marketId));

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignoredMarkets: process.env.IGNORED_MARKETS?.split(',').map(m => parseInt(m, 10)) ?? [],
    marketId: marketId.toFixed(),
    market: marketName,
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
  Object.values(marketMap).forEach(market => {
    const priceMultiplier = new BigNumber(10).pow(36 - market.decimals);
    const priceOverrideRaw = NETWORK_TO_PRICE_OVERRIDE_MAP[networkId as ChainId][market.marketId];
    market.oraclePrice = priceOverrideRaw?.times(priceMultiplier) ?? market.oraclePrice;
  });

  const marketIndexMap = await marketStore.getMarketIndexMap(marketMap);
  const { tokenAddress } = marketMap[marketId.toFixed()];

  const supplyAccounts = await Pageable.getPageableValues(async (lastId) => {
    const { accounts: nextAccounts } = await getLiquidatableDolomiteAccountsWithCertainSupplyAsset(
      marketIndexMap,
      tokenAddress,
      false,
      blockNumber,
      lastId,
    );
    return nextAccounts;
  });
  formatAccountData(supplyAccounts, marketMap, marketId, 'supply');

  const borrowAccounts = await Pageable.getPageableValues(async (lastId) => {
    const { accounts: nextAccounts } = await getLiquidatableDolomiteAccountsWithCertainBorrowAsset(
      marketIndexMap,
      tokenAddress,
      blockNumber,
      lastId,
    );
    return nextAccounts;
  });
  formatAccountData(borrowAccounts, marketMap, marketId, 'borrow');

  const totalSupplyAccountDebt = supplyAccounts.reduce((acc, account) => {
    const totalBorrowUsd = Object.values(account.balances).reduce((memo, balance) => {
      if (balance.wei.gte(INTEGERS.ZERO)) {
        return memo;
      }
      const market = marketMap[balance.marketId.toString()];
      return memo.plus(balance.wei.times(market.oraclePrice).div(ONE_DOLLAR).abs());
    }, INTEGERS.ZERO);
    return acc.plus(totalBorrowUsd);
  }, INTEGERS.ZERO).toNumber();
  const totalSupplyAccountAssets = supplyAccounts.reduce((acc, account) => {
    const totalBorrowUsd = Object.values(account.balances).reduce((memo, balance) => {
      if (balance.wei.lte(INTEGERS.ZERO)) {
        return memo;
      }
      const market = marketMap[balance.marketId.toString()];
      return memo.plus(balance.wei.times(market.oraclePrice).div(ONE_DOLLAR).abs());
    }, INTEGERS.ZERO);
    return acc.plus(totalBorrowUsd);
  }, INTEGERS.ZERO).toNumber();
  Logger.info({
    message: `Found ${supplyAccounts.length} supply accounts with debt`,
    debtCount: supplyAccounts.length,
    supplyAmount: `$${formatNumber(totalSupplyAccountAssets)}`,
    debtAmount: `$${formatNumber(totalSupplyAccountDebt)}`,
  });

  const { debt: totalBorrowAccountDebt, collateral: totalBorrowAccountCollateral } = borrowAccounts.reduce((
    acc,
    account,
  ) => {
    const { debt, collateral } = Object.values(account.balances).reduce((memo, balance) => {
      const isCollateral = balance.wei.gte(INTEGERS.ZERO);
      const market = marketMap[balance.marketId.toString()];
      const value = balance.wei.times(market.oraclePrice).div(ONE_DOLLAR).abs();
      return {
        debt: isCollateral ? memo.debt : memo.debt.plus(value),
        collateral: !isCollateral ? memo.collateral : memo.collateral.plus(value),
      };
    }, { debt: INTEGERS.ZERO, collateral: INTEGERS.ZERO });
    return {
      debt: acc.debt.plus(debt),
      collateral: acc.collateral.plus(collateral),
    };
  }, { debt: INTEGERS.ZERO, collateral: INTEGERS.ZERO });
  Logger.info({
    message: `Found ${borrowAccounts.length} borrow accounts with debt`,
    debtCount: borrowAccounts.length,
    debtAmount: `$${formatNumber(totalBorrowAccountDebt.toNumber())}`,
    collateralAmount: `$${formatNumber(totalBorrowAccountCollateral.toNumber())}`,
  });

  return true;
}

function getTransformedAccounts(
  accounts: ApiAccount[],
  marketMap: Record<string, ApiMarket>,
): TransformedApiAccount[] {
  const transformedAccounts: TransformedApiAccount[] = [];
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
      borrowAdj: INTEGERS.ZERO,
      supplyAdj: INTEGERS.ZERO,
      transformedBalances: {} as Record<string, TransformedApiBalance>,
    };
    const {
      supply,
      borrow,
      transformedBalances,
    } = Object.values(account.balances)
      .reduce((acc, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const value = balance.wei.times(market.oraclePrice).div(ONE_DOLLAR);
        const adjust = MARGIN_PREMIUM_BASE.plus(MARGIN_PREMIUM_SPECULATIVE ?? market.marginPremium);
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          acc.borrow = acc.borrow.plus(value.abs());
          acc.borrowAdj = acc.borrowAdj.plus(value.abs().times(adjust).div(MARGIN_PREMIUM_BASE));
        } else {
          // decrease the supply size by the premium
          acc.supply = acc.supply.plus(value);
          acc.supplyAdj = acc.supplyAdj.plus(value.times(MARGIN_PREMIUM_BASE).div(adjust));
        }
        acc.transformedBalances[market.marketId] = {
          ...balance,
          amountUsd: value,
        };
        return acc;
      }, initial);

    transformedAccounts.push({
      ...account,
      supplyUSD: supply,
      borrowUSD: borrow,
      balances: transformedBalances,
    });
  }

  return transformedAccounts;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
