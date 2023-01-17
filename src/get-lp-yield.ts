/* eslint-disable */
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import Logger from './lib/logger';

// eslint-disable-next-line
if (process.env.ENV_FILENAME) {
  require('dotenv').config({ path: `${__dirname}/../${process.env.ENV_FILENAME}` });
} else {
  Logger.warn({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.'
  });
}

import v8 from 'v8';
import { getDolomiteRiskParams, getTimestampToBlockNumberMap, getTotalAmmPairYield } from './clients/dolomite';
import { getSubgraphBlockNumber } from './helpers/block-helper';
import { dolomite } from './helpers/web3';

async function start() {
  const { blockNumber } = await getSubgraphBlockNumber();
  const { riskParams } = await getDolomiteRiskParams(blockNumber);
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

  const currentDate = Math.floor(new Date().getTime() / 1000 / 86400) * 86400;
  const startTimestamp = 1665619200; // October 13, 2022 at 12:00:00 AM UTC
  const timestamps: number[] = [];
  for (let i = startTimestamp; i < currentDate; i += 86400) {
    timestamps.push(i);
  }
  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);
  const result = await getTotalAmmPairYield(
    Object.values(timestampToBlockNumberMap),
    process.env.USER_ADDRESS as string,
  );
  const startTimestampString = new Date(startTimestamp * 1000).toISOString().substring(0, 10);
  const endTimestampString = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10);
  console.log('----------------------------------------------------')
  console.log('-------------------- Yield Data --------------------');
  console.log('----------------------------------------------------')
  console.log('Lending yield:', `$${result.lendingYield.toFixed(2)}`);
  console.log('Swap yield:', `$${result.swapYield.toFixed(2)}`);
  console.log('Total yield:', `$${result.totalYield.toFixed(2)}`);
  console.log('Tabulation period:', `${result.totalEntries} days (${startTimestampString} - ${endTimestampString})`);
  console.log();
  const annualizedData = new BigNumber(365).div(result.totalEntries)
  console.log('Annualized lending yield:', `$${result.lendingYield.times(annualizedData).toFixed(2)}`);
  console.log('Annualized swap yield:', `$${result.swapYield.times(annualizedData).toFixed(2)}`);
  console.log('Annualized total yield:', `$${result.totalYield.times(annualizedData).toFixed(2)}`);
  console.log('----------------------------------------------------')

  return true
}

start().catch(error => {
  Logger.error({
    message: `Found error while starting: ${error.toString()}`,
    error,
  })
  process.exit(1)
});
