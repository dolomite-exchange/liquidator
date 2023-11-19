import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { defaultAbiCoder, keccak256, parseEther } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';
import {
  AccountSubAccountToMarketToBalanceMap,
  AccountToAmmLiquiditySnapshotsMap,
  BalanceAndRewardPoints,
  BalanceChangeEvent,
  BalanceChangeType,
  calculateFinalRewards,
  calculateLiquidityPoints,
  calculateTotalRewardPoints,
} from '../../scripts/lib/rewards';
import liquidityMiningConfig from '../../scripts/config/oarb-season-0.json';

const blockRewardStartTimestamp = 1697000000;
const blockRewardEndTimestamp = 1698000000;
const timeLength = 1000000;
const LIQUIDITY_POOL = '0xb77a493a4950cad1b049e222d62bce14ff423c6f';

const user1 = '0x0321be949876c2545ac121379c620c2a0480b758';
const user2 = '0x1702acf734116cd8faf86d139aa91843f81510a1';
const user3 = '0x0354aecd8fadcfc7411e26820c4973510246c383';
const user4 = '0x7a5fe89a0350bcda945ed1e6f2be126b33472418';
const user5 = '0x815ac0ccf85bab38b1953a008f80bb028bfc317a';
const user6 = '0x91d6bf11608ed2dd40f44a95f3ef222840746577';
const user7 = '0x92fba06462b4e5a7c3febeaf8b81a506d5242843';

const subAccount1 = 3;

const DEPOSIT_EVENT: BalanceChangeEvent = {
  amountDeltaPar: new BigNumber(20),
  timestamp: 10,
  serialId: 1,
  effectiveUser: user1,
  type: BalanceChangeType.DEPOSIT,
};

const WITHDRAWAL_EVENT: BalanceChangeEvent = {
  amountDeltaPar: new BigNumber(-10),
  timestamp: 15,
  serialId: 2,
  effectiveUser: user1,
  type: BalanceChangeType.WITHDRAW,
};

const FINAL_EVENT: BalanceChangeEvent = {
  amountDeltaPar: new BigNumber(0),
  timestamp: 20,
  serialId: 0,
  effectiveUser: user1,
  type: BalanceChangeType.INITIALIZE,
};

const accountToDolomiteBalanceMap: AccountSubAccountToMarketToBalanceMap = {
  [user1]: {
    [subAccount1]: {
      17: new BalanceAndRewardPoints(blockRewardStartTimestamp, user1, new BigNumber('100000000')),
    },
  },
  [user2]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(blockRewardStartTimestamp, user2, new BigNumber('500000000000000000')),
      17: new BalanceAndRewardPoints(blockRewardStartTimestamp, user2, new BigNumber('100000000')),
    },
  },
  [user3]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(blockRewardStartTimestamp, user3, new BigNumber('500000000000000000')),
    },
  },
  [user4]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(blockRewardStartTimestamp, user4, new BigNumber('500000000000000000')),
      17: new BalanceAndRewardPoints(blockRewardStartTimestamp, user4, new BigNumber('-3000000')),
    },
  },
  [user5]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(blockRewardStartTimestamp, user5, new BigNumber('200000000000000000')),
      17: new BalanceAndRewardPoints(blockRewardStartTimestamp, user5, new BigNumber('300000000')),
    },
  },
  [user6]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(blockRewardStartTimestamp, user6, new BigNumber('300000000000000000')),
      17: new BalanceAndRewardPoints(blockRewardStartTimestamp, user6, new BigNumber('0')),
    },
  },
  [LIQUIDITY_POOL]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(blockRewardStartTimestamp, LIQUIDITY_POOL, new BigNumber('2000000000000000000')),
      17: new BalanceAndRewardPoints(blockRewardStartTimestamp, LIQUIDITY_POOL, new BigNumber('500000000')),
    },
  },
}

const ammLiquidityBalances = {
  [user4]: new BalanceAndRewardPoints(blockRewardStartTimestamp, user4, new BigNumber('.05')),
  [user6]: new BalanceAndRewardPoints(blockRewardStartTimestamp, user6, new BigNumber('.05')),
};

const userToLiquiditySnapshots: AccountToAmmLiquiditySnapshotsMap = {
  [user4]: [{ timestamp: 1697500000, balance: new BigNumber('0.025') }],
  [user5]: [
    { timestamp: 1697250000, balance: new BigNumber('0.05') },
    { timestamp: 1697750000, balance: new BigNumber('0') },
  ],
  [user6]: [
    { timestamp: 1697250000, balance: new BigNumber('0.05') },
    { timestamp: 1697750000, balance: new BigNumber('0') },
  ],
  [user7]: [{ timestamp: 1697500000, balance: new BigNumber('0.05') }],
};

let totalPointsPerMarket;
let totalLiquidityPoints;

describe('rewards', () => {
  describe('#processEvent', () => {
    it('should process one event properly if user already has balance', async () => {
      const points = new BalanceAndRewardPoints(0, user1, new BigNumber(5));
      points.processEvent(DEPOSIT_EVENT);
      expect(points.balance).toEqual(new BigNumber(25));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(50));
    });

    it('should process one event properly if user has no balance', async () => {
      const points = new BalanceAndRewardPoints(0, user1);
      points.processEvent(DEPOSIT_EVENT);
      expect(points.balance).toEqual(new BigNumber(20));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(0));
    });

    it('should process deposit and then withdraw properly', async () => {
      const points = new BalanceAndRewardPoints(0, user1, new BigNumber(5));

      points.processEvent(DEPOSIT_EVENT);
      expect(points.balance).toEqual(new BigNumber(25));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(50));

      points.processEvent(WITHDRAWAL_EVENT);
      expect(points.balance).toEqual(new BigNumber(15));
      expect(points.lastUpdated).toEqual(15);
      expect(points.rewardPoints).toEqual(new BigNumber(175));
    });

    it('should process final event properly with no other events', async () => {
      const points = new BalanceAndRewardPoints(0, user1, new BigNumber(5));

      points.processEvent(FINAL_EVENT);
      expect(points.balance).toEqual(new BigNumber(5));
      expect(points.lastUpdated).toEqual(20);
      expect(points.rewardPoints).toEqual(new BigNumber(100));
    });

    it('should process final event properly with other events', async () => {
      const points = new BalanceAndRewardPoints(0, user1, new BigNumber(5));

      points.processEvent(DEPOSIT_EVENT);
      expect(points.balance).toEqual(new BigNumber(25));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(50));

      points.processEvent(WITHDRAWAL_EVENT);
      expect(points.balance).toEqual(new BigNumber(15));
      expect(points.lastUpdated).toEqual(15);
      expect(points.rewardPoints).toEqual(new BigNumber(175));

      points.processEvent(FINAL_EVENT);
      expect(points.balance).toEqual(new BigNumber(15));
      expect(points.lastUpdated).toEqual(20);
      expect(points.rewardPoints).toEqual(new BigNumber(250));
    });
  });

  describe('calculateRewardPoints', () => {
    totalPointsPerMarket = calculateTotalRewardPoints(
      accountToDolomiteBalanceMap,
      {},
      blockRewardStartTimestamp,
      blockRewardEndTimestamp,
    );
    expect(accountToDolomiteBalanceMap[user1]![subAccount1]!['17']!.rewardPoints)
      .toEqual(new BigNumber('100000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user2]![subAccount1]!['0']!.rewardPoints)
      .toEqual(new BigNumber('500000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user2]![subAccount1]!['17']!.rewardPoints)
      .toEqual(new BigNumber('100000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user3]![subAccount1]!['0']!.rewardPoints)
      .toEqual(new BigNumber('500000000000000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user4]![subAccount1]!['0']!.rewardPoints)
      .toEqual(new BigNumber('500000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user4]![subAccount1]!['17']!.rewardPoints).toEqual(new BigNumber('0'));

    expect(accountToDolomiteBalanceMap[user5]![subAccount1]!['0']!.rewardPoints)
      .toEqual(new BigNumber('200000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user5]![subAccount1]!['17']!.rewardPoints)
      .toEqual(new BigNumber('300000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user6]![subAccount1]!['0']!.rewardPoints)
      .toEqual(new BigNumber('300000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user6]![subAccount1]!['17']!.rewardPoints).toEqual(new BigNumber('0'));

    expect(accountToDolomiteBalanceMap[user7]?.[subAccount1]).toBeUndefined();

    expect(accountToDolomiteBalanceMap[LIQUIDITY_POOL]![subAccount1]!['0']!.rewardPoints)
      .toEqual(new BigNumber('2000000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[LIQUIDITY_POOL]![subAccount1]!['17']!.rewardPoints)
      .toEqual(new BigNumber('500000000').times(timeLength));

    expect(totalPointsPerMarket['0']).toEqual((new BigNumber(parseEther('4').toString()).times(timeLength)));
    expect(totalPointsPerMarket['17']).toEqual((new BigNumber('1000000000')).times(timeLength));
  });

  describe('calculateLiquidityPoints', () => {
    totalLiquidityPoints = calculateLiquidityPoints(
      ammLiquidityBalances,
      userToLiquiditySnapshots,
      blockRewardStartTimestamp,
      blockRewardEndTimestamp,
    );

    expect(ammLiquidityBalances[user4].rewardPoints).toEqual(new BigNumber('37500'));
    expect(ammLiquidityBalances[user5].rewardPoints).toEqual(new BigNumber('25000'));
    expect(ammLiquidityBalances[user6].rewardPoints).toEqual(new BigNumber('37500'));
    expect(ammLiquidityBalances[user7].rewardPoints).toEqual(new BigNumber('25000'));
    expect(totalLiquidityPoints).toEqual(new BigNumber('125000'));
  });

  describe('calculateFinalRewards', () => {
    const rewardWeights = liquidityMiningConfig.epochs[0].rewardWeights as Record<string, string>;
    const oArbRewardMap = Object.keys(rewardWeights).reduce<Record<string, BigNumber>>((acc, key) => {
      acc[key] = new BigNumber(parseEther(rewardWeights[key]).toString());
      return acc;
    }, {});
    const minimumOArbAmount = new BigNumber(ethers.utils.parseEther('1').toString());
    const userToOarbRewards = calculateFinalRewards(
      accountToDolomiteBalanceMap,
      ammLiquidityBalances,
      totalPointsPerMarket,
      totalLiquidityPoints,
      oArbRewardMap,
      minimumOArbAmount,
    );

    expect(userToOarbRewards[user1]).toEqual(new BigNumber(parseEther('3600').toString()));
    expect(userToOarbRewards[user2]).toEqual(new BigNumber(parseEther('2812.5').add(parseEther('3600')).toString()));
    expect(userToOarbRewards[user3]).toEqual(new BigNumber(parseEther('2812.5').toString()));
    expect(userToOarbRewards[user4]).toEqual(new BigNumber(parseEther('11587.5').toString()));
    expect(userToOarbRewards[user5]).toEqual(new BigNumber(parseEther('17775').toString()));
    expect(userToOarbRewards[user6]).toEqual(new BigNumber(parseEther('10462.5').toString()));
    expect(userToOarbRewards[user7]).toEqual(new BigNumber(parseEther('5850').toString()));

    let totalOarbRewards = new BigNumber(0);
    Object.keys(userToOarbRewards).forEach(account => {
      totalOarbRewards = totalOarbRewards.plus(userToOarbRewards[account].toFixed(18));
    });
    expect(totalOarbRewards).toEqual(new BigNumber(parseEther('58500').toString()));

    const leaves: string[] = [];
    Object.keys(userToOarbRewards).forEach(account => {
      leaves.push(keccak256(defaultAbiCoder.encode(
        ['address', 'uint256'],
        [account, parseEther(userToOarbRewards[account].toFixed(18))],
      )));
    });

    const tree = new MerkleTree(leaves, keccak256, { sort: true });
    const root = tree.getHexRoot();
    console.log(root);
    console.log(tree.getHexProof(leaves[0]));
    console.log(tree.getHexProof(leaves[1]));
  });
});

/*
  REWARD MATH

    WETH MARKET
      Total balance: 4 eth
      oARB available: 22,500 oARB

      user2: .5 eth balance
        10,000 * (.5 / 4) = 2,812.5 oARB

      user3: .5 eth balance
        22,500 * (.5 / 4) = 2,812.5 oARB

      user4: .5 eth balance
        22,500 * (.5 / 4) = 2,812.5 oARB

      user5: .2 eth balance
        22,500 * (.2 / 4) = 1,125 oARB

      user6: .3 eth balance
        22,500 * (.3 / 4) = 1,687.5 oARB

      liquidityPool: 2 eth balance
        22,500 * (2 / 4) = 11,250 oARB

    USDC MARKET
      Total balance: 1,000 USDC
      oARB available: 36,000 oARB

      user1: 100 USDC balance
        36,000 * (100 / 1000) = 3,600 oARB

      user2: 100 USDC balance
        36,000 * (100 / 1000) = 3,600 oARB

      user5: 300 USDC balance
        36,000 * (300 / 1000) = 10,800 oARB

      liquidityPool: 500 USDC balance
        36,000 * (500 / 1000) = 18,000 oARB

    LIQUIDITY POOL REWARDS
      Total reward points: 125,000
      Total oARB available: 11,250 + 18,000 = 29,250 oARB

      user4: .05 * 500,000 + .025 * 500,000 = 37,500 reward points
        29,250 * (37500 / 125000) = 8775 oARB

      user5: .05 * 500,000 = 25,000 reward points
        29,250 * (25000 / 125000) = 5,850 oARB

      user6: .05 * 750,000 = 37,500 reward points
        29,250 * (37500 / 125000) = 8,775 oARB

      user7: .05 * 500,000 = 25,000 reward points
        29,250 * (25000 / 125000) = 5,850 oARB

    TOTAL oARB
      Total oARB distributed: 58,500 oARB

      user1: 3,600 oARB
      user2: 2,812.5 + 3,600 = 6,412.5 oARB
      user3: 2,812.5 = 2,812.5 oARB
      user4: 2,812.5 + 8,775 = 11,587.5 oARB
      user5: 1,125 + 10,800 + 5,850 = 17,775 oARB
      user6: 1,687.5 + 8,775 = 10,462.5 oARB
      user7: 5,850 oARB
*/
