import { BigNumber } from "@dolomite-exchange/dolomite-margin";

const ZERO = new BigNumber('0');

export interface BalanceChangeEvent {
  amount: BigNumber;
  timestamp: number;
  serialId: number;
}

export class BalanceAndRewardPoints {
  balance: BigNumber;
  rewardPoints: BigNumber;
  lastUpdated: number;

  constructor(timestamp: number, balance: BigNumber = new BigNumber(0)) {
    this.balance = balance;
    this.rewardPoints = new BigNumber(0);
    this.lastUpdated = timestamp;
  }

  processEvent(event): BigNumber{
      let rewardUpdate = new BigNumber(0);
      if(this.balance.gt(0)) {
        rewardUpdate = this.balance.times(event.timestamp - this.lastUpdated);
        this.rewardPoints = this.rewardPoints.plus(rewardUpdate);
      }
      this.balance = this.balance.plus(event.amount);
      this.lastUpdated = event.timestamp;

      return rewardUpdate;
  }
}

export function parseDeposits(accountToAssetToEventsMap, deposits) {
  deposits.forEach((deposit) => {
      const event: BalanceChangeEvent = {
        amount: deposit.amountDeltaWei,
        timestamp: deposit.timestamp,
        serialId: deposit.serialId,
      }
      accountToAssetToEventsMap[deposit.effectiveUser] = accountToAssetToEventsMap[deposit.effectiveUser] ?? {};
      if (accountToAssetToEventsMap[deposit.effectiveUser][deposit.marketId]) {
        accountToAssetToEventsMap[deposit.effectiveUser][deposit.marketId].push(event)
      } else {
        accountToAssetToEventsMap[deposit.effectiveUser][deposit.marketId] = [event];
      }
  })
}

export function parseWithdrawals(accountToAssetToEventsMap, withdrawals) {
  withdrawals.forEach((withdrawal) => {
      const event: BalanceChangeEvent = {
        amount: ZERO.minus(withdrawal.amountDeltaWei),
        timestamp: withdrawal.timestamp,
        serialId: withdrawal.serialId,
      }
      accountToAssetToEventsMap[withdrawal.effectiveUser] = accountToAssetToEventsMap[withdrawal.effectiveUser] ?? {};
      if (accountToAssetToEventsMap[withdrawal.effectiveUser][withdrawal.marketId]) {
        accountToAssetToEventsMap[withdrawal.effectiveUser][withdrawal.marketId].push(event)
      } else {
        accountToAssetToEventsMap[withdrawal.effectiveUser][withdrawal.marketId] = [event];
      }
  })
}