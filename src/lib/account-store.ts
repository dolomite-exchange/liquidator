import { getExpiredAccounts, getLiquidatableDolomiteAccounts } from '../clients/dolomite';
import { ApiAccount } from './api-types';
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
      } catch (error: any) {
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
    const marketIndexMap = await this.marketStore.getMarketIndexMap(marketMap);

    const nextLiquidatableDolomiteAccounts = await Pageable.getPageableValues(async (lastId) => {
      const { accounts } = await getLiquidatableDolomiteAccounts(marketIndexMap, blockNumber, lastId);
      return accounts;
    });
    const nextExpirableAccounts = await Pageable.getPageableValues(async (lastId) => {
      const { accounts } = await getExpiredAccounts(marketIndexMap, blockNumber, lastId);
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
}
