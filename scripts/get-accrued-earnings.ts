/** @formatter:off */
import '../src/lib/env';
/** @formatter:on */
import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';

const ONE_DOLLAR = new BigNumber(10).pow(36);

async function start() {
  Logger.info({
    message: 'Get Accrued Earnings Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
  });

  const count = await dolomite.getters.getNumMarkets();
  const marketAndEarningsUsd: [number, Decimal][] = [];
  let totalEarningsUsd = INTEGERS.ZERO;
  for (let i = 0; i < count.toNumber(); i += 1) {
    try {
      const marketId = new BigNumber(i);
      const earnings = await dolomite.getters.getNumExcessTokens(marketId);
      const price = await dolomite.getters.getMarketPrice(marketId);
      const earningsUsd = earnings.times(price).div(ONE_DOLLAR);
      marketAndEarningsUsd.push([marketId.toNumber(), earningsUsd]);
      totalEarningsUsd = totalEarningsUsd.plus(earningsUsd);
    } catch (e: any) {
      if (!e.message.toLowerCase().includes('price is expired')) {
        console.warn(`Could not earnings data for market ${i} due to error`, e);
      }
    }
  }

  const topMarketsFormatted = marketAndEarningsUsd
    .sort((a, b) => b[1].minus(a[1]).toNumber())
    .map(([market, earnings]) => `${market}: $${earnings.toFixed(6)}`)
    .slice(0, Math.min(10, count.toNumber()));

  console.log('----------------------------------------------------')
  console.log('------------------- Earnings Data ------------------');
  console.log('----------------------------------------------------')
  console.log('Total Earnings:', `$${totalEarningsUsd.toFixed(2)}`);
  console.log('Top 10 markets:', JSON.stringify(topMarketsFormatted, null, 2));
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
