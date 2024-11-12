import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import v8 from 'v8';
import { getDolomiteRiskParams } from '../src/clients/dolomite';
import { updateGasPrice } from '../src/helpers/gas-price-helpers';
import { dolomite } from '../src/helpers/web3';
import '../src/lib/env';
import Logger from '../src/lib/logger';
import AccountStore from '../src/stores/account-store';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';

const ONE_DOLLAR = new BigNumber(10).pow(36);

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore);
  const accountStore = new AccountStore(blockStore, marketStore);
  const marketId = new BigNumber(process.env.MARKET_ID ?? 'NaN');

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
  } else if (marketId.isNaN()) {
    const message = `Invalid MARKET_ID found: ${process.env.MARKET_ID}`
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    marketId: marketId.toFixed(),
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
  const accounts = accountStore.getLiquidatableDolomiteAccounts().filter(account => {
    return Object.keys(account.balances).some(k => marketId.eq(k) && account.balances[k].par.gt(INTEGERS.ZERO))
  });

  let totalCollateralAmount = INTEGERS.ZERO;
  let totalDebtAmount = INTEGERS.ZERO;
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
      borrowAssets: [] as number[],
      supplyAssets: [] as number[],
    };
    const {
      supply,
      borrow,
      supplyAssets,
      borrowAssets,
    } = Object.values(account.balances).reduce((acc, balance) => {
      const market = marketMap[balance.marketId.toString()];
      const value = balance.wei.times(market.oraclePrice).div(ONE_DOLLAR);
      if (balance.wei.lt(INTEGERS.ZERO)) {
        acc.borrow = acc.borrow.plus(value.abs());
        acc.borrowAssets.push(balance.marketId)
      } else {
        acc.supply = acc.supply.plus(value);
        acc.supplyAssets.push(balance.marketId)
      }
      return acc;
    }, initial);

    Logger.info({
      message: `Account balance for ${account.id}`,
      index: i,
      supplyUsd: `$${formatNumber(supply.toNumber())}`,
      borrowUsd: `$${formatNumber(borrow.toNumber())}`,
      supplyAssets: supplyAssets.join(', '),
      borrowAssets: borrowAssets.join(', '),
    })

    totalCollateralAmount = totalCollateralAmount.plus(supply);
    totalDebtAmount = totalDebtAmount.plus(borrow);
  }

  Logger.info({
    message: `Found ${accounts.length} accounts with market_id=[${marketId.toFixed()}] collateral in it`,
    accountCount: accounts.length,
    totalCollateralAmount: `$${formatNumber(totalCollateralAmount.toNumber())}`,
    totalDebtAmount: `$${formatNumber(totalDebtAmount.toNumber())}`,
  });

  return true;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
