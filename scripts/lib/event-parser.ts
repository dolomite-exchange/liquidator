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
import {
  ApiAccount,
  ApiAmmLiquidityPosition,
  ApiAmmLiquiditySnapshot,
  ApiDeposit,
  ApiLiquidation,
  ApiLiquidityMiningVestingPosition,
  ApiTrade,
  ApiTransfer,
  ApiVestingPositionTransfer,
  ApiWithdrawal,
} from '../../src/lib/api-types';
import Pageable from '../../src/lib/pageable';
import {
  AccountSubAccountToMarketToBalanceMap,
  AccountToAmmLiquidityBalanceMap,
  AccountToAmmLiquiditySnapshotsMap,
  AccountToSubAccountMarketToBalanceChangeMap,
  BalanceAndRewardPoints,
  BalanceChangeEvent,
  BalanceChangeType,
  LiquiditySnapshot,
} from './rewards';

const ZERO = new BigNumber('0');
const ARB_MARKET_ID = 7;
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

export async function addLiquidityMiningVestingPositions(
  accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap,
  blockRewardStart: number,
): Promise<void> {
  const liquidityMiningVestingPositions = await Pageable.getPageableValues((async (lastIndex) => {
    const result = await getLiquidityMiningVestingPositions(blockRewardStart, lastIndex);
    return result.liquidityMiningVestingPositions;
  }));

  parseLiquidityMiningVestingPositions(accountToDolomiteBalanceMap, liquidityMiningVestingPositions);
}

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

  const vestingPositionTransfers = await Pageable.getPageableValues((async (lastId) => {
    const results = await getVestingPositionTransfers(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.vestingPositionTransfers;
  }));
  parseVestingPositionTransfers(accountToAssetToEventsMap, vestingPositionTransfers);

  const liquidations = await Pageable.getPageableValues((async (lastId) => {
    const results = await getLiquidations(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return results.liquidations;
  }));
  parseLiquidations(accountToAssetToEventsMap, liquidations);

  return accountToAssetToEventsMap;
}

export interface LiquidityPositionsAndEvents {
  userToLiquiditySnapshots: AccountToAmmLiquiditySnapshotsMap;
  ammLiquidityBalances: AccountToAmmLiquidityBalanceMap;
}

export async function getLiquidityPositionAndEvents(
  rewardsStartBlockNumber: number,
  rewardsEndBlockNumber: number,
  blockRewardStartTimestamp: number,
): Promise<LiquidityPositionsAndEvents> {
  const ammLiquidityBalances: AccountToAmmLiquidityBalanceMap = {};
  const ammLiquidityPositions = await Pageable.getPageableValues((async (lastId) => {
    const results = await getLiquidityPositions(rewardsStartBlockNumber, lastId);
    return results.ammLiquidityPositions;
  }));
  parseAmmLiquidityPositions(ammLiquidityBalances, ammLiquidityPositions, blockRewardStartTimestamp);

  const userToLiquiditySnapshots: AccountToAmmLiquiditySnapshotsMap = {};
  const ammLiquiditySnapshots = await Pageable.getPageableValues((async (lastId) => {
    const { snapshots } = await getLiquiditySnapshots(rewardsStartBlockNumber, rewardsEndBlockNumber, lastId);
    return snapshots;
  }));
  parseAmmLiquiditySnapshots(userToLiquiditySnapshots, ammLiquiditySnapshots);

  return { ammLiquidityBalances, userToLiquiditySnapshots };
}

export function parseLiquidityMiningVestingPositions(
  accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap,
  liquidityMiningVestingPositions: ApiLiquidityMiningVestingPosition[],
): void {
  liquidityMiningVestingPositions.forEach((liquidityMiningVestingPosition) => {
    accountToDolomiteBalanceMap[liquidityMiningVestingPosition.effectiveUser]
      = accountToDolomiteBalanceMap[liquidityMiningVestingPosition.effectiveUser] ?? {};
    accountToDolomiteBalanceMap[liquidityMiningVestingPosition.effectiveUser]![VESTING_ACCOUNT_NUMBER]
      = accountToDolomiteBalanceMap[liquidityMiningVestingPosition.effectiveUser]![VESTING_ACCOUNT_NUMBER] ?? {};

    // eslint-disable-next-line max-len
    const balanceAndPoints = accountToDolomiteBalanceMap[liquidityMiningVestingPosition.effectiveUser]![VESTING_ACCOUNT_NUMBER]![ARB_MARKET_ID];
    if (balanceAndPoints) {
      balanceAndPoints.balance = balanceAndPoints.balance.plus(liquidityMiningVestingPosition.amount);
    } else {
      accountToDolomiteBalanceMap[liquidityMiningVestingPosition.effectiveUser]![VESTING_ACCOUNT_NUMBER]![ARB_MARKET_ID]
        = new BalanceAndRewardPoints(
        0,
        liquidityMiningVestingPosition.effectiveUser,
        new BigNumber(liquidityMiningVestingPosition.amount),
      );
    }
  });
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
      liquidation.heldToken,
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
      liquidation.borrowedToken,
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
      liquidation.heldToken,
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
      liquidation.borrowedToken,
      solidUserDebtEvent,
    );
  });
}

export function parseVestingPositionTransfers(
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  vestingPositionTransfers: ApiVestingPositionTransfer[],
): void {
  vestingPositionTransfers.forEach(vestingPositionTransfer => {
    if (vestingPositionTransfer.fromEffectiveUser === vestingPositionTransfer.toEffectiveUser) {
      return;
    }
    const fromEvent: BalanceChangeEvent = {
      amountDeltaPar: ZERO.minus(vestingPositionTransfer.amount),
      serialId: vestingPositionTransfer.serialId,
      effectiveUser: vestingPositionTransfer.fromEffectiveUser,
      timestamp: vestingPositionTransfer.timestamp,
      type: BalanceChangeType.VESTING_POSITION_TRANSFER,
    };
    const toEvent: BalanceChangeEvent = {
      amountDeltaPar: vestingPositionTransfer.amount,
      serialId: vestingPositionTransfer.serialId,
      effectiveUser: vestingPositionTransfer.toEffectiveUser,
      timestamp: vestingPositionTransfer.timestamp,
      type: BalanceChangeType.VESTING_POSITION_TRANSFER,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      vestingPositionTransfer.fromEffectiveUser,
      VESTING_ACCOUNT_NUMBER,
      ARB_MARKET_ID,
      fromEvent,
    );
    addEventToUser(
      accountToAssetToEventsMap,
      vestingPositionTransfer.toEffectiveUser,
      VESTING_ACCOUNT_NUMBER,
      ARB_MARKET_ID,
      toEvent,
    );
  });
}

export function parseAmmLiquidityPositions(
  userToAmmLiquidityBalances: AccountToAmmLiquidityBalanceMap,
  ammLiquidityPositions: ApiAmmLiquidityPosition[],
  blockRewardStartTimestamp: number,
): void {
  ammLiquidityPositions.forEach(ammLiquidityPosition => {
    userToAmmLiquidityBalances[ammLiquidityPosition.effectiveUser] = new BalanceAndRewardPoints(
      blockRewardStartTimestamp,
      ammLiquidityPosition.effectiveUser,
      new BigNumber(ammLiquidityPosition.balance),
    );
  });
}

export function parseAmmLiquiditySnapshots(
  userToLiquiditySnapshots: AccountToAmmLiquiditySnapshotsMap,
  ammLiquiditySnapshots: ApiAmmLiquiditySnapshot[],
): void {
  ammLiquiditySnapshots.forEach(snapshot => {
    const liquiditySnapshot: LiquiditySnapshot = {
      timestamp: Number(snapshot.timestamp),
      balance: new BigNumber(snapshot.liquidityTokenBalance),
    };
    addLiquiditySnapshotToUser(userToLiquiditySnapshots, snapshot.effectiveUser, liquiditySnapshot);
  });
}

function addLiquiditySnapshotToUser(
  userToLiquiditySnapshots: AccountToAmmLiquiditySnapshotsMap,
  user: string,
  liquiditySnapshot: LiquiditySnapshot,
): void {
  userToLiquiditySnapshots[user] = userToLiquiditySnapshots[user] ?? [];
  userToLiquiditySnapshots[user]!.push(liquiditySnapshot);
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
