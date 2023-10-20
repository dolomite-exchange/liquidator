// eslint-disable-next-line
if (process.env.ENV_FILENAME) {
  // eslint-disable-next-line
  require('dotenv').config({ path: `${__dirname}/../../${process.env.ENV_FILENAME}` });
} else {
  Logger.warn({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv').config();
}

import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDeposits, getDolomiteRiskParams, getLiquidations, getTrades, getTransfers, getWithdrawals } from '../clients/dolomite';
import { dolomite } from '../helpers/web3';
/* eslint-disable */
import Logger from '../lib/logger';
import MarketStore from '../lib/market-store';
import Pageable from '../lib/pageable';
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { BalanceAndRewardPoints, BalanceChangeEvent, getAccountBalancesByMarket, parseDeposits, parseLiquidations, parseTrades, parseTransfers, parseWithdrawals } from '../lib/rewards';


async function start() {
  const marketStore = new MarketStore();

  const blockRewardStart = 130000000;
  const blockRewardStartTimestamp = 1694407206;
  const blockRewardEnd = 141530000;
  const blockRewardEndTimestamp = 1697585246;

  const { riskParams } = await getDolomiteRiskParams(blockRewardStart);
  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address
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
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();

  const marketMap = marketStore.getMarketMap();
  const marketIndexMap = await marketStore.getMarketIndexMap(marketMap);

  // Get accounts with supply value
  const accounts = await Pageable.getPageableValues(async (lastIndex) => {
    const { accounts } = await getAllDolomiteAccountsWithSupplyValue(marketIndexMap, blockRewardStart, lastIndex);
    return accounts;
  });

  // Load and parse events
  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(accounts, blockRewardStartTimestamp);
  const accountToAssetToEventsMap: Record<string, Record<number, BalanceChangeEvent[]>> = {};

  const deposits = await Pageable.getPageableValues((async (lastIndex) => {
    const { deposits } = await getDeposits(blockRewardStart, blockRewardEnd, lastIndex);
    return deposits;
  }));
  parseDeposits(accountToAssetToEventsMap, deposits);

  const withdrawals = await Pageable.getPageableValues((async (lastIndex) => {
    const { withdrawals } = await getWithdrawals(blockRewardStart, blockRewardEnd, lastIndex);
    return withdrawals;
  }));
  parseWithdrawals(accountToAssetToEventsMap, withdrawals);

  const transfers = await Pageable.getPageableValues((async (lastIndex) => {
    const { transfers } = await getTransfers(blockRewardStart, blockRewardEnd, lastIndex);
    return transfers;
  }));
  parseTransfers(accountToAssetToEventsMap, transfers);

  const trades = await Pageable.getPageableValues((async (lastIndex) => {
    const { trades } = await getTrades(blockRewardStart, blockRewardEnd, lastIndex);
    return trades;
  }));
  parseTrades(accountToAssetToEventsMap, trades);

  const liquidations = await Pageable.getPageableValues((async (lastIndex) => {
    const { liquidations } = await getLiquidations(blockRewardStart, blockRewardEnd, lastIndex);
    return liquidations;
  }));
  parseLiquidations(accountToAssetToEventsMap, liquidations);

  // Sort list and loop through to get point total per user
  let totalPointsPerMarket = {};
  for (const account in accountToAssetToEventsMap) {
    for (const market in accountToAssetToEventsMap[account]) {

      // Make sure user => market => balance record exists
      if(!accountToDolomiteBalanceMap[account]) {
        accountToDolomiteBalanceMap[account] = {};
      }
      if (!accountToDolomiteBalanceMap[account][market]) {
          accountToDolomiteBalanceMap[account][market] = new BalanceAndRewardPoints(blockRewardStartTimestamp);
      }
      totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

      // Sort and process events
      accountToAssetToEventsMap[account][market].sort((a,b) => {
        return a.serialId - b.serialId;
      });
      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      accountToAssetToEventsMap[account][market].forEach((event) => {
        totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(userBalStruct.processEvent(event));
      });
    }
  }

  // Do final loop through all balances to finish reward point calculation
  for (const account in accountToDolomiteBalanceMap) {
    for (const market in accountToDolomiteBalanceMap[account]) {
      totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(userBalStruct.processEvent({ amount: new BigNumber(0), timestamp: blockRewardEndTimestamp, serialId: 0}));
    }
  }

  console.log(accountToDolomiteBalanceMap);
  console.log(totalPointsPerMarket);
  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
