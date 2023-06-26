import { getDolomiteRiskParams } from '../clients/dolomite';
import { ApiRiskParam } from './api-types';
import { delay } from './delay';
import Logger from './logger';
import MarketStore from './market-store';

export default class RiskParamsStore {
  public marketStore: MarketStore

  public dolomiteRiskParams: ApiRiskParam | undefined;

  constructor(marketStore: MarketStore) {
    this.marketStore = marketStore;
    this.dolomiteRiskParams = undefined;
  }

  public getDolomiteRiskParams(): ApiRiskParam | undefined {
    return this.dolomiteRiskParams;
  }

  start = () => {
    Logger.info({
      at: 'RiskParamsStore#start',
      message: 'Starting risk params store',
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
          at: 'RiskParamsStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.RISK_PARAMS_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'RiskParamsStore#_update',
      message: 'Updating risk params...',
    });

    const blockNumber = this.marketStore.getBlockNumber();
    if (blockNumber === 0) {
      Logger.warn({
        at: 'RiskParamsStore#_update',
        message: 'Block number from marketStore is 0, returning...',
      });
      return;
    }

    const { riskParams: nextDolomiteRiskParams } = await getDolomiteRiskParams(blockNumber);

    this.dolomiteRiskParams = nextDolomiteRiskParams;

    Logger.info({
      at: 'RiskParamsStore#_update',
      message: 'Finished updating risk params',
    });
  };
}
