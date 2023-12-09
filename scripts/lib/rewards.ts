import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';
import { ONE_ETH_WEI } from '../../src/lib/constants';

export const ETH_USDC_POOL = '0xb77a493a4950cad1b049e222d62bce14ff423c6f'.toLowerCase();
export const ARB_VESTER_PROXY = '0x531BC6E97b65adF8B3683240bd594932Cfb63797'.toLowerCase();

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

export interface OArbFinalAmount {
  amount: string;
  proofs: string[];
}

export type VirtualLiquiditySnapshot = VirtualLiquiditySnapshotBalance;

// eslint-disable-next-line max-len
export type AccountSubAccountToMarketToBalanceMap = Record<string, Record<string, Record<string, BalanceAndRewardPoints | undefined> | undefined> | undefined>;
// eslint-disable-next-line max-len
export type AccountToSubAccountMarketToBalanceChangeMap = Record<string, Record<string, Record<string, BalanceChangeEvent[] | undefined> | undefined> | undefined>;
export type AccountToVirtualLiquidityBalanceMap = Record<string, BalanceAndRewardPoints | undefined>;
export type AccountToVirtualLiquiditySnapshotsMap = Record<string, VirtualLiquiditySnapshot[] | undefined>;

export interface VirtualLiquidityPosition {
  id: string;
  effectiveUser: string;
  balance: BigNumber;
}

interface VirtualLiquiditySnapshotBase {
  id: string;
  effectiveUser: string;
  timestamp: number;
}

export interface VirtualLiquiditySnapshotDeltaPar extends VirtualLiquiditySnapshotBase {
  deltaPar: BigNumber; // can be positive or negative
}

export interface VirtualLiquiditySnapshotBalance extends VirtualLiquiditySnapshotBase {
  balancePar: BigNumber; // the user's balance
}

export interface LiquidityPositionsAndEvents {
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap;
  virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap;
}

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

  processLiquiditySnapshot(liquiditySnapshot: VirtualLiquiditySnapshot): BigNumber {
    let rewardUpdate = new BigNumber(0);
    if (this.balance.gt(0)) {
      if (liquiditySnapshot.timestamp < this.lastUpdated) {
        throw new Error('Incorrect Event Order');
      }
      rewardUpdate = this.balance.times(liquiditySnapshot.timestamp - this.lastUpdated);
      this.rewardPoints = this.rewardPoints.plus(rewardUpdate);
    }
    this.balance = liquiditySnapshot.balancePar;
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
  poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents>,
  blockRewardStartTimestamp: number,
  blockRewardEndTimestamp: number,
): Record<string, BigNumber> {
  const poolToTotalLiquidityPoints: Record<string, BigNumber> = {};
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const { userToLiquiditySnapshots, virtualLiquidityBalances } = poolToVirtualLiquidityPositionsAndEvents[pool];
    poolToTotalLiquidityPoints[pool] = new BigNumber(0);

    Object.keys(userToLiquiditySnapshots).forEach(account => {
      userToLiquiditySnapshots[account]!.sort((a, b) => {
        return a.timestamp - b.timestamp;
      });
      virtualLiquidityBalances[account] = virtualLiquidityBalances[account] ?? new BalanceAndRewardPoints(
        blockRewardStartTimestamp,
        account,
        new BigNumber(0),
      );

      userToLiquiditySnapshots[account]!.forEach((liquiditySnapshot) => {
        poolToTotalLiquidityPoints[pool] = poolToTotalLiquidityPoints[pool].plus(
          virtualLiquidityBalances[account]!.processLiquiditySnapshot(liquiditySnapshot),
        );
      });
    });
  });

  // Iterate through balances to finish reward point calculation
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const { virtualLiquidityBalances } = poolToVirtualLiquidityPositionsAndEvents[pool];

    Object.keys(virtualLiquidityBalances).forEach(account => {
      const balanceStruct = virtualLiquidityBalances[account]!;
      const points = balanceStruct.processLiquiditySnapshot({
        id: '-1',
        effectiveUser: balanceStruct.effectiveUser,
        balancePar: balanceStruct.balance,
        timestamp: blockRewardEndTimestamp,
      });
      poolToTotalLiquidityPoints[pool] = poolToTotalLiquidityPoints[pool].plus(points);
    });
  });

  return poolToTotalLiquidityPoints;
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
  poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents>,
  totalPointsPerMarket: Record<number, BigNumber>,
  totalLiquidityPointsPerPool: Record<string, BigNumber>,
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
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const liquidityPoolReward = effectiveUserToOarbRewards[pool];
    if (liquidityPoolReward && totalLiquidityPointsPerPool[pool]) {
      const events = poolToVirtualLiquidityPositionsAndEvents[pool];
      Object.keys(events.virtualLiquidityBalances).forEach(account => {
        const balances = events.virtualLiquidityBalances[account]!;
        const rewardAmount = liquidityPoolReward.times(balances.rewardPoints.dividedBy(
          totalLiquidityPointsPerPool[pool],
        ));

        effectiveUserToOarbRewards[account] = effectiveUserToOarbRewards[account] ?? new BigNumber(0);
        effectiveUserToOarbRewards[account] = effectiveUserToOarbRewards[account].plus(rewardAmount);
      });
    }

    delete effectiveUserToOarbRewards[pool];
  });

  let filteredAmount = new BigNumber(0);
  const accounts = Object.keys(effectiveUserToOarbRewards);
  const finalizedRewardsMap = accounts.reduce<Record<string, BigNumber>>((map, account) => {
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
