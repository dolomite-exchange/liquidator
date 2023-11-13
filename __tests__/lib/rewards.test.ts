import { BigNumber } from "@dolomite-exchange/dolomite-margin";
import { BalanceAndRewardPoints, calculateFinalRewards, calculateLiquidityPoints, calculateRewardPoints } from "../../src/lib/rewards";
import { defaultAbiCoder, keccak256, parseEther } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';

const DEPOSIT_EVENT = {
  amount: new BigNumber(20),
  timestamp: 10,
  serialId: 1
};

const WITHDRAWAL_EVENT = {
  amount: new BigNumber(-10),
  timestamp: 15,
  serialId: 2
};

const FINAL_EVENT = {
  amount: new BigNumber(0),
  timestamp: 20,
  serialId: 0
};

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

const accountToDolomiteBalanceMap = {
  [user1]: {
    '2': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('100000000')) 
  },
  [user2]: {
    '0': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('500000000000000000')),
    '2': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('100000000'))
  },
  [user3]: {
    '0': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('500000000000000000'))
  },
  [user4]: {
    '0': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('500000000000000000')),
    '2': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('-3000000'))
  },
  [user5]: {
    '0': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('200000000000000000')),
    '2': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('300000000'))
  },
  [user6]: {
    '0': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('300000000000000000')),
    '2': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('0'))
  },
  [LIQUIDITY_POOL]: {
    '0': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('2000000000000000000')),
    '2': new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('500000000'))
  }
}

const ammLiquidityBalances = {
  [user4]: new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('.05')),
  [user6]: new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber('.05')),
};

const userToLiquiditySnapshots = {
  [user4]: [ { timestamp: 1697500000, balance: '0.025' } ],
  [user5]: [
    { timestamp: 1697250000, balance: '0.05' },
    { timestamp: 1697750000, balance: '0' }
  ],
  [user6]: [
    { timestamp: 1697250000, balance: '0.05' },
    { timestamp: 1697750000, balance: '0' }
  ],
  [user7]: [ { timestamp: 1697500000, balance: '0.05' } ]
};

let totalPointsPerMarket;
let totalLiquidityPoints;


describe('rewards', () => {
  describe('#processEvent', () => {
    it('should process one event properly if user already has balance', async () => {
      let user = new BalanceAndRewardPoints(0, new BigNumber(5));
      user.processEvent(DEPOSIT_EVENT);
      expect(user.balance).toEqual(new BigNumber(25));
      expect(user.lastUpdated).toEqual(10);
      expect(user.rewardPoints).toEqual(new BigNumber(50));
    });

    it('should process one event properly if user has no balance', async () => {
      let user = new BalanceAndRewardPoints(0);
      user.processEvent(DEPOSIT_EVENT);
      expect(user.balance).toEqual(new BigNumber(20));
      expect(user.lastUpdated).toEqual(10);
      expect(user.rewardPoints).toEqual(new BigNumber(0));
    });

    it('should process deposit and then withdraw properly', async () => {
      let user = new BalanceAndRewardPoints(0, new BigNumber(5));

      user.processEvent(DEPOSIT_EVENT);
      expect(user.balance).toEqual(new BigNumber(25));
      expect(user.lastUpdated).toEqual(10);
      expect(user.rewardPoints).toEqual(new BigNumber(50));

      user.processEvent(WITHDRAWAL_EVENT);
      expect(user.balance).toEqual(new BigNumber(15));
      expect(user.lastUpdated).toEqual(15);
      expect(user.rewardPoints).toEqual(new BigNumber(175));
    });

    it('should process final event properly with no other events', async () => {
      let user = new BalanceAndRewardPoints(0, new BigNumber(5));

      user.processEvent(FINAL_EVENT);
      expect(user.balance).toEqual(new BigNumber(5));
      expect(user.lastUpdated).toEqual(20);
      expect(user.rewardPoints).toEqual(new BigNumber(100));
    });

    it('should process final event properly with other events', async () => {
      let user = new BalanceAndRewardPoints(0, new BigNumber(5));

      user.processEvent(DEPOSIT_EVENT);
      expect(user.balance).toEqual(new BigNumber(25));
      expect(user.lastUpdated).toEqual(10);
      expect(user.rewardPoints).toEqual(new BigNumber(50));

      user.processEvent(WITHDRAWAL_EVENT);
      expect(user.balance).toEqual(new BigNumber(15));
      expect(user.lastUpdated).toEqual(15);
      expect(user.rewardPoints).toEqual(new BigNumber(175));

      user.processEvent(FINAL_EVENT);
      expect(user.balance).toEqual(new BigNumber(15));
      expect(user.lastUpdated).toEqual(20);
      expect(user.rewardPoints).toEqual(new BigNumber(250));
    });
  });

  describe('calculateRewardPoints', () => {
    totalPointsPerMarket = calculateRewardPoints(accountToDolomiteBalanceMap, {}, blockRewardStartTimestamp, blockRewardEndTimestamp);
    expect(accountToDolomiteBalanceMap[user1]['2'].rewardPoints).toEqual(new BigNumber('100000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user2]['0'].rewardPoints).toEqual(new BigNumber('500000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user2]['2'].rewardPoints).toEqual(new BigNumber('100000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user3]['0'].rewardPoints).toEqual(new BigNumber('500000000000000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user4]['0'].rewardPoints).toEqual(new BigNumber('500000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user4]['2'].rewardPoints).toEqual(new BigNumber("0"));

    expect(accountToDolomiteBalanceMap[user5]['0'].rewardPoints).toEqual(new BigNumber('200000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user5]['2'].rewardPoints).toEqual(new BigNumber('300000000').times(timeLength));

    expect(accountToDolomiteBalanceMap[user6]['0'].rewardPoints).toEqual(new BigNumber('300000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[user6]['2'].rewardPoints).toEqual(new BigNumber('0'));

    expect(accountToDolomiteBalanceMap[user7]).toBeNaN;
    expect(accountToDolomiteBalanceMap[user7]).toBeNaN;

    expect(accountToDolomiteBalanceMap[LIQUIDITY_POOL]['0'].rewardPoints).toEqual(new BigNumber('2000000000000000000').times(timeLength));
    expect(accountToDolomiteBalanceMap[LIQUIDITY_POOL]['2'].rewardPoints).toEqual(new BigNumber('500000000').times(timeLength));

    expect(totalPointsPerMarket['0']).toEqual((new BigNumber(parseEther('4').toString()).times(timeLength)));
    expect(totalPointsPerMarket['2']).toEqual((new BigNumber('1000000000')).times(timeLength));
  });

  describe('calculateLiquidityPoints', () => {
    totalLiquidityPoints = calculateLiquidityPoints(ammLiquidityBalances, userToLiquiditySnapshots, blockRewardStartTimestamp, blockRewardEndTimestamp);

    expect(ammLiquidityBalances[user4].rewardPoints).toEqual(new BigNumber('37500'));
    expect(ammLiquidityBalances[user5].rewardPoints).toEqual(new BigNumber('25000'));
    expect(ammLiquidityBalances[user6].rewardPoints).toEqual(new BigNumber('37500'));
    expect(ammLiquidityBalances[user7].rewardPoints).toEqual(new BigNumber('25000'));
    expect(totalLiquidityPoints).toEqual(new BigNumber('125000'));
  });

  describe('calculateFinalRewards', () => {
    const userToOarbRewards = calculateFinalRewards(accountToDolomiteBalanceMap, ammLiquidityBalances, totalPointsPerMarket, totalLiquidityPoints);

    expect(userToOarbRewards[user1]).toEqual(new BigNumber("1000"));
    expect(userToOarbRewards[user2]).toEqual(new BigNumber("2250"));
    expect(userToOarbRewards[user3]).toEqual(new BigNumber("1250"));
    expect(userToOarbRewards[user4]).toEqual(new BigNumber("4250"));
    expect(userToOarbRewards[user5]).toEqual(new BigNumber("5500"));
    expect(userToOarbRewards[user6]).toEqual(new BigNumber("3750"));
    expect(userToOarbRewards[user7]).toEqual(new BigNumber("2000"));

    let totalOarbRewards = new BigNumber(0);
    for (const account in userToOarbRewards) {
      totalOarbRewards = totalOarbRewards.plus(userToOarbRewards[account].toFixed(18));
    }
    expect(totalOarbRewards).toEqual(new BigNumber("20000"));

    const leaves: string[] = [];
    for (const account in userToOarbRewards) {
      leaves.push(keccak256(defaultAbiCoder.encode(['address', 'uint256'], [account, parseEther(userToOarbRewards[account].toFixed(18))])));
    }

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
      oARB available: 10,000 oARB

      user2: .5 eth balance
        10,000 * (.5 / 4) = 1,250 oARB

      user3: .5 eth balance
        10,000 * (.5 / 4) = 1,250 oARB

      user4: .5 eth balance
        10,000 * (.5 / 4) = 1,250 oARB

      user5: .2 eth balance
        10,000 * (.2 / 4) = 500 oARB

      user6: .3 eth balance
        10,000 * (.3 / 4) = 750 oARB

      liquidityPool: 2 eth balance
        10,000 * (2 / 4) = 5,000 oARB

    USDC MARKET
      Total balance: 1,000 USDC
      oARB available: 10,000 oARB

      user1: 100 USDC balance
        10,000 * (100 / 1000) = 1,000 oARB

      user2: 100 USDC balance
        10,000 * (100 / 1000) = 1,000 oARB

      user5: 300 USDC balance
        10,000 * (100 / 1000) = 3,000 oARB

      liquidityPool: 500 USDC balance
        10,000 * (500 / 1000) = 5,000 oARB

    LIQUIDITY POOL REWARDS
      Total reward points: 125,000

      user4: .05 * 500,000 + .025 * 500,000 = 37,500 reward points
        10,000 * (37500 / 125000) = 3,000 oARB

      user5: .05 * 500,000 = 25,000 reward points
        10,000 * (25000 / 125000) = 2,000 oARB

      user6: .05 * 750,000 = 37,500 reward points
        10,000 * (37500 / 125000) = 3,000 oARB

      user7: .05 * 500,000 = 25,000 reward points
        10,000 * (25000 / 125000) = 2,000 oARB

    TOTAL oARB
      Total oARB distributed: 20,000 oARB

      user1: 1,000 oARB
      user2: 1,250 + 1,000 = 2,250 oARB
      user3: 1,250 = 1,250 oARB
      user4: 1,250 + 3,000 = 4,250 oARB
      user5: 500 + 3,000 + 2,000 = 5,500 oARB
      user6: 750 + 3,000 = 3,750 oARB
      user7: 2,000 oARB
*/
