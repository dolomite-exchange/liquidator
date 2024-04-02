import { ApiAsyncAction } from '@dolomite-exchange/zap-sdk';
import LRU from 'lru-cache';

export default class AsyncActionRetryStore {
  public store: LRU;

  constructor() {
    this.store = new LRU({
      maxAge: Number(process.env.ASYNC_ACTIONS_KEY_EXPIRATION_SECONDS) * 1000,
    });
  }

  private static _getKey(action: ApiAsyncAction) {
    return action.id.toLowerCase();
  }

  add(action: ApiAsyncAction) {
    if (!action) {
      throw new Error('Must specify action');
    }

    const key = AsyncActionRetryStore._getKey(action);

    this.store.set(key, true);
  }

  contains(action: ApiAsyncAction) {
    const key = AsyncActionRetryStore._getKey(action);

    return this.store.get(key);
  }
}
