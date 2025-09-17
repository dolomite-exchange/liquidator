/** @formatter:off */
import '../src/lib/env';
/** @formatter:on */
import { address, BigNumber } from '@dolomite-exchange/dolomite-margin';
import { Network } from '@dolomite-exchange/zap-sdk';
import v8 from 'v8';
import { getTimestampToBlockNumberMap, getTotalYield } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';

const LAUNCH_TIMESTAMP_MAP: Record<Network, number> = {
  [Network.ARBITRUM_ONE]: 1665619200, // October 13, 2022, at 00:00:00 AM UTC
  [Network.BASE]: 1734566400, // December 19, 2024, at 00:00:00 AM UTC
  [Network.BERACHAIN]: 1737763200, // January 25, 2025, at 00:00:00 AM UTC
  [Network.BOTANIX]: 1750636800, // June 23, 2025, at 00:00:00 AM UTC
  [Network.ETHEREUM]: 1750550400, // June 22, 2025, at 00:00:00 AM UTC
  [Network.INK]: 1734566400, // December 19, 2024, at 00:00:00 AM UTC
  [Network.MANTLE]: 1714348800, // April 29, 2024, at 00:00:00 AM UTC
  [Network.POLYGON_ZKEVM]: 1706832000, // February 2, 2025, at 00:00:00 AM UTC
  [Network.X_LAYER]: 1714348800, // April 29, 2025, at 00:00:00 AM UTC
}

/**
 * Gets the yield earned by a user over a certain duration
 */
async function start() {
  let userAddress: address;
  if (process.env.USER_ADDRESS) {
    userAddress = (process.env.USER_ADDRESS as address).toLowerCase();
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

  const launchTimestamp = LAUNCH_TIMESTAMP_MAP[dolomite.networkId];
  let startTimestamp = 1704067200; // January 1, 2024 (00:00:00 UTC)
  if (startTimestamp < launchTimestamp) {
    startTimestamp = launchTimestamp;
  }

  const endTimestamp = 1735603200; // December 31, 2025 (00:00:00 UTC)
  const timestamps: number[] = [];
  for (let i = startTimestamp; i < endTimestamp; i += 86400) {
    timestamps.push(i);
  }

  if (timestamps.length === 0) {
    console.warn('Could not produce yield because there are no timestamps!');
    return false;
  }

  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);
  const result = await getTotalYield(
    Object.values(timestampToBlockNumberMap),
    userAddress,
  );
  const startTimestampString = new Date(startTimestamp * 1000).toISOString().substring(0, 10);
  const endTimestampString = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10);
  console.log('----------------------------------------------------')
  console.log('-------------------- Yield Data --------------------');
  console.log('----------------------------------------------------')
  console.log('LP Lending yield:', `$${result.lpLendingYield.toFormat(2)}`);
  console.log('Lending yield:', `$${result.lendingYield.toFormat(2)}`);
  console.log('Swap yield:', `$${result.swapYield.toFormat(2)}`);
  console.log('Total yield:', `$${result.totalYield.toFormat(2)}`);
  console.log('Tabulation period:', `${result.totalEntries} days (${startTimestampString} - ${endTimestampString})`);
  console.log();
  const annualizedData = new BigNumber(365).div(result.totalEntries)
  console.log('Annualized lending yield:', `$${result.lendingYield.times(annualizedData).toFormat(2)}`);
  console.log('Annualized swap yield:', `$${result.swapYield.times(annualizedData).toFormat(2)}`);
  console.log('Annualized total yield:', `$${result.totalYield.times(annualizedData).toFormat(2)}`);
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
