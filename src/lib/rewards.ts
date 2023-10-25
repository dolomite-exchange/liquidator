import { BigNumber } from "@dolomite-exchange/dolomite-margin";
import { ApiAccount } from "./api-types";
import Pageable from "./pageable";
import { getDeposits, getLiquidations, getLiquidityPositions, getLiquiditySnapshots, getTrades, getTransfers, getWithdrawals } from "../clients/dolomite";

const ZERO = new BigNumber('0');

export interface BalanceChangeEvent {
  amount: BigNumber;
  timestamp: number;
  serialId: number;
  type: string;
}

export interface LiquiditySnapshot {
  timestamp: number;
  balance: number;
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

  processEvent(event): BigNumber {
      let rewardUpdate = new BigNumber(0);
      if(this.balance.gt(0)) {
        if (event.timestamp < this.lastUpdated) {
          throw new Error('Incorrect Event Order');
        }
        rewardUpdate = this.balance.times(event.timestamp - this.lastUpdated);
        this.rewardPoints = this.rewardPoints.plus(rewardUpdate);
      }
      this.balance = this.balance.plus(event.amount);
      this.lastUpdated = event.timestamp;

      return rewardUpdate;
  }

  processLiquiditySnapshot(liquiditySnapshot): BigNumber {
      let rewardUpdate = new BigNumber(0);
      if(this.balance.gt(0)) {
        if (liquiditySnapshot.timestamp < this.lastUpdated) {
          throw new Error('Incorrect Event Order');
        }
        rewardUpdate = this.balance.times(liquiditySnapshot.timestamp - this.lastUpdated);
        this.rewardPoints = this.rewardPoints.plus(rewardUpdate);
      }
      this.balance = new BigNumber(liquiditySnapshot.balance);
      this.lastUpdated = liquiditySnapshot.timestamp;

      return rewardUpdate;
  }
}

export function getAccountBalancesByMarket(accounts: ApiAccount[], blockRewardStartTimestamp: number) {
  const accountToDolomiteBalanceMap: Record<string, Record<number, BalanceAndRewardPoints>> = {};
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    accountToDolomiteBalanceMap[account.owner] = accountToDolomiteBalanceMap[account.owner] ?? {};

    Object.values(account.balances)
      .forEach((balance) => {
        if (accountToDolomiteBalanceMap[account.owner][balance.marketId]) {
          accountToDolomiteBalanceMap[account.owner][balance.marketId].balance = accountToDolomiteBalanceMap[account.owner][balance.marketId].balance.plus(balance.par);
        }
        else {
          accountToDolomiteBalanceMap[account.owner][balance.marketId] = new BalanceAndRewardPoints(blockRewardStartTimestamp, balance.par);
        }
      });
  }
  return accountToDolomiteBalanceMap;
}

export function parseDeposits(accountToAssetToEventsMap, deposits) {
  deposits.forEach((deposit) => {
    const event: BalanceChangeEvent = {
      amount: deposit.amountDeltaWei,
      timestamp: deposit.timestamp,
      serialId: deposit.serialId,
      type: 'deposit'
    }
    addEventToUser(accountToAssetToEventsMap, deposit.effectiveUser, deposit.marketId, event);
  })
}

export function parseTransfers(accountToAssetToEventsMap, transfers) {
  transfers.forEach((transfer) => {
    if (transfer.fromEffectiveUser == transfer.toEffectiveUser) {
      return;
    }
    const fromEvent: BalanceChangeEvent = {
      amount: ZERO.minus(transfer.amountDeltaWei),
      timestamp: transfer.timestamp,
      serialId: transfer.serialId,
      type: 'transfer'
    };
    addEventToUser(accountToAssetToEventsMap, transfer.fromEffectiveUser, transfer.marketId, fromEvent);

    const toEvent: BalanceChangeEvent = {
      amount: transfer.amountDeltaWei,
      timestamp: transfer.timestamp,
      serialId: transfer.serialId,
      type: 'transfer'
    };
    addEventToUser(accountToAssetToEventsMap, transfer.toEffectiveUser, transfer.marketId, toEvent);
  });
}

export function parseLiquidations(accountToAssetToEventsMap, liquidations) {
  liquidations.forEach((liquidation) => {
    const liquidUserCollateralEvent: BalanceChangeEvent = {
      amount: ZERO.minus(liquidation.heldTokenAmountDeltaWei),
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      type: 'liquidation'
    };
    addEventToUser(accountToAssetToEventsMap, liquidation.liquidEffectiveUser, liquidation.heldToken, liquidUserCollateralEvent);

    const liquidUserDebtEvent: BalanceChangeEvent = {
      amount: liquidation.borrowedTokenAmountDeltaWei,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      type: 'liquidation'
    };
    addEventToUser(accountToAssetToEventsMap, liquidation.liquidEffectiveUser, liquidation.borrowedToken, liquidUserDebtEvent);

    const solidUserCollateralEvent: BalanceChangeEvent = {
      amount: liquidation.heldTokenLiquidationRewardWei,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      type: 'liquidation'
    }
    addEventToUser(accountToAssetToEventsMap, liquidation.solidEffectiveUser, liquidation.heldToken, solidUserCollateralEvent);

    const solidUserDebtEvent: BalanceChangeEvent = {
      amount: ZERO.minus(liquidation.borrowedTokenAmountDeltaWei),
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      type: 'liquidation'
    }
    addEventToUser(accountToAssetToEventsMap, liquidation.solidEffectiveUser, liquidation.borrowedToken, solidUserDebtEvent);
  });
}

export function parseTrades(accountToAssetToEventsMap, trades) {
  trades.forEach((trade) => {
    accountToAssetToEventsMap[trade.takerEffectiveUser] = accountToAssetToEventsMap[trade.takerEffectiveUser] ?? {};

    // Taker events
    const takerEventMinus: BalanceChangeEvent = {
        amount: ZERO.minus(trade.takerAmountDeltaWei),
        timestamp: trade.timestamp,
        serialId: trade.serialId,
        type: 'trade'
    };
    addEventToUser(accountToAssetToEventsMap, trade.takerEffectiveUser, trade.takerMarketId, takerEventMinus);
    const takerEventPlus: BalanceChangeEvent = {
        amount: trade.makerAmountDeltaWei,
        timestamp: trade.timestamp,
        serialId: trade.serialId,
        type: 'trade'
    };
    addEventToUser(accountToAssetToEventsMap, trade.takerEffectiveUser, trade.makerMarketId, takerEventPlus);

    // Add maker events
    if (!trade.makerEffectUser) {
      return;
    }
    const makerEventMinus: BalanceChangeEvent = {
        amount: ZERO.minus(trade.makerAmountDeltaWei),
        timestamp: trade.timestamp,
        serialId: trade.serialId,
        type: 'trade'
    };

    addEventToUser(accountToAssetToEventsMap, trade.makerEffectiveUser, trade.makerMarketId, makerEventMinus);
    const makerEventPlus: BalanceChangeEvent = {
        amount: trade.takerAmountDeltaWei,
        timestamp: trade.timestamp,
        serialId: trade.serialId,
        type: 'trade'
    };
    addEventToUser(accountToAssetToEventsMap, trade.makerEffectiveUser, trade.takerMarketId, makerEventPlus);
  });
}

export function parseWithdrawals(accountToAssetToEventsMap, withdrawals) {
  withdrawals.forEach((withdrawal) => {
    const event: BalanceChangeEvent = {
      amount: ZERO.minus(withdrawal.amountDeltaWei),
      timestamp: withdrawal.timestamp,
      serialId: withdrawal.serialId,
      type: 'withdrawal'
    }
    addEventToUser(accountToAssetToEventsMap, withdrawal.effectiveUser, withdrawal.marketId, event);
  });
}

export function parseAmmLiquidityPositions(ammLiquidityBalances, ammLiquidityPositions, blockRewardStartTimestamp) {
  ammLiquidityPositions.forEach((ammLiquidityPosition) => {
    ammLiquidityBalances[ammLiquidityPosition.effectiveUser] = new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber(ammLiquidityPosition.balance));
  });
}

export function parseAmmLiquiditySnapshots(userToLiquiditySnapshots, ammLiquiditySnapshots) {
  ammLiquiditySnapshots.forEach((snapshot) => {
    const liquiditySnapshot: LiquiditySnapshot = {
      timestamp: snapshot.timestamp,
      balance: snapshot.liquidityTokenBalance
    }
    addLiquiditySnapshotToUser(userToLiquiditySnapshots, snapshot.effectiveUser, liquiditySnapshot);
  });
}

function addEventToUser(accountToAssetToEventsMap, user, marketId, event) {
      accountToAssetToEventsMap[user] = accountToAssetToEventsMap[user] ?? {};
      if (accountToAssetToEventsMap[user][marketId]) {
        accountToAssetToEventsMap[user][marketId].push(event)
      } else {
        accountToAssetToEventsMap[user][marketId] = [event];
      }
}

function addLiquiditySnapshotToUser(userToLiquiditySnapshots, user, liquiditySnapshot) {
  userToLiquiditySnapshots[user] = userToLiquiditySnapshots[user] ?? [];
  userToLiquiditySnapshots[user].push(liquiditySnapshot);
}

export async function getBalanceChangingEvents(accountToAssetToEventsMap, blockRewardStart, blockRewardEnd) {
  const deposits = await Pageable.getPageableValues((async (lastIndex) => {
    const { deposits } = await getDeposits(blockRewardStart, blockRewardEnd, lastIndex);
    return deposits;
  }));
  parseDeposits(accountToAssetToEventsMap, deposits);

  const withdrawals = await Pageable.getPageableValues((async (lastIndex) => {
    const { withdrawals } = await getWithdrawals(blockRewardStart, blockRewardEnd, lastIndex);
    return withdrawals;
  }));
  parseWithdrawals(accountToAssetToEventsMap, withdrawals);

  const transfers = await Pageable.getPageableValues((async (lastIndex) => {
    const { transfers } = await getTransfers(blockRewardStart, blockRewardEnd, lastIndex);
    return transfers;
  }));
  parseTransfers(accountToAssetToEventsMap, transfers);

  const trades = await Pageable.getPageableValues((async (lastIndex) => {
    const { trades } = await getTrades(blockRewardStart, blockRewardEnd, lastIndex);
    return trades;
  }));
  parseTrades(accountToAssetToEventsMap, trades);

  const liquidations = await Pageable.getPageableValues((async (lastIndex) => {
    const { liquidations } = await getLiquidations(blockRewardStart, blockRewardEnd, lastIndex);
    return liquidations;
  }));
  parseLiquidations(accountToAssetToEventsMap, liquidations);

  return accountToAssetToEventsMap;
}

export async function getLiquidityPositionAndEvents(
  ammLiquidityBalances,
  userToLiquiditySnapshots,
  blockRewardStart,
  blockRewardEnd,
  blockRewardStartTimestamp
) {
  const ammLiquidityPositions = await Pageable.getPageableValues((async (lastIndex) => {
    const { ammLiquidityPositions } = await getLiquidityPositions(blockRewardStart, lastIndex);
    return ammLiquidityPositions;
  }));
  parseAmmLiquidityPositions(ammLiquidityBalances, ammLiquidityPositions, blockRewardStartTimestamp);

  const ammLiquiditySnapshots = await Pageable.getPageableValues((async (lastIndex) => {
    const { snapshots } = await getLiquiditySnapshots(blockRewardStart, blockRewardEnd, lastIndex);
    return snapshots;
  }));
  parseAmmLiquiditySnapshots(userToLiquiditySnapshots, ammLiquiditySnapshots);
}