/** @formatter:off */
import './lib/env-reader';
/** @formatter:on */
import { address, BigNumber } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getTimestampToBlockNumberMap, getTotalAmmPairYield } from '../src/clients/dolomite';
import Logger from '../src/lib/logger';

async function start() {
  let userAddress: address;
  if (process.env.USER_ADDRESS) {
    userAddress = process.env.USER_ADDRESS as address;
  } else {
    const message = 'No USER_ADDRESS specified!';
    Logger.error({ message });
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'Get LP Yield Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
    userAddress,
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
    userAddress,
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
