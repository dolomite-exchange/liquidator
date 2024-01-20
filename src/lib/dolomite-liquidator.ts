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

const BASE = new BigNumber('1000000000000000000');
const MIN_VALUE_LIQUIDATED = new BigNumber(process.env.MIN_VALUE_LIQUIDATED!);

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
    const lastBlockTimestamp: DateTime = this.marketStore.getBlockTimestamp();
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
      .filter(account => !this.isCollateralized(account, marketMap, riskParams))
      .filter(account => this.isSufficientDebt(account, marketMap))
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
        const result = await liquidateAccount(account, marketMap, riskParams, lastBlockTimestamp);
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
        const result = await liquidateExpiredAccount(account, marketMap, riskParams, lastBlockTimestamp);
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

  isCollateralized = (
    account: ApiAccount,
    marketMap: { [marketId: string]: ApiMarket },
    riskParams: ApiRiskParam,
  ): boolean => {
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
    };
    const {
      supply,
      borrow,
    } = Object.values(account.balances)
      .reduce((memo, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const value = balance.wei.times(market.oraclePrice);
        const adjust = BASE.plus(market.marginPremium);
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          memo.borrow = memo.borrow.plus(value.abs().times(adjust).div(BASE).integerValue(BigNumber.ROUND_FLOOR));
        } else {
          // decrease the supply size by the premium
          memo.supply = memo.supply.plus(value.times(BASE).div(adjust).integerValue(BigNumber.ROUND_FLOOR));
        }
        return memo;
      }, initial);

    const collateralization = supply.times(BASE)
      .div(borrow)
      .integerValue(BigNumber.ROUND_FLOOR);
    return collateralization.gte(riskParams.liquidationRatio);
  }

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

    return borrow.gte(MIN_VALUE_LIQUIDATED);
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
