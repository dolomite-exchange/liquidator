import { BigNumber } from "@dolomite-exchange/dolomite-margin";
import { BalanceAndRewardPoints, getAccountBalancesByMarket } from "../../src/lib/rewards";
import { ApiAccount } from "../../src/lib/api-types";

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

  describe('#parseDeposits', () => {

  });

  describe('#parseWithdrawal', () => {

  });
});