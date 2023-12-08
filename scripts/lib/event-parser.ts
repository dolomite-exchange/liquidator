import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import {
  getDeposits,
  getLiquidations,
  getLiquidityMiningVestingPositions,
  getLiquidityPositions,
  getLiquiditySnapshots,
  getTrades,
  getTransfers,
  getVestingPositionTransfers,
  getWithdrawals,
} from '../../src/clients/dolomite';
import { ApiAccount, ApiDeposit, ApiLiquidation, ApiTrade, ApiTransfer, ApiWithdrawal } from '../../src/lib/api-types';
import Pageable from '../../src/lib/pageable';
import {
  AccountSubAccountToMarketToBalanceMap,
  AccountToSubAccountMarketToBalanceChangeMap,
  AccountToVirtualLiquidityBalanceMap,
  AccountToVirtualLiquiditySnapshotsMap,
  BalanceAndRewardPoints,
  BalanceChangeEvent,
  BalanceChangeType,
  LiquidityPositionsAndEvents,
  VirtualLiquidityPosition,
  VirtualLiquiditySnapshotBalance,
  VirtualLiquiditySnapshotDeltaPar,
} from './rewards';

const ZERO = new BigNumber('0');
export const VESTING_ACCOUNT_NUMBER = '999';

export function getAccountBalancesByMarket(
  accounts: ApiAccount[],
  blockRewardStartTimestamp: number,
): AccountSubAccountToMarketToBalanceMap {
  const accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap = {};
  accounts.forEach(account => {
    const accountOwner = account.owner;
    const accountNumber = account.number.toString();
    accountToDolomiteBalanceMap[accountOwner] = accountToDolomiteBalanceMap[accountOwner] ?? {};
    accountToDolomiteBalanceMap[accountOwner]![accountNumber]
      = accountToDolomiteBalanceMap[accountOwner]![accountNumber] ?? {};

    Object.values(account.balances).forEach(balance => {
      accountToDolomiteBalanceMap[accountOwner]![accountNumber]![balance.marketId] = new BalanceAndRewardPoints(
        blockRewardStartTimestamp,
        account.effectiveUser,
        balance.par.dividedBy(new BigNumber(10).pow(balance.tokenDecimals)),
      );
    });
  });
  return accountToDolomiteBalanceMap;
}

// export async function addLiquidityMiningVestingPositions(
//   accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap,
//   blockRewardStart: number,
// ): Promise<void> {
//   const liquidityMiningVestingPositions = await Pageable.getPageableValues((async (lastIndex) => {
//     const result = await getLiquidityMiningVestingPositions(blockRewardStart, lastIndex);
//     return result.liquidityMiningVestingPositions;
//   }));
//
//   parseLiquidityMiningVestingPositions(accountToDolomiteBalanceMap, liquidityMiningVestingPositions);
// }

export async function getBalanceChangingEvents(
  rewardsStartBlockNumber: number,
  rewardsEndBlockNumber: number,
): Promise<AccountToSubAccountMarketToBalanceChangeMap> {
  const accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap = {};

  const deposits = await Pageable.getPageableValues((async (lastId) => {
    const results = await getDeposits(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.deposits;
  }));
  parseDeposits(accountToAssetToEventsMap, deposits);

  const withdrawals = await Pageable.getPageableValues((async (lastId) => {
    const results = await getWithdrawals(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.withdrawals;
  }));
  parseWithdrawals(accountToAssetToEventsMap, withdrawals);

  const transfers = await Pageable.getPageableValues((async (lastId) => {
    const results = await getTransfers(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.transfers;
  }));
  parseTransfers(accountToAssetToEventsMap, transfers);

  const trades = await Pageable.getPageableValues((async (lastId) => {
    const results = await getTrades(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.trades;
  }));
  parseTrades(accountToAssetToEventsMap, trades);

  const liquidations = await Pageable.getPageableValues((async (lastId) => {
    const results = await getLiquidations(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.liquidations;
  }));
  parseLiquidations(accountToAssetToEventsMap, liquidations);

  return accountToAssetToEventsMap;
}

type VirtualLiquiditySnapshotInternal = VirtualLiquiditySnapshotBalance | VirtualLiquiditySnapshotDeltaPar;

export async function getAmmLiquidityPositionAndEvents(
  rewardsStartBlockNumber: number,
  blockRewardStartTimestamp: number,
  blockRewardEndTimestamp: number,
): Promise<LiquidityPositionsAndEvents> {
  const virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {};
  const userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap = {};
  const virtualLiquidityPositions = await Pageable.getPageableValues<VirtualLiquidityPosition>((async (lastId) => {
    const results = await getLiquidityPositions(rewardsStartBlockNumber - 1, lastId);
    return results.ammLiquidityPositions.map(position => ({
      id: position.id,
      effectiveUser: position.effectiveUser,
      balance: new BigNumber(position.balance),
    }));
  }));
  parseVirtualLiquidityPositions(
    virtualLiquidityBalances,
    virtualLiquidityPositions,
    blockRewardStartTimestamp,
  );

  const ammLiquiditySnapshots = await Pageable.getPageableValues<VirtualLiquiditySnapshotInternal>((async (lastId) => {
    const { snapshots } = await getLiquiditySnapshots(blockRewardStartTimestamp, blockRewardEndTimestamp, lastId);
    return snapshots.map<VirtualLiquiditySnapshotInternal>(snapshot => ({
      id: snapshot.id,
      effectiveUser: snapshot.effectiveUser,
      timestamp: parseInt(snapshot.timestamp, 10),
      balancePar: new BigNumber(snapshot.liquidityTokenBalance),
    }));
  }));
  parseVirtualLiquiditySnapshots(userToLiquiditySnapshots, ammLiquiditySnapshots, virtualLiquidityBalances);

  return { virtualLiquidityBalances, userToLiquiditySnapshots };
}

export async function getArbVestingLiquidityPositionAndEvents(
  rewardsStartBlockNumber: number,
  blockRewardStartTimestamp: number,
  blockRewardEndTimestamp: number,
): Promise<LiquidityPositionsAndEvents> {
  const virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {};
  const userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap = {};
  const vestingPositions = await Pageable.getPageableValues<VirtualLiquidityPosition>((async (lastId) => {
    const results = await getLiquidityMiningVestingPositions(rewardsStartBlockNumber - 1, lastId);
    return results.liquidityMiningVestingPositions.map<VirtualLiquidityPosition>(position => ({
      id: position.id,
      effectiveUser: position.effectiveUser,
      balance: new BigNumber(position.amountPar),
    }));
  }));
  parseVirtualLiquidityPositions(
    virtualLiquidityBalances,
    vestingPositions,
    blockRewardStartTimestamp,
  );

  const vestingPositionSnapshots = await Pageable.getPageableValues<VirtualLiquiditySnapshotInternal>(
    (async (lastId) => {
      const { vestingPositionTransfers } = await getVestingPositionTransfers(
        blockRewardStartTimestamp,
        blockRewardEndTimestamp,
        lastId,
      );
      return vestingPositionTransfers.reduce<VirtualLiquiditySnapshotInternal[]>((acc, transfer) => {
        let transfers: VirtualLiquiditySnapshotInternal[] = [];
        if (transfer.fromEffectiveUser) {
          transfers = transfers.concat({
            id: transfer.id,
            effectiveUser: transfer.fromEffectiveUser,
            timestamp: transfer.timestamp,
            deltaPar: ZERO.minus(transfer.amount),
          });
        }
        if (transfer.toEffectiveUser) {
          transfers = transfers.concat({
            id: transfer.id,
            effectiveUser: transfer.toEffectiveUser,
            timestamp: transfer.timestamp,
            deltaPar: transfer.amount,
          });
        }
        return acc.concat(transfers)
      }, []);
    }),
  );
  parseVirtualLiquiditySnapshots(userToLiquiditySnapshots, vestingPositionSnapshots, virtualLiquidityBalances);

  return { virtualLiquidityBalances, userToLiquiditySnapshots };
}

export function parseDeposits(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  deposits: ApiDeposit[],
): void {
  deposits.forEach((deposit) => {
    const event: BalanceChangeEvent = {
      amountDeltaPar: deposit.amountDeltaPar,
      timestamp: deposit.timestamp,
      serialId: deposit.serialId,
      effectiveUser: deposit.effectiveUser,
      type: BalanceChangeType.DEPOSIT,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      deposit.marginAccount.user,
      deposit.marginAccount.accountNumber,
      deposit.marketId,
      event,
    );
  });
}

export function parseWithdrawals(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  withdrawals: ApiWithdrawal[],
): void {
  withdrawals.forEach(withdrawal => {
    const event: BalanceChangeEvent = {
      amountDeltaPar: withdrawal.amountDeltaPar,
      timestamp: withdrawal.timestamp,
      serialId: withdrawal.serialId,
      effectiveUser: withdrawal.effectiveUser,
      type: BalanceChangeType.WITHDRAW,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      withdrawal.marginAccount.user,
      withdrawal.marginAccount.accountNumber,
      withdrawal.marketId,
      event,
    );
  });
}

export function parseTransfers(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  transfers: ApiTransfer[],
): void {
  transfers.forEach(transfer => {
    const fromEvent: BalanceChangeEvent = {
      amountDeltaPar: transfer.fromAmountDeltaPar,
      timestamp: transfer.timestamp,
      serialId: transfer.serialId,
      effectiveUser: transfer.fromEffectiveUser,
      type: BalanceChangeType.TRANSFER,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      transfer.fromMarginAccount.user,
      transfer.fromMarginAccount.accountNumber,
      transfer.marketId,
      fromEvent,
    );

    const toEvent: BalanceChangeEvent = {
      amountDeltaPar: transfer.toAmountDeltaPar,
      timestamp: transfer.timestamp,
      serialId: transfer.serialId,
      effectiveUser: transfer.toEffectiveUser,
      type: BalanceChangeType.TRANSFER,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      transfer.toMarginAccount.user,
      transfer.toMarginAccount.accountNumber,
      transfer.marketId,
      toEvent,
    );
  });
}

export function parseTrades(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  trades: ApiTrade[],
): void {
  trades.forEach(trade => {
    accountToAssetToEventsMap[trade.takerEffectiveUser] = accountToAssetToEventsMap[trade.takerEffectiveUser] ?? {};

    // Taker events
    const takerEventMinus: BalanceChangeEvent = {
      amountDeltaPar: trade.takerInputTokenDeltaPar,
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.takerEffectiveUser,
      type: BalanceChangeType.TRADE,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.takerMarginAccount.user,
      trade.takerMarginAccount.accountNumber,
      trade.takerMarketId,
      takerEventMinus,
    );
    const takerEventPlus: BalanceChangeEvent = {
      amountDeltaPar: trade.takerOutputTokenDeltaPar,
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.takerEffectiveUser,
      type: BalanceChangeType.TRADE,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.takerMarginAccount.user,
      trade.takerMarginAccount.accountNumber,
      trade.makerMarketId,
      takerEventPlus,
    );

    // Add maker events
    if (!trade.makerEffectiveUser || !trade.makerMarginAccount) {
      return;
    }
    const makerEventMinus: BalanceChangeEvent = {
      amountDeltaPar: ZERO.minus(trade.takerOutputTokenDeltaPar),
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.makerEffectiveUser,
      type: BalanceChangeType.TRADE,
    };

    addEventToUser(
      accountToAssetToEventsMap,
      trade.makerMarginAccount.user,
      trade.makerMarginAccount.accountNumber,
      trade.makerMarketId,
      makerEventMinus,
    );
    const makerEventPlus: BalanceChangeEvent = {
      amountDeltaPar: ZERO.minus(trade.takerInputTokenDeltaPar),
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.makerEffectiveUser,
      type: BalanceChangeType.TRADE,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.makerMarginAccount.user,
      trade.makerMarginAccount.accountNumber,
      trade.takerMarketId,
      makerEventPlus,
    );
  });
}

export function parseLiquidations(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  liquidations: ApiLiquidation[],
): void {
  liquidations.forEach(liquidation => {
    const liquidUserCollateralEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.liquidHeldTokenAmountDeltaPar,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.liquidEffectiveUser,
      type: BalanceChangeType.LIQUIDATION,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.liquidMarginAccount.user,
      liquidation.liquidMarginAccount.accountNumber,
      liquidation.heldMarketId,
      liquidUserCollateralEvent,
    );

    const liquidUserDebtEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.liquidBorrowedTokenAmountDeltaPar,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.liquidEffectiveUser,
      type: BalanceChangeType.LIQUIDATION,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.liquidMarginAccount.user,
      liquidation.liquidMarginAccount.accountNumber,
      liquidation.borrowedMarketId,
      liquidUserDebtEvent,
    );

    const solidUserCollateralEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.solidHeldTokenAmountDeltaPar,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.solidEffectiveUser,
      type: BalanceChangeType.LIQUIDATION,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.solidMarginAccount.user,
      liquidation.solidMarginAccount.accountNumber,
      liquidation.heldMarketId,
      solidUserCollateralEvent,
    );

    const solidUserDebtEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.solidBorrowedTokenAmountDeltaPar,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.solidEffectiveUser,
      type: BalanceChangeType.LIQUIDATION,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.solidMarginAccount.user,
      liquidation.solidMarginAccount.accountNumber,
      liquidation.borrowedMarketId,
      solidUserDebtEvent,
    );
  });
}

export function parseVirtualLiquidityPositions(
  userToVirtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap,
  virtualLiquidityPositions: VirtualLiquidityPosition[],
  blockRewardStartTimestamp: number,
): void {
  virtualLiquidityPositions.forEach(position => {
    if (!userToVirtualLiquidityBalances[position.effectiveUser]) {
      userToVirtualLiquidityBalances[position.effectiveUser] = new BalanceAndRewardPoints(
        blockRewardStartTimestamp,
        position.effectiveUser,
        new BigNumber(position.balance),
      );
    } else {
      const balanceStruct = userToVirtualLiquidityBalances[position.effectiveUser]!;
      balanceStruct!.balance = balanceStruct.balance.plus(position.balance);
    }

    // if (!userToLiquiditySnapshots[virtualLiquidityPosition.effectiveUser]) {
    //   userToLiquiditySnapshots[virtualLiquidityPosition.effectiveUser] = [
    //     {
    //       id: '-1',
    //       effectiveUser: virtualLiquidityPosition.effectiveUser,
    //       timestamp: blockRewardStartTimestamp,
    //       balancePar: new BigNumber(virtualLiquidityPosition.balance),
    //     },
    //   ];
    // } else {
    //   const snapshot = userToLiquiditySnapshots[virtualLiquidityPosition.effectiveUser]![0];
    //   snapshot.balancePar = snapshot.balancePar.plus(virtualLiquidityPosition.balance);
    // }
  });
}

export function parseVirtualLiquiditySnapshots(
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap,
  virtualLiquiditySnapshots: VirtualLiquiditySnapshotInternal[],
  virtualLiquidityBalanceMap: AccountToVirtualLiquidityBalanceMap,
): void {
  virtualLiquiditySnapshots.forEach(snapshot => {
    addLiquiditySnapshotToUser(userToLiquiditySnapshots, snapshot.effectiveUser, snapshot, virtualLiquidityBalanceMap);
  });
}

function addLiquiditySnapshotToUser(
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap,
  user: string,
  liquiditySnapshot: VirtualLiquiditySnapshotInternal,
  virtualLiquidityBalanceMap: AccountToVirtualLiquidityBalanceMap,
): void {
  userToLiquiditySnapshots[user] = userToLiquiditySnapshots[user] ?? [];
  if ('balancePar' in liquiditySnapshot) {
    userToLiquiditySnapshots[user]!.push(liquiditySnapshot);
  } else if ('deltaPar' in liquiditySnapshot) {
    const userSnapshots = userToLiquiditySnapshots[user]!;
    let balanceParBefore: BigNumber;
    if (userSnapshots.length === 0 && virtualLiquidityBalanceMap[user]) {
      balanceParBefore = virtualLiquidityBalanceMap[user]!.balance;
    } else if (userSnapshots.length > 0) {
      balanceParBefore = userSnapshots[userSnapshots.length - 1].balancePar;
    } else {
      balanceParBefore = new BigNumber(0);
    }

    userToLiquiditySnapshots[user]!.push({
      id: liquiditySnapshot.id,
      effectiveUser: liquiditySnapshot.effectiveUser,
      timestamp: liquiditySnapshot.timestamp,
      balancePar: balanceParBefore.plus(liquiditySnapshot.deltaPar),
    });
  } else {
    throw new Error(`Invalid liquidity snapshot: ${JSON.stringify(liquiditySnapshot)}`);
  }
}

function addEventToUser(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  user: string,
  accountNumber: string,
  marketId: number,
  event: BalanceChangeEvent,
): void {
  accountToAssetToEventsMap[user] = accountToAssetToEventsMap[user] ?? {};
  accountToAssetToEventsMap[user]![accountNumber] = accountToAssetToEventsMap[user]![accountNumber] ?? {};
  if (accountToAssetToEventsMap[user]![accountNumber]![marketId]) {
    accountToAssetToEventsMap[user]![accountNumber]![marketId]!.push(event);
  } else {
    accountToAssetToEventsMap[user]![accountNumber]![marketId] = [event];
  }
}
