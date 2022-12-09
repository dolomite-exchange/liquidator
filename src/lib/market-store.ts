import { DateTime } from 'luxon';
import { ApiMarket } from './api-types';
import { getDolomiteMarkets } from '../clients/dolomite';
import { delay } from './delay';
import Logger from './logger';
import {
  getSubgraphBlockNumber,
} from '../helpers/block-helper';

export default class MarketStore {
  private blockNumber: number;
  private blockTimestamp: DateTime;
  private marketMap: { [marketId: string]: ApiMarket };

  constructor() {
    this.blockNumber = 0;
    this.marketMap = {};
  }

  public getBlockNumber(): number {
    return this.blockNumber;
  }

  public getBlockTimestamp(): DateTime {
    return this.blockTimestamp;
  }

  public getMarketMap(): { [marketId: string]: ApiMarket } {
    return this.marketMap;
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
    for (;;) {
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

    const { blockNumber, blockTimestamp } = await getSubgraphBlockNumber();

    let nextDolomiteMarkets: ApiMarket[] = [];
    let queryDolomiteMarkets: ApiMarket[] = [];
    let pageIndex = 0;
    do {
      const { markets } = await getDolomiteMarkets(blockNumber, pageIndex);
      nextDolomiteMarkets = nextDolomiteMarkets.concat(markets);
      queryDolomiteMarkets = markets;
      pageIndex += 1;
    } while (queryDolomiteMarkets.length !== 0)

    this.blockNumber = blockNumber;
    this.blockTimestamp = blockTimestamp;
    this.marketMap = nextDolomiteMarkets.reduce<{ [marketId: string]: ApiMarket }>((memo, market) => {
      memo[market.id.toString()] = market;
      return memo;
    }, {});

    Logger.info({
      at: 'MarketStore#_update',
      message: 'Finished updating markets',
      blockNumber,
    });
  };
}
