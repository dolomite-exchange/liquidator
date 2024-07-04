/** @formatter:off */
import {BigNumber} from '@dolomite-exchange/dolomite-margin';
/** @formatter:on */
import { writeFileSync } from 'node:fs';
import v8 from 'v8';
import {
  getTimestampToBlockNumberMap,
  getTotalTradeVolume,
  getTotalTransactions,
  getTotalUniqueUsers,
  getTotalValueLockedAndFees,
} from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import '../src/lib/env';

const ONE_DAY_SECONDS = 86_400;

async function start() {
  Logger.info({
    message: 'Get Stats per Month Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
  });

  const startTimestamp = 1696118400;
  const endTimestamp = 1714521600;
  if (startTimestamp % ONE_DAY_SECONDS !== 0 || endTimestamp % ONE_DAY_SECONDS !== 0) {
    return Promise.reject(new Error('Invalid start timestamp or end timestamp'))
  }

  const timestampWithDescription = [
    [startTimestamp, '2023-10-01'],
    [1698811200, '2023-11-01'],
    [1701406800, '2023-12-01'],
    [1704085200, '2024-01-01'],
    [1706763600, '2024-02-01'],
    [1709269200, '2024-03-01'],
    [1711944000, '2024-04-01'],
    [endTimestamp, '2024-05-01'],
  ];
  const timestamps: number[] = timestampWithDescription.map(value => value[0] as number);
  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);
  const tvlAndFees = await getTotalValueLockedAndFees(dolomite.networkId, Object.values(timestampToBlockNumberMap));

  const totalTradeVolumes: BigNumber[] = [];
  const totalTransactions: BigNumber[] = [];
  const totalUniqueUsers: BigNumber[] = [];
  for (let i = 0; i < timestamps.length - 1; i += 1) {
    const innerStartTimestamp = timestamps[i];
    const innerEndTimestamp = timestamps[i + 1];
    const innerTimestampToBlockNumberMap = await getTimestampToBlockNumberMap([innerStartTimestamp, innerEndTimestamp])

    const totalTradeVolume = await getTotalTradeVolume(
      innerTimestampToBlockNumberMap[innerStartTimestamp],
      innerTimestampToBlockNumberMap[innerEndTimestamp],
    );
    totalTradeVolumes.push(totalTradeVolume);

    const totalTransactionCount = await getTotalTransactions(
      innerTimestampToBlockNumberMap[innerStartTimestamp],
      innerTimestampToBlockNumberMap[innerEndTimestamp],
    );
    totalTransactions.push(totalTransactionCount);

    const totalUniqueUserGrowth = await getTotalUniqueUsers(
      innerTimestampToBlockNumberMap[innerStartTimestamp],
      innerTimestampToBlockNumberMap[innerEndTimestamp],
    );
    totalUniqueUsers.push(totalUniqueUserGrowth);
  }

  const tvlData = tvlAndFees.totalValueLocked.map((value, i) => {
    return `${timestampWithDescription[i][1]},${value.toFixed(2)}`
  }).join('\n');
  writeFileSync(`${__dirname}/output/tvl-data.csv`, tvlData);

  const monthlyBorrowFees = tvlAndFees.borrowFees.map((value, i) => {
    return `${timestampWithDescription[i][1]},${value.times(30).toFixed(2)}`
  }).join('\n');
  writeFileSync(`${__dirname}/output/borrow-fees-data.csv`, monthlyBorrowFees);

  const monthlyTransactions = totalTransactions.map((value, i) => {
    return `${timestampWithDescription[i][1]},${value.toFixed(0)}`
  }).join('\n');
  writeFileSync(`${__dirname}/output/monthly-transactions-data.csv`, monthlyTransactions);

  const monthlyTradeVolumes = totalTradeVolumes.map((value, i) => {
    return `${timestampWithDescription[i][1]},${value.toFixed(2)}`
  }).join('\n');
  writeFileSync(`${__dirname}/output/monthly-trade-volume-data.csv`, monthlyTradeVolumes);

  const monthlyUniqueUsers = totalUniqueUsers.map((value, i) => {
    return `${timestampWithDescription[i][1]},${value.toFixed(2)}`
  }).join('\n');
  writeFileSync(`${__dirname}/output/monthly-unique-user-growth-data.csv`, monthlyUniqueUsers);

  const startTimestampString = new Date(startTimestamp * 1000).toISOString().substring(0, 10);
  const endTimestampString = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10);
  console.log('----------------------------------------------------')
  console.log('-------------------- TVL Data --------------------');
  console.log('----------------------------------------------------')
  console.log('Tabulation period:', `${timestamps} days (${startTimestampString} - ${endTimestampString})`);
  console.log('----------------------------------------------------')

  return true
}

start().catch(error => {
  console.error('Found error while starting', error);
  process.exit(1)
});
