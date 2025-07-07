import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { getDolomiteMarkets } from '../clients/dolomite';
import { isMarketIgnored } from '../helpers/market-helpers';
import { dolomite } from '../helpers/web3';
import { ApiMarket, MarketIndex } from '../lib/api-types';
import BlockStore from './block-store';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import Pageable from '../lib/pageable';

export default class MarketStore {
  private marketMap: { [marketId: string]: ApiMarket };

  constructor(private readonly blockStore: BlockStore, private readonly ignoreBadPrices: boolean = false) {
    this.marketMap = {};
  }

  public getMarketMap(): { [marketId: string]: ApiMarket } {
    return this.marketMap;
  }

  async getMarketIndexMap(
    marketMap: Record<string, any>,
  ): Promise<{ [marketId: string]: MarketIndex }> {
    const marketIds = Object.keys(marketMap);
    const indexCalls = marketIds.map(marketId => {
      return {
        target: dolomite.contracts.dolomiteMargin.options.address,
        callData: dolomite.contracts.dolomiteMargin.methods.getMarketCurrentIndex(marketId)
          .encodeABI(),
      };
    });

    // Even though the block number from the subgraph is certainly behind the RPC, we want the most updated chain data!
    const { results: indexResults } = await dolomite.multiCall.aggregate(indexCalls);

    return indexResults.reduce<{ [marketId: string]: MarketIndex }>((memo, rawIndexResult, i) => {
      const decodedResults = dolomite.web3.eth.abi.decodeParameters(['uint256', 'uint256', 'uint256'], rawIndexResult);
      memo[marketIds[i]] = {
        marketId: Number(marketIds[i]),
        borrow: new BigNumber(decodedResults[0]).div(INTEGERS.INTEREST_RATE_BASE),
        supply: new BigNumber(decodedResults[1]).div(INTEGERS.INTEREST_RATE_BASE),
      };
      return memo;
    }, {});
  }

  start = () => {
    Logger.info({
      at: 'MarketStore#start',
      message: 'Starting market store',
    });
    this._poll();
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (error: any) {
        Logger.error({
          at: 'MarketStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.MARKET_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'MarketStore#_update',
      message: 'Updating markets...',
    });

    const blockNumber = this.blockStore.getBlockNumber();
    if (typeof blockNumber === 'undefined') {
      Logger.warn({
        at: 'MarketStore#_update',
        message: 'Block number from BlockStore is not initialized yet, returning...',
      });
      return;
    }

    const nextDolomiteMarkets = await Pageable.getPageableValues(async (lastId) => {
      const result = await getDolomiteMarkets(blockNumber, lastId, this.ignoreBadPrices);
      return result.markets
    });

    this.marketMap = nextDolomiteMarkets.reduce<{ [marketId: string]: ApiMarket }>((memo, market) => {
      if (isMarketIgnored(market.marketId)) {
        // If any of the market IDs are ignored, then just return
        return memo;
      }

      memo[market.marketId.toString()] = market;
      return memo;
    }, {});

    Logger.info({
      at: 'MarketStore#_update',
      message: 'Finished updating markets',
      blockNumber,
    });
  };
}
