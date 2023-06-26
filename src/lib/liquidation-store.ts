import LRU from 'lru-cache';
import { ApiAccount } from './api-types';

export default class LiquidationStore {
  public store: LRU;

  constructor() {
    this.store = new LRU({
      maxAge: Number(process.env.LIQUIDATION_KEY_EXPIRATION_SECONDS) * 1000,
    });
  }

  private static _getKey(account: ApiAccount) {
    return `${account.owner.toLowerCase()}-${account.number}`;
  }

  async add(account: ApiAccount) {
    if (!account) {
      throw new Error('Must specify account');
    }

    const key = LiquidationStore._getKey(account);

    this.store.set(key, true);
  }

  contains(account: ApiAccount) {
    const key = LiquidationStore._getKey(account);

    return this.store.get(key);
  }
}
