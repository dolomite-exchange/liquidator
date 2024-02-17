import { DateTime } from 'luxon';
import { getSubgraphBlockNumber } from '../helpers/block-helper';
import { delay } from './delay';
import Logger from './logger';

export default class BlockStore {
  private blockNumber: number;
  private blockTimestamp: DateTime;

  constructor() {
    this.blockNumber = 0;
    this.blockTimestamp = null;
  }

  public getBlockNumber(): number {
    return this.blockNumber;
  }

  public getBlockTimestamp(): DateTime {
    return this.blockTimestamp;
  }

  start = () => {
    Logger.info({
      at: 'BlockStore#start',
      message: 'Starting block store',
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
          at: 'BlockStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.BLOCK_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'BlockStore#_update',
      message: 'Updating blocks...',
    });

    const { blockNumber, blockTimestamp } = await getSubgraphBlockNumber();

    this.blockNumber = blockNumber;
    this.blockTimestamp = blockTimestamp;

    Logger.info({
      at: 'BlockStore#_update',
      message: 'Finished updating blocks',
      blockNumber,
    });
  };
}
