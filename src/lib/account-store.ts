import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import {
  getExpiredAccounts,
  getLiquidatableDolomiteAccounts,
} from '../clients/dolomite';
import { dolomite } from '../helpers/web3';
import {
  ApiAccount,
  MarketIndex,
} from './api-types';
import { delay } from './delay';
import Logger from './logger';
import MarketStore from './market-store';
import Pageable from './pageable';

export default class AccountStore {
  public marketStore: MarketStore;

  public liquidatableDolomiteAccounts: ApiAccount[];
  public expirableAccounts: ApiAccount[];

  constructor(marketStore: MarketStore) {
    this.marketStore = marketStore;
    this.liquidatableDolomiteAccounts = [];
    this.expirableAccounts = [];
  }

  public getLiquidatableDolomiteAccounts(): ApiAccount[] {
    return this.liquidatableDolomiteAccounts;
  }

  public getExpirableDolomiteAccounts(): ApiAccount[] {
    return this.expirableAccounts;
  }

  start = () => {
    Logger.info({
      at: 'AccountStore#start',
      message: 'Starting account store',
    });
    this._poll();
  };

  _poll = async () => {
    await delay(Number(process.env.MARKET_POLL_INTERVAL_MS)); // wait for the markets to initialize

    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (error) {
        Logger.error({
          at: 'AccountStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.ACCOUNT_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'AccountStore#_update',
      message: 'Updating accounts...',
    });

    const blockNumber = this.marketStore.getBlockNumber();
    if (blockNumber === 0) {
      Logger.warn({
        at: 'AccountStore#_update',
        message: 'Block number from marketStore is 0, returning...',
      });
      return;
    }

    const marketMap = this.marketStore.getMarketMap();
    const marketIndexMap = await this.getMarketIndexMap(marketMap);

    const nextLiquidatableDolomiteAccounts = await Pageable.getPageableValues(async (pageIndex) => {
      const { accounts } = await getLiquidatableDolomiteAccounts(marketIndexMap, blockNumber, pageIndex);
      return accounts;
    });
    const nextExpirableAccounts = await Pageable.getPageableValues(async (pageIndex) => {
      const { accounts } = await getExpiredAccounts(marketIndexMap, blockNumber, pageIndex);
      return accounts;
    });

    // don't set the field variables until both values have been retrieved from the network
    this.liquidatableDolomiteAccounts = nextLiquidatableDolomiteAccounts;
    this.expirableAccounts = nextExpirableAccounts;

    Logger.info({
      at: 'AccountStore#_update',
      message: 'Finished updating accounts',
    });
  };

  private async getMarketIndexMap(
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
}
