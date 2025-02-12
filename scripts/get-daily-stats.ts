/** @formatter:off */
/** @formatter:on */
import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import {
  getLiquidationsBetweenTimestamps,
  getTimestampToBlockNumberMap,
  getTotalTransactions,
  getTotalValueLockedAndFees,
} from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import '../src/lib/env';
import Pageable from '../src/lib/pageable';

const ONE_DAY_SECONDS = 86_400;

async function start() {
  Logger.info({
    message: 'Get Average TVL Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId: dolomite.networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
  });
  const startTimestamp: number = 1739232000; // February 11, 2025
  // const endTimestamp: number = 1739318400; // February 12, 2025
  const endTimestamp: number = Math.floor(Date.now() / 1000); // February 12, 2025
  if (startTimestamp % ONE_DAY_SECONDS !== 0 || endTimestamp % ONE_DAY_SECONDS !== 0) {
    return Promise.reject(new Error('Invalid start timestamp or end timestamp'))
  } else if (startTimestamp === endTimestamp) {
    return Promise.reject(new Error('start timestamp cannot equal end timestamp'));
  }

  const timestamps: number[] = [];
  for (let i = startTimestamp; i < endTimestamp; i += ONE_DAY_SECONDS) {
    timestamps.push(i);
  }
  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);

  Logger.info({
    message: 'Get timestamp information:',
    startTimestamp: new Date(startTimestamp * 1000).toISOString(),
    startBlock: timestampToBlockNumberMap[startTimestamp],
    endTimestamp: new Date(endTimestamp * 1000).toISOString(),
    endBlock: timestampToBlockNumberMap[endTimestamp - ONE_DAY_SECONDS],
  });

  const tvlAndFees = await getTotalValueLockedAndFees(
    dolomite.networkId,
    Object.values(timestampToBlockNumberMap),
  );
  const totalTransactions = await getTotalTransactions(
    timestampToBlockNumberMap[startTimestamp],
    timestampToBlockNumberMap[endTimestamp - ONE_DAY_SECONDS],
  );

  const allLiquidations = await Pageable.getPageableValues(async lastId => {
    const { liquidations } = await getLiquidationsBetweenTimestamps(startTimestamp, endTimestamp, lastId);
    return liquidations;
  });

  const liquidatedDebtUsd = allLiquidations.reduce((acc, l) => acc.plus(l.owedAmountUSD), INTEGERS.ZERO)

  const reserveFactor = INTEGERS.ONE.minus(await dolomite.getters.getEarningsRate());

  const averageSupplyTvl = tvlAndFees.totalSupplyLiquidity
    .reduce((acc, value) => acc.plus(value), new BigNumber(0))
    .div(timestamps.length);
  const averageBorrowTvl = tvlAndFees.totalBorrowLiquidity
    .reduce((acc, value) => acc.plus(value), new BigNumber(0))
    .div(timestamps.length);
  const borrowFees = tvlAndFees.borrowFees.reduce((acc, value) => acc.plus(value), new BigNumber(0));
  const startTimestampString = new Date(startTimestamp * 1000).toISOString().substring(0, 10);
  const endTimestampString = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10);

  console.log('----------------------------------------------------')
  console.log('-------------------- TVL Data --------------------');
  console.log('----------------------------------------------------')
  console.log('Average Supply TVL:', `$${averageSupplyTvl.toFormat(2)}`);
  console.log('Average Borrow TVL:', `$${averageBorrowTvl.toFormat(2)}`);
  console.log('Average Daily Transactions (per Day):', `${totalTransactions.div(timestamps.length).toFormat(2)}`);
  console.log('Liquidation Count:', `${allLiquidations.length}`);
  console.log('Liquidated Debt:', `$${liquidatedDebtUsd.toFormat(2)}`);
  console.log('Total Transactions:', `${totalTransactions.toFormat(2)}`);
  console.log('Total Borrow Fees:', `$${borrowFees.toFormat(2)}`);
  console.log('Total Revenue:', `$${borrowFees.times(reserveFactor).toFormat(2)}`);
  console.log('Average Borrow Fees (per Day):', `$${borrowFees.div(timestamps.length).toFixed(2)}`);
  console.log('Average Revenue (per Day):', `$${borrowFees.times(reserveFactor).div(timestamps.length).toFixed(2)}`);
  console.log(
    'Tabulation period:',
    `${timestamps.length} days; ${startTimestampString} through ${endTimestampString}`,
  );
  console.log();
  const annualizedData = new BigNumber(365).div(timestamps.length);
  const annualizedBorrowFees = borrowFees.times(annualizedData);
  console.log('Annualized Borrow Fees:', `$${annualizedBorrowFees.toFormat(2)}`);
  console.log('Reserve Factor:', `${reserveFactor.times(100).toFormat(2)}%`);
  console.log('Annualized Revenue:', `$${annualizedBorrowFees.times(reserveFactor).toFormat(2)}`);
  console.log('----------------------------------------------------')

  return true
}

start().catch(error => {
  Logger.error({
    message: `Found error while starting: ${error.toString()}`,
    error,
  });
  process.exit(1);
});
