import { BigNumber } from "@dolomite-exchange/dolomite-margin";

const LIQUIDITY_POOL = '0xb77a493a4950cad1b049e222d62bce14ff423c6f';
const blacklistedAddresses = [
 '0x1234493a4950cad1b049e222d62bce14ff423c00'
];

const OARB_REWARD_AMOUNT = {
  '0': new BigNumber(10000),
  '1': new BigNumber(10000),
  '2': new BigNumber(10000),
  '3': new BigNumber(10000),
  '4': new BigNumber(10000),
  '5': new BigNumber(10000),
  '6': new BigNumber(10000),
  '7': new BigNumber(10000),
  '8': new BigNumber(10000),
  '9': new BigNumber(10000),
  '10': new BigNumber(10000),
  '11': new BigNumber(10000),
  '12': new BigNumber(10000),
  '13': new BigNumber(10000),
  '14': new BigNumber(10000),
  '15': new BigNumber(10000),
  '16': new BigNumber(10000),
  '17': new BigNumber(10000),
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

export function calculateRewardPoints(
  accountToDolomiteBalanceMap,
  accountToAssetToEventsMap,
  blockRewardStartTimestamp,
  blockRewardEndTimestamp
) {
  let totalPointsPerMarket = {};
  for (const account in accountToAssetToEventsMap) {
    if (blacklistedAddresses.includes(account)) continue;
    for (const market in accountToAssetToEventsMap[account]) {

      // Make sure user => market => balance record exists
      if(!accountToDolomiteBalanceMap[account]) {
        accountToDolomiteBalanceMap[account] = {};
      }
      if (!accountToDolomiteBalanceMap[account][market]) {
          accountToDolomiteBalanceMap[account][market] = new BalanceAndRewardPoints(blockRewardStartTimestamp);
      }
      totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

      // Sort and process events
      accountToAssetToEventsMap[account][market].sort((a,b) => {
        return a.serialId - b.serialId;
      });
      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      accountToAssetToEventsMap[account][market].forEach((event) => {
        const rewardUpdate = userBalStruct.processEvent(event);
        totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(rewardUpdate);
      });
    }
  }

  // Do final loop through all balances to finish reward point calculation
  for (const account in accountToDolomiteBalanceMap) {
    if (blacklistedAddresses.includes(account)) continue;
    for (const market in accountToDolomiteBalanceMap[account]) {
      totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      const rewardUpdate = userBalStruct.processEvent({ amount: new BigNumber(0), timestamp: blockRewardEndTimestamp, serialId: 0})
      totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(rewardUpdate);
    }
  }

  return totalPointsPerMarket;
}

export function calculateLiquidityPoints(
  ammLiquidityBalances,
  userToLiquiditySnapshots,
  blockRewardStartTimestamp,
  blockRewardEndTimestamp
) {
  let totalLiquidityPoints = new BigNumber(0);
  for (const account in userToLiquiditySnapshots) {
    userToLiquiditySnapshots[account].sort((a,b) => {
      return a.timestamp - b.timestamp;
    });
    ammLiquidityBalances[account] = ammLiquidityBalances[account] ?? new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber(0));

    userToLiquiditySnapshots[account].forEach((liquiditySnapshot) => {
      totalLiquidityPoints = totalLiquidityPoints.plus(ammLiquidityBalances[account].processLiquiditySnapshot(liquiditySnapshot));
    });
  }

  for (const account in ammLiquidityBalances) {
    const user = ammLiquidityBalances[account];
    const rewardUpdate = user.balance.times(blockRewardEndTimestamp - user.lastUpdated);

    totalLiquidityPoints = totalLiquidityPoints.plus(rewardUpdate);
    user.rewardPoints = user.rewardPoints.plus(rewardUpdate);
    user.lastUpdated = blockRewardEndTimestamp;
  }

  return totalLiquidityPoints;
}

export function calculateFinalRewards(
  accountToDolomiteBalanceMap,
  ammLiquidityBalances,
  totalPointsPerMarket,
  totalLiquidityPoints
) {
  const userToOarbRewards = {};
  for (const account in accountToDolomiteBalanceMap) {
    userToOarbRewards[account] = userToOarbRewards[account] ?? new BigNumber(0);
    for (const market in accountToDolomiteBalanceMap[account]) {
      const user = accountToDolomiteBalanceMap[account];
      const oarbReward = OARB_REWARD_AMOUNT[market].times(user[market].rewardPoints).dividedBy(totalPointsPerMarket[market]);

      userToOarbRewards[account] = userToOarbRewards[account].plus(oarbReward);
    }
  }

  // Distribute liquidity pool rewards
  const liquidityPoolReward = userToOarbRewards[LIQUIDITY_POOL];
  for (const account in ammLiquidityBalances) {
    userToOarbRewards[account] = userToOarbRewards[account] ?? new BigNumber(0);
    const rewardAmount = liquidityPoolReward.times(ammLiquidityBalances[account].rewardPoints.dividedBy(totalLiquidityPoints));

    userToOarbRewards[account] = userToOarbRewards[account].plus(rewardAmount);
    userToOarbRewards[LIQUIDITY_POOL] = userToOarbRewards[LIQUIDITY_POOL].minus(rewardAmount);
  }

  return userToOarbRewards;
}
