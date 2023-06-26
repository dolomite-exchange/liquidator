import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { DateTime } from 'luxon';
import { isExpired, liquidateAccount, liquidateExpiredAccount } from '../helpers/dolomite-helpers';
import AccountStore from './account-store';
import { ApiAccount, ApiMarket, ApiRiskParam } from './api-types';
import { delay } from './delay';
import LiquidationStore from './liquidation-store';
import Logger from './logger';
import MarketStore from './market-store';
import RiskParamsStore from './risk-params-store';

export default class DolomiteLiquidator {
  public accountStore: AccountStore;
  public marketStore: MarketStore;
  public liquidationStore: LiquidationStore;
  public riskParamsStore: RiskParamsStore;

  constructor(
    accountStore: AccountStore,
    marketStore: MarketStore,
    liquidationStore: LiquidationStore,
    riskParamsStore: RiskParamsStore,
  ) {
    this.accountStore = accountStore;
    this.marketStore = marketStore;
    this.liquidationStore = liquidationStore;
    this.riskParamsStore = riskParamsStore;
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
      await this._liquidateAccounts();

      await delay(Number(process.env.LIQUIDATE_POLL_INTERVAL_MS));
    }
  };

  _liquidateAccounts = async () => {
    const lastBlockTimestamp: DateTime = this.marketStore.getBlockTimestamp();

    let expirableAccounts = this.accountStore.getExpirableDolomiteAccounts()
      .filter(a => !this.liquidationStore.contains(a))
      .filter(a => {
        return Object.values(a.balances)
          .some((balance => {
            if (balance.wei.lt(0) && balance.expiresAt) {
              return isExpired(balance.expiresAt, lastBlockTimestamp)
            } else {
              return false;
            }
          }));
      });

    const riskParams = this.riskParamsStore.getDolomiteRiskParams();
    if (!riskParams) {
      Logger.error({
        at: 'DolomiteLiquidator#_liquidateAccounts',
        message: 'No risk params available',
      });
      return;
    }

    const marketMap = this.marketStore.getMarketMap();
    const liquidatableAccounts = this.accountStore.getLiquidatableDolomiteAccounts()
      .filter(account => !this.liquidationStore.contains(account))
      .filter(account => !this.isCollateralized(account, marketMap, riskParams))
      .sort((a, b) => this.borrowAmountSorterDesc(a, b, marketMap));

    // Do not put an account in both liquidatable and expired; prioritize liquidation
    expirableAccounts = expirableAccounts.filter((ea) => !liquidatableAccounts.find((la) => la.id === ea.id));

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
        await liquidateAccount(account, marketMap, riskParams, lastBlockTimestamp);
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
      } catch (error: any) {
        Logger.error({
          at: 'DolomiteLiquidator#_liquidateAccounts',
          message: `Failed to liquidate account: ${error.message}`,
          account,
          error,
        });
      }
    }

    for (let i = 0; i < expirableAccounts.length; i += 1) {
      const account = expirableAccounts[i];
      try {
        await liquidateExpiredAccount(account, marketMap, riskParams, lastBlockTimestamp);
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
      } catch (error: any) {
        Logger.error({
          at: 'DolomiteLiquidator#_liquidateAccounts',
          message: `Failed to liquidate expired account: ${error.message}`,
          account,
          error,
        });
      }
    }
  };

  isCollateralized = (
    account: ApiAccount,
    marketMap: { [marketId: string]: ApiMarket },
    riskParams: ApiRiskParam,
  ): boolean => {
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
    };
    const base = new BigNumber('1000000000000000000');
    const {
      supply,
      borrow,
    } = Object.values(account.balances)
      .reduce((memo, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const value = balance.wei.times(market.oraclePrice);
        const adjust = base.plus(market.marginPremium);
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          memo.borrow = memo.borrow.plus(value.times(adjust)
            .div(base)
            .integerValue(BigNumber.ROUND_FLOOR));
        } else {
          // decrease the supply size by the premium
          memo.supply = memo.supply.plus(value.times(base)
            .div(adjust)
            .integerValue(BigNumber.ROUND_FLOOR));
        }
        return memo;
      }, initial);

    const collateralization = supply.times(base)
      .div(borrow.abs())
      .integerValue(BigNumber.ROUND_FLOOR);
    return collateralization.gte(riskParams.liquidationRatio);
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
