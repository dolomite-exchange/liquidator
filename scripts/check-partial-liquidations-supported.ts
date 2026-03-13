/* eslint-disable no-console */
/** @formatter:off */
/** @formatter:on */
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import '../src/lib/env';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';

async function start() {
  Logger.info({
    message: 'Check Partial Liquidations Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId: dolomite.networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
  });

  const blockStore = new BlockStore();
  await blockStore._update();

  const marketStore = new MarketStore(blockStore);
  await marketStore._update();

  const markets = Object.values(marketStore.getMarketMap());
  const unsupportedMarkets: object[] = [];
  for (const market of markets) {
    if (!market.isPartialLiquidationSupported) {
      unsupportedMarkets.push({
        marketId: market.marketId,
        name: market.name,
        symbol: market.symbol,
      });
    }
  }

  console.log('----------------------------------------------------')
  console.log('----------------- Liquidation Data -----------------');
  console.log('----------------------------------------------------')
  console.log('Unsupported partial liquidation market IDs:', `${JSON.stringify(unsupportedMarkets, null, 2)}`);
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
