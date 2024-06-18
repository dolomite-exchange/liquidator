import { ApiAsyncAction, ApiAsyncWithdrawalStatus } from '@dolomite-exchange/zap-sdk';
import { getRetryableAsyncDeposits, getRetryableAsyncWithdrawals } from '../clients/dolomite';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import Pageable from '../lib/pageable';
import BlockStore from './block-store';

export default class AsyncActionStore {
  private marginAccountToRetryableAsyncActions: Record<string, ApiAsyncAction[]>;

  constructor(
    private readonly blockSore: BlockStore,
  ) {
    this.marginAccountToRetryableAsyncActions = {};
  }

  public getRetryableActions(): ApiAsyncAction[] {
    return Object.values(this.marginAccountToRetryableAsyncActions).reduce((prev, current) => prev.concat(current));
  }

  public getMarginAccountToRetryableActionsMap(): Record<string, ApiAsyncAction[]> {
    return this.marginAccountToRetryableAsyncActions;
  }

  start = () => {
    Logger.info({
      at: 'AsyncActionStore#start',
      message: 'Starting async action store',
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
          at: 'AsyncActionStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.ASYNC_ACTIONS_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'AsyncActionStore#_update',
      message: 'Updating async actions...',
    });

    const blockNumber = this.blockSore.getBlockNumber();
    if (typeof blockNumber === 'undefined') {
      Logger.warn({
        at: 'AsyncActionStore#_update',
        message: 'Block number from BlockStore is not initialized yet, returning...',
      });
      return;
    }

    // don't set the field variables until both values have been retrieved from the network
    const allActions = [
      ...await Pageable.getPageableValues(async (lastId) => {
        const { withdrawals } = await getRetryableAsyncDeposits(blockNumber, lastId);
        return withdrawals;
      }),
      ...await Pageable.getPageableValues(async (lastId) => {
        const { withdrawals } = await getRetryableAsyncWithdrawals(blockNumber, lastId);
        return withdrawals;
      }),
    ];

    this.marginAccountToRetryableAsyncActions = allActions.reduce<Record<string, ApiAsyncAction[]>>((acc, action) => {
      if (action.status === ApiAsyncWithdrawalStatus.WITHDRAWAL_CANCELLED) {
        return acc;
      }

      const marginAccount = `${action.owner}-${action.accountNumber.toFixed()}`;
      if (!acc[marginAccount]) {
        acc[marginAccount] = [];
      }
      acc[marginAccount] = acc[marginAccount].concat(action);
      return acc;
    }, {});

    Logger.info({
      at: 'AsyncActionStore#_update',
      message: 'Finished updating async actions',
      blockNumber,
    });
  };
}
