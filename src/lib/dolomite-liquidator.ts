import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import {
  emitDepositCancelled,
  emitWithdrawalExecuted,
  liquidateAccount,
  liquidateExpiredAccount,
  retryAsyncAction,
} from '../helpers/dolomite-helpers';
import { isExpired } from '../helpers/time-helpers';
import AccountStore from '../stores/account-store';
import AsyncActionRetryStore from '../stores/async-action-retry-store';
import AsyncActionStore from '../stores/async-action-store';
import BalanceStore from '../stores/balance-store';
import BlockStore from '../stores/block-store';
import LiquidationStore from '../stores/liquidation-store';
import MarketStore from '../stores/market-store';
import RiskParamsStore from '../stores/risk-params-store';
import { ApiAccount, ApiMarket } from './api-types';
import { delay } from './delay';
import Logger from './logger';
import { isCollateralized } from './utils';

export default class DolomiteLiquidator {
  private MIN_VALUE_LIQUIDATED = new BigNumber(process.env.MIN_VALUE_LIQUIDATED!);

  constructor(
    private readonly accountStore: AccountStore,
    private readonly asyncActionStore: AsyncActionStore,
    private readonly asyncActionRetryStore: AsyncActionRetryStore,
    private readonly blockStore: BlockStore,
    private readonly marketStore: MarketStore,
    private readonly balanceStore: BalanceStore,
    private readonly liquidationStore: LiquidationStore,
    private readonly riskParamsStore: RiskParamsStore,
  ) {
  }

  start = () => {
    Logger.info({
      at: 'DolomiteLiquidator#start',
      message: 'Starting DolomiteMargin liquidator',
    });
    delay(Number(process.env.LIQUIDATE_POLL_INTERVAL_MS))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    await delay(Number(process.env.MARKET_POLL_INTERVAL_MS)); // wait for the markets to initialize
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._liquidateAccounts();
      } catch (e) {
        Logger.error({
          at: 'DolomiteLiquidator#_poll',
          message: 'Uncaught error',
          error: e,
        });
      }

      await delay(Number(process.env.LIQUIDATE_POLL_INTERVAL_MS));
    }
  };

  _liquidateAccounts = async () => {
    const lastBlockTimestamp = this.blockStore.getBlockTimestamp();
    if (!lastBlockTimestamp) {
      Logger.warn({
        at: 'DolomiteLiquidator#_liquidateAccounts',
        message: 'Block timestamp from BlockStore is not initialized yet, returning...',
      });
      return;
    }

    const marketMap = this.marketStore.getMarketMap();

    let expirableAccounts = this.accountStore.getExpirableDolomiteAccounts()
      .filter(account => !this.liquidationStore.contains(account))
      .filter(account => {
        return Object.values(account.balances)
          .some((balance => {
            if (balance.wei.lt(INTEGERS.ZERO) && balance.expiresAt) {
              return isExpired(balance.expiresAt, lastBlockTimestamp)
            } else {
              return false;
            }
          }));
      })
      .filter(account => this.isSufficientDebt(account, marketMap))

    const riskParams = this.riskParamsStore.getDolomiteRiskParams();
    if (!riskParams) {
      Logger.error({
        at: 'DolomiteLiquidator#_liquidateAccounts',
        message: 'No risk params available',
      });
      return;
    }

    const liquidatableAccounts = this.accountStore.getLiquidatableDolomiteAccounts()
      .filter(account => !this.liquidationStore.contains(account))
      .filter(account => !isCollateralized(account, marketMap, riskParams))
      .filter(account => this.isSufficientDebt(account, marketMap))
      .filter(account => !this.isVaporizable(account, marketMap))
      .sort((a, b) => this.borrowAmountSorterDesc(a, b, marketMap));

    // Do not put an account in both liquidatable and expired; prioritize liquidation
    expirableAccounts = expirableAccounts.filter((ea) => !liquidatableAccounts.find((la) => la.id === ea.id));

    const marginAccountToRetryableActionsMap = this.asyncActionStore.getMarginAccountToRetryableActionsMap();
    const retryableActions = Object.values(
      liquidatableAccounts.reduce((acc, account) => {
        if (acc[account.id]) {
          delete acc[account.id];
        }
        return acc;
      }, { ...marginAccountToRetryableActionsMap }),
    );
    if (retryableActions.length > 0) {
      for (let i = 0; i < retryableActions.length; i += 1) {
        const action = retryableActions[i][0];
        if (!this.asyncActionRetryStore.contains(action)) {
          this.asyncActionRetryStore.add(action);
          try {
            const result = await retryAsyncAction(action);
            if (result) {
              Logger.info({
                message: 'Retry action transaction hash:',
                transactionHash: result?.transactionHash,
              });
              await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
            }
          } catch (error: any) {
            try {
              if (error.message?.includes('Invalid withdrawal key')) {
                await emitWithdrawalExecuted(action);
              } else if (error.message?.includes('Invalid deposit key')) {
                await emitDepositCancelled(action);
              } else {
                Logger.error({
                  at: 'DolomiteLiquidator#_liquidateAccounts',
                  message: 'Failed to retry action',
                  actions: action,
                  error,
                });
              }
            } catch (innerError: any) {
              Logger.error({
                at: 'DolomiteLiquidator#_liquidateAccounts',
                message: 'Failed to emit action',
                actions: action,
                error,
              });
            }
          }
        }
      }
    }

    if (liquidatableAccounts.length === 0 && expirableAccounts.length === 0) {
      Logger.info({
        at: 'DolomiteLiquidator#_liquidateAccounts',
        message: 'No accounts to liquidate',
      });

      return;
    }

    liquidatableAccounts.forEach(a => this.liquidationStore.add(a));
    expirableAccounts.forEach(a => this.liquidationStore.add(a));

    for (let i = 0; i < liquidatableAccounts.length; i += 1) {
      const account = liquidatableAccounts[i];
      try {
        const result = await liquidateAccount(
          account,
          marketMap,
          this.balanceStore.getMarketBalancesMap(),
          riskParams,
          marginAccountToRetryableActionsMap,
          lastBlockTimestamp,
        );
        if (result) {
          Logger.info({
            message: 'Liquidation transaction hash:',
            transactionHash: result?.transactionHash,
          });
        }
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
      } catch (error: any) {
        Logger.error({
          at: 'DolomiteLiquidator#_liquidateAccounts',
          message: 'Failed to liquidate account',
          account,
          error,
        });
      }
    }

    for (let i = 0; i < expirableAccounts.length; i += 1) {
      const account = expirableAccounts[i];
      try {
        const result = await liquidateExpiredAccount(
          account,
          marketMap,
          this.balanceStore.getMarketBalancesMap(),
          riskParams,
          marginAccountToRetryableActionsMap,
          lastBlockTimestamp,
        );
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
        if (result) {
          Logger.info({
            message: 'Expiration transaction hash:',
            transactionHash: result?.transactionHash,
          });
        }
      } catch (error: any) {
        Logger.error({
          at: 'DolomiteLiquidator#_liquidateAccounts',
          message: 'Failed to liquidate expired account',
          account,
          error,
        });
      }
    }
  };

  isSufficientDebt = (
    account: ApiAccount,
    marketMap: { [marketId: string]: ApiMarket },
  ): boolean => {
    const borrow = Object.values(account.balances)
      .reduce((memo, balance) => {
        if (balance.wei.lt(INTEGERS.ZERO)) {
          const market = marketMap[balance.marketId.toString()];
          const value = balance.wei.times(market.oraclePrice);
          return memo.plus(value.abs());
        }
        return memo;
      }, INTEGERS.ZERO);

    return borrow.gte(this.MIN_VALUE_LIQUIDATED);
  }

  isVaporizable = (
    account: ApiAccount,
    marketMap: { [marketId: string]: ApiMarket },
  ): boolean => {
    const supply = Object.values(account.balances)
      .reduce((memo, balance) => {
        if (balance.wei.gt(INTEGERS.ZERO)) {
          const market = marketMap[balance.marketId.toString()];
          return memo.plus(balance.wei.times(market.oraclePrice));
        }
        return memo;
      }, INTEGERS.ZERO);
    const borrow = Object.values(account.balances)
      .reduce((memo, balance) => {
        if (balance.wei.lt(INTEGERS.ZERO)) {
          const market = marketMap[balance.marketId.toString()];
          const value = balance.wei.times(market.oraclePrice);
          return memo.plus(value.abs());
        }
        return memo;
      }, INTEGERS.ZERO);

    return supply.eq(INTEGERS.ZERO) && borrow.gt(INTEGERS.ZERO);
  }

  /**
   * Used to prioritize larger liquidations first (by sorting by borrow amount, desc)
   */
  borrowAmountSorterDesc = (
    account1: ApiAccount,
    account2: ApiAccount,
    marketMap: { [marketId: string]: ApiMarket },
  ): number => {
    function sumBorrows(account: ApiAccount): BigNumber {
      return Object.values(account.balances)
        .reduce((memo, balance) => {
          const market = marketMap[balance.marketId.toString()];
          const value = balance.wei.times(market.oraclePrice);
          if (balance.wei.lt(INTEGERS.ZERO)) {
            // use the absolute value to make the comparison easier below
            memo = memo.plus(value.abs());
          }
          return memo;
        }, INTEGERS.ZERO);
    }

    const totalBorrow1 = sumBorrows(account1);
    const totalBorrow2 = sumBorrows(account2);

    return totalBorrow1.gt(totalBorrow2) ? -1 : 1;
  };
}
