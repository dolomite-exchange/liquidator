import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';
import { ONE_ETH_WEI } from '../../src/lib/constants';

const LIQUIDITY_POOLS = ['0xb77a493a4950cad1b049e222d62bce14ff423c6f'];
const blacklistedAddresses = process.env.BLACKLIST_ADDRESSES?.split(',') ?? []
const blacklistedAddressMap: Record<string, boolean> = blacklistedAddresses.reduce((map, address) => {
  if (!ethers.utils.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  map[address.toLowerCase()] = true;
  return map;
}, {})

export enum BalanceChangeType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRADE = 'trade',
  TRANSFER = 'transfer',
  VESTING_POSITION_TRANSFER = 'vesting_position_transfer',
  LIQUIDATION = 'liquidation',
  INITIALIZE = 'initialize',
}

export interface BalanceChangeEvent {
  amountDeltaPar: BigNumber;
  timestamp: number;
  serialId: number;
  effectiveUser: string;
  type: BalanceChangeType;
}

export interface LiquiditySnapshot {
  timestamp: number;
  balance: BigNumber;
}

export interface OArbFinalAmount {
  amount: string;
  proofs: string[];
}

// eslint-disable-next-line max-len
export type AccountSubAccountToMarketToBalanceMap = Record<string, Record<string, Record<string, BalanceAndRewardPoints | undefined> | undefined> | undefined>;
// eslint-disable-next-line max-len
export type AccountToSubAccountMarketToBalanceChangeMap = Record<string, Record<string, Record<string, BalanceChangeEvent[] | undefined> | undefined> | undefined>;
export type AccountToAmmLiquidityBalanceMap = Record<string, BalanceAndRewardPoints | undefined>;
export type AccountToAmmLiquiditySnapshotsMap = Record<string, LiquiditySnapshot[] | undefined>;

// const REWARD_MULTIPLIER = new BigNumber(10).pow(18);
const REWARD_MULTIPLIER = new BigNumber(1);

export class BalanceAndRewardPoints {
  effectiveUser: string;
  balance: BigNumber;
  rewardPoints: BigNumber;
  lastUpdated: number;

  constructor(timestamp: number, effectiveUser: string, balance: BigNumber = new BigNumber(0)) {
    this.effectiveUser = effectiveUser;
    this.balance = balance;
    this.rewardPoints = new BigNumber(0);
    this.lastUpdated = timestamp;
  }

  processEvent(event: BalanceChangeEvent): BigNumber {
    let pointsUpdate = new BigNumber(0);
    if (this.balance.gt(0)) {
      if (event.timestamp < this.lastUpdated) {
        throw new Error('Incorrect Event Order');
      }
      pointsUpdate = this.balance.times(new BigNumber(event.timestamp - this.lastUpdated).times(REWARD_MULTIPLIER));
      this.rewardPoints = this.rewardPoints.plus(pointsUpdate);
    }
    this.balance = this.balance.plus(event.amountDeltaPar);
    this.lastUpdated = event.timestamp;

    return pointsUpdate;
  }

  processLiquiditySnapshot(liquiditySnapshot: LiquiditySnapshot): BigNumber {
    let rewardUpdate = new BigNumber(0);
    if (this.balance.gt(0)) {
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

export function calculateTotalRewardPoints(
  accountInfoToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap,
  accountToAssetToEventsMap: AccountToSubAccountMarketToBalanceChangeMap,
  blockRewardStartTimestamp: number,
  blockRewardEndTimestamp: number,
): Record<number, BigNumber> {
  const totalPointsPerMarket: Record<number, BigNumber> = {};
  Object.keys(accountToAssetToEventsMap).forEach(account => {
    if (!blacklistedAddressMap[account.toLowerCase()]) {
      Object.keys(accountToAssetToEventsMap[account]!).forEach(subAccount => {
        // Make sure user => subAccount ==> market => balance record exists
        if (!accountInfoToDolomiteBalanceMap[account]) {
          accountInfoToDolomiteBalanceMap[account] = {};
        }
        if (!accountInfoToDolomiteBalanceMap[account]![subAccount]) {
          accountInfoToDolomiteBalanceMap[account]![subAccount] = {};
        }
        Object.keys(accountToAssetToEventsMap[account]![subAccount]!).forEach(market => {
          if (!accountInfoToDolomiteBalanceMap[account]![subAccount]![market]) {
            accountInfoToDolomiteBalanceMap[account]![subAccount]![market] = new BalanceAndRewardPoints(
              blockRewardStartTimestamp,
              accountToAssetToEventsMap[account]![subAccount]![market]![0]?.effectiveUser,
            );
          }
          totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

          // Sort and process events
          accountToAssetToEventsMap[account]![subAccount]![market]!.sort((a, b) => {
            return a.serialId - b.serialId;
          });
          const userBalanceStruct = accountInfoToDolomiteBalanceMap[account]![subAccount]![market]!;
          accountToAssetToEventsMap[account]![subAccount]![market]!.forEach(event => {
            if (userBalanceStruct.effectiveUser !== event.effectiveUser) {
              throw new Error('Effective user mismatch!');
            }
            const rewardUpdate = userBalanceStruct.processEvent(event);
            totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(rewardUpdate);
          });
          if (userBalanceStruct.balance.eq(0) && userBalanceStruct.rewardPoints.eq(0)) {
            delete accountInfoToDolomiteBalanceMap[account]![subAccount]![market];
          }
        });
        if (Object.keys(accountInfoToDolomiteBalanceMap[account]![subAccount]!).length === 0) {
          delete accountInfoToDolomiteBalanceMap[account]![subAccount];
        }
      });
      if (
        accountInfoToDolomiteBalanceMap[account]
        && Object.keys(accountInfoToDolomiteBalanceMap[account]!).length === 0
      ) {
        delete accountInfoToDolomiteBalanceMap[account];
      }
    }
  });

  // Do final loop through all balances to finish reward point calculation
  Object.keys(accountInfoToDolomiteBalanceMap).forEach(account => {
    if (!blacklistedAddressMap[account.toLowerCase()]) {
      Object.keys(accountInfoToDolomiteBalanceMap[account]!).forEach(subAccount => {
        Object.keys(accountInfoToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
          totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

          const userBalanceStruct = accountInfoToDolomiteBalanceMap[account]![subAccount]![market]!;
          const rewardUpdate = userBalanceStruct.processEvent({
            amountDeltaPar: new BigNumber(0),
            timestamp: blockRewardEndTimestamp,
            serialId: 0,
            effectiveUser: userBalanceStruct.effectiveUser,
            type: BalanceChangeType.INITIALIZE,
          })
          totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(rewardUpdate);
        });
      });
    }
  });

  return totalPointsPerMarket;
}

export function calculateLiquidityPoints(
  ammLiquidityBalances: AccountToAmmLiquidityBalanceMap,
  userToLiquiditySnapshots: AccountToAmmLiquiditySnapshotsMap,
  blockRewardStartTimestamp: number,
  blockRewardEndTimestamp: number,
): BigNumber {
  let totalLiquidityPoints = new BigNumber(0);
  Object.keys(userToLiquiditySnapshots).forEach(account => {
    userToLiquiditySnapshots[account]!.sort((a, b) => {
      return a.timestamp - b.timestamp;
    });
    ammLiquidityBalances[account] = ammLiquidityBalances[account] ?? new BalanceAndRewardPoints(
      blockRewardStartTimestamp,
      account,
      new BigNumber(0),
    );

    userToLiquiditySnapshots[account]!.forEach((liquiditySnapshot) => {
      totalLiquidityPoints = totalLiquidityPoints.plus(
        ammLiquidityBalances[account]!.processLiquiditySnapshot(liquiditySnapshot),
      );
    });
  });

  Object.keys(ammLiquidityBalances).forEach(account => {
    const balanceStruct = ammLiquidityBalances[account]!;
    const rewardUpdate = balanceStruct.balance.times(blockRewardEndTimestamp - balanceStruct.lastUpdated);

    totalLiquidityPoints = totalLiquidityPoints.plus(rewardUpdate);
    balanceStruct.rewardPoints = balanceStruct.rewardPoints.plus(rewardUpdate);
    balanceStruct.lastUpdated = blockRewardEndTimestamp;
  });

  return totalLiquidityPoints;
}

export function calculateFinalPoints(
  accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap,
  validMarketId: number,
): Record<string, string> {
  const effectiveUserToPoints: Record<string, BigNumber> = {};
  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
      Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
        if (market === validMarketId.toString()) {
          const pointsStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;

          if (!effectiveUserToPoints[pointsStruct.effectiveUser]) {
            effectiveUserToPoints[pointsStruct.effectiveUser] = new BigNumber(0);
          }
          effectiveUserToPoints[pointsStruct.effectiveUser]
            = effectiveUserToPoints[pointsStruct.effectiveUser].plus(pointsStruct.rewardPoints);
        }
      });
    });
  });

  return Object.keys(effectiveUserToPoints).reduce<Record<string, string>>((map, account) => {
    map[account] = effectiveUserToPoints[account].multipliedBy(ONE_ETH_WEI).toFixed(0);
    return map;
  }, {});
}

export function calculateFinalRewards(
  accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap,
  ammLiquidityBalances: AccountToAmmLiquidityBalanceMap,
  totalPointsPerMarket: Record<number, BigNumber>,
  totalLiquidityPoints: BigNumber,
  oArbRewardMap: Record<number, BigNumber | undefined>,
  minimumOArbAmount: BigNumber,
): Record<string, BigNumber> {
  const effectiveUserToOarbRewards: Record<string, BigNumber> = {};
  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
      Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
        const rewards = oArbRewardMap[market];
        if (rewards) {
          const points = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
          const oarbReward = rewards.times(points.rewardPoints).dividedBy(totalPointsPerMarket[market]);

          if (!effectiveUserToOarbRewards[points.effectiveUser]) {
            effectiveUserToOarbRewards[points.effectiveUser] = new BigNumber(0);
          }
          effectiveUserToOarbRewards[points.effectiveUser] = effectiveUserToOarbRewards[points.effectiveUser].plus(
            oarbReward,
          );
        }
      });
    });
  });

  // Distribute liquidity pool rewards
  LIQUIDITY_POOLS.forEach(pool => {
    const liquidityPoolReward = effectiveUserToOarbRewards[pool];
    Object.keys(ammLiquidityBalances).forEach(account => {
      effectiveUserToOarbRewards[account] = effectiveUserToOarbRewards[account] ?? new BigNumber(0);
      const rewardAmount = liquidityPoolReward.times(ammLiquidityBalances[account]!.rewardPoints.dividedBy(
        totalLiquidityPoints,
      ));

      effectiveUserToOarbRewards[account] = effectiveUserToOarbRewards[account].plus(rewardAmount);
      effectiveUserToOarbRewards[pool] = effectiveUserToOarbRewards[pool].minus(rewardAmount);
    });
  });

  let filteredAmount = new BigNumber(0);
  const finalizedRewardsMap = Object.keys(effectiveUserToOarbRewards)
    .reduce<Record<string, BigNumber>>((map, account) => {
    if (effectiveUserToOarbRewards[account].gte(minimumOArbAmount)) {
      map[account] = effectiveUserToOarbRewards[account];
    } else {
      filteredAmount = filteredAmount.plus(effectiveUserToOarbRewards[account]);
    }
    return map;
  }, {});

  console.log('OARB amount filtered out:', filteredAmount.dividedBy('1000000000000000000').toFixed(2));

  return finalizedRewardsMap;
}

export interface MerkleRootAndProofs {
  merkleRoot: string;
  walletAddressToLeavesMap: Record<string, OArbFinalAmount>; // wallet ==> proofs + amounts
}

export function calculateMerkleRootAndProofs(userToOArbRewards: Record<string, BigNumber>): MerkleRootAndProofs {
  const walletAddressToFinalDataMap: Record<string, OArbFinalAmount> = {};
  const leaves: string[] = [];
  const userAccounts = Object.keys(userToOArbRewards);
  userAccounts.forEach(account => {
    const amount = userToOArbRewards[account].toFixed(0);
    const leaf = keccak256(
      defaultAbiCoder.encode(
        ['address', 'uint256'],
        [account, amount],
      ),
    );
    walletAddressToFinalDataMap[account.toLowerCase()] = {
      amount,
      proofs: [leaf], // this will get overwritten once the tree is created
    };
    leaves.push(leaf);
  });

  const tree = new MerkleTree(leaves, keccak256, { sort: true });
  const merkleRoot = tree.getHexRoot();

  userAccounts.forEach(account => {
    const finalData = walletAddressToFinalDataMap[account.toLowerCase()];
    finalData.proofs = tree.getHexProof(finalData.proofs[0]);
  });

  return { merkleRoot, walletAddressToLeavesMap: walletAddressToFinalDataMap };
}
