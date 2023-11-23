import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';
import { getDolomiteMarkets } from '../clients/dolomite';
import { getSubgraphBlockNumber } from '../helpers/block-helper';
import { dolomite } from '../helpers/web3';
import { ApiMarket, MarketIndex } from './api-types';
import { delay } from './delay';
import Logger from './logger';
import Pageable from './pageable';

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

  async getMarketIndexMap(
    marketMap: { [marketId: string]: any },
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
        borrow: new BigNumber(decodedResults[0]).div('1000000000000000000'),
        supply: new BigNumber(decodedResults[1]).div('1000000000000000000'),
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

    const { blockNumber, blockTimestamp } = await getSubgraphBlockNumber();

    const nextDolomiteMarkets = await Pageable.getPageableValues(async (lastId) => {
      const result = await getDolomiteMarkets(blockNumber, lastId);
      return result.markets
    });

    this.blockNumber = blockNumber;
    this.blockTimestamp = blockTimestamp;
    this.marketMap = nextDolomiteMarkets.reduce<{ [marketId: string]: ApiMarket }>((memo, market) => {
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
