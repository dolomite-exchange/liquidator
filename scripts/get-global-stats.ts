/** @formatter:off */
/** @formatter:on */
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import {
  getTimestampToBlockNumberMap,
  getTotalTransactions,
  getTotalValueLockedAndFees,
} from '../src/clients/dolomite';
import Logger from '../src/lib/logger';
import '../src/lib/env';

const ONE_DAY_SECONDS = 86_400;

async function start() {
  Logger.info({
    message: 'Get Average TVL Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
  });

  const startTimestamp = 1708560000;
  const endTimestamp = 1709769600;
  if (startTimestamp % ONE_DAY_SECONDS !== 0 || endTimestamp % ONE_DAY_SECONDS !== 0) {
    return Promise.reject(new Error('Invalid start timestamp or end timestamp'))
  }

  const timestamps: number[] = [];
  for (let i = startTimestamp; i < endTimestamp; i += ONE_DAY_SECONDS) {
    timestamps.push(i);
  }
  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);
  const tvlAndFees = await getTotalValueLockedAndFees(Object.values(timestampToBlockNumberMap));
  const totalTransactions = await getTotalTransactions(
    timestampToBlockNumberMap[startTimestamp],
    timestampToBlockNumberMap[endTimestamp - ONE_DAY_SECONDS],
  );

  const averageTvl = tvlAndFees.totalValueLocked
    .reduce((acc, value) => acc.plus(value), new BigNumber(0))
    .div(timestamps.length);
  const borrowFees = tvlAndFees.borrowFees.reduce((acc, value) => acc.plus(value), new BigNumber(0));
  const startTimestampString = new Date(startTimestamp * 1000).toISOString().substring(0, 10);
  const endTimestampString = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10);
  console.log('----------------------------------------------------')
  console.log('-------------------- TVL Data --------------------');
  console.log('----------------------------------------------------')
  console.log('Average TVL:', `$${averageTvl.toFixed(2)}`);
  console.log('Average Daily Transactions:', `${totalTransactions.div(timestamps.length).toFixed(2)}`);
  console.log('Total Transactions:', `${totalTransactions.toFixed(2)}`);
  console.log('Total Borrow Fees:', `$${borrowFees.toFixed(2)}`);
  console.log('Average Borrow Fees:', `$${borrowFees.div(timestamps.length).toFixed(2)}`);
  console.log('Tabulation period:', `${timestamps} days (${startTimestampString} - ${endTimestampString})`);
  console.log();
  const annualizedData = new BigNumber(365).div(timestamps.length)
  console.log('Annualized borrow fees:', `$${borrowFees.times(annualizedData).toFixed(2)}`);
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
