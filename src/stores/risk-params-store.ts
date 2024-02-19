import { getDolomiteRiskParams } from '../clients/dolomite';
import { ApiRiskParam } from '../lib/api-types';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import BlockStore from './block-store';

export default class RiskParamsStore {
  public dolomiteRiskParams: ApiRiskParam | undefined;

  constructor(private readonly blockStore: BlockStore) {
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

    const blockNumber = this.blockStore.getBlockNumber();
    if (typeof blockNumber === 'undefined') {
      Logger.warn({
        at: 'RiskParamsStore#_update',
        message: 'Block number from BlockStore is not initialized yet, returning...',
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
