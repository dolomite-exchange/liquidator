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
import { getAllDolomiteAccountsWithSupplyValue, getDeposits, getDolomiteRiskParams, getWithdrawals } from '../clients/dolomite';
import { getSubgraphBlockNumber } from '../helpers/block-helper';
import { dolomite } from '../helpers/web3';
/* eslint-disable */
import Logger from '../lib/logger';
import MarketStore from '../lib/market-store';
import Pageable from '../lib/pageable';
// import { INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { BalanceAndRewardPoints, BalanceChangeEvent, parseDeposits, parseWithdrawals } from '../lib/rewards';

// const WETH_MARKET_ID = 0;

async function start() {
  const marketStore = new MarketStore();

  // Change this to be blockNumber at start of the week / start of reward period
  const blockRewardStart = 141000000;
  const blockRewardStartTimestamp = 1697434374;
  const blockRewardEnd = 141519000;
  const blockRewardEndTimestamp = 1697581061;
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

  // Get account balances
  console.log('getting account balances');
  const accountToDolomiteBalanceMap: Record<string, Record<number, BalanceAndRewardPoints>> = {};
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    accountToDolomiteBalanceMap[account.owner] = accountToDolomiteBalanceMap[account.owner] ?? {};

    Object.values(account.balances)
      .forEach((balance) => {
        if (accountToDolomiteBalanceMap[account.owner][balance.marketId]) {
          accountToDolomiteBalanceMap[account.owner][balance.marketId].balance.plus(balance.par);
        }
        else {
          accountToDolomiteBalanceMap[account.owner][balance.marketId] = new BalanceAndRewardPoints(blockRewardStartTimestamp, balance.par);
        }
      });
  }

  const accountToAssetToEventsMap: Record<string, Record<number, BalanceChangeEvent[]>> = {};

  console.log('getting deposits and adding to event mapping');
  const deposits = await Pageable.getPageableValues((async (lastIndex) => {
    const { deposits } = await getDeposits(blockRewardStart, blockRewardEnd, lastIndex);
    return deposits;
  }), 'serialId');
  parseDeposits(accountToAssetToEventsMap, deposits);


  console.log('getting withdrawals and adding to event mapping');
  const withdrawals = await Pageable.getPageableValues((async (lastIndex) => {
    const { withdrawals } = await getWithdrawals(blockRewardStart, blockRewardEnd, lastIndex);
    return withdrawals;
  }), 'serialId');
  parseWithdrawals(accountToAssetToEventsMap, withdrawals);

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

      // Sort events
      accountToAssetToEventsMap[account][market].sort((a,b) => {
        return a.serialId - b.serialId;
      })

      // Process events
      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      accountToAssetToEventsMap[account][market].forEach((event) => {
        totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(userBalStruct.processEvent(event));
      });
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
