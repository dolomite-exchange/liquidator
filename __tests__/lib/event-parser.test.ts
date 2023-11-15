import { BigNumber } from "@dolomite-exchange/dolomite-margin";
import { parseDeposits, parseLiquidations, parseLiquidityMiningVestingPositions, parseTrades, parseTransfers, parseVestingPositionTransfers } from "../../src/lib/event-parser";
import { BalanceAndRewardPoints } from "../../src/lib/rewards";

const address1 = '0x44f6ccf0d09ef0d4991eb74d8c26d77a52a1ba9e';
const address2 = '0x668035c440606da01e788991bfbba5c0d24133ab';
const ARB_MARKET_ID = '7';

describe('event-parser', () => {
  describe('parseDeposit', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const deposits = [
        {
          id: '0xd66778a4d3b9fc6fd6d84a5049763e0b3b2912c16d19c3d6bd46da01f8524119-24',
          serialId: '95108',
          timestamp: '1696057612',
          effectiveUser: address1,
          marketId: 0,
          amountDeltaPar: 0.04
        },
      ];
      parseDeposits(accountToAssetToEventsMap, deposits);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['0'][0].amount).toEqual(.04);
    });
  });

  describe('parseWithdraw', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const withdrawals = [
        {
          id: '0x4d5d9d8a6c6f9e9b1f3f3f8a0b3a9d1d2a0f8a7d1b8a0a5b5a4c5a3b2a1a0a9a8-12',
          serialId: '95109',
          timestamp: '1696057612',
          effectiveUser: address1,
          marketId: 0,
          amountDeltaPar: -5
        },
      ];
      parseDeposits(accountToAssetToEventsMap, withdrawals);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['0'][0].amount).toEqual(-5);
    });
  });

  describe('parseTransfer', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const transfers = [
        {
          id: '0xb44e6204445c71f5f508360c946d54f722a1efba9174ddcc1815321bd30f3985-25',
          serialId: '93141',
          timestamp: '1695506230',
          fromEffectiveUser: address1,
          toEffectiveUser: address2,
          marketId: 2,
          fromAmountDeltaPar: -19,
          toAmountDeltaPar: 19
        },
      ];
      parseTransfers(accountToAssetToEventsMap, transfers);
      expect(accountToAssetToEventsMap[address1]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['2'][0].amount).toEqual(-19);
      expect(accountToAssetToEventsMap[address2]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['2'][0].amount).toEqual(19);
    });

    it('should skip if fromEffectiveUser equals toEffectiveUser', async () => {
      const accountToAssetToEventsMap = {};
      const transfers = [
        {
          id: '0xb44e6204445c71f5f508360c946d54f722a1efba9174ddcc1815321bd30f3985-25',
          serialId: '93141',
          timestamp: '1695506230',
          fromEffectiveUser: address1,
          toEffectiveUser: address1,
          marketId: 2,
          fromAmountDeltaPar: -19,
          toAmountDeltaPar: 19
        },
      ];
      parseTransfers(accountToAssetToEventsMap, transfers);
      expect(accountToAssetToEventsMap).toEqual({});
    });
  })

  describe('parseTrade', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const trades = [
        {
          id: '0xd2ddf2db086817f6385e44a5eb78aa6a1794c04c8728705fe83a871d6650d94a-8',
          serialId: '96397',
          timestamp: '1696333775',
          takerEffectiveUser: address1,
          takerMarketId: '2',
          takerInputTokenDeltaPar: '-21',
          takerOutputTokenDeltaPar: '0.1',
          makerEffectiveUser: address2,
          makerMarketId: '0'
        },
      ];
      parseTrades(accountToAssetToEventsMap, trades);

      expect(accountToAssetToEventsMap[address1]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['2'][0].amount).toEqual("-21");
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['0'][0].amount).toEqual("0.1");

      expect(accountToAssetToEventsMap[address2]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['0'][0].amount).toEqual(new BigNumber(-0.1));
      expect(accountToAssetToEventsMap[address2]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['2'][0].amount).toEqual(new BigNumber(21));
    });

    it('should only update taker if maker effective user is null', async () => {
      const accountToAssetToEventsMap = {};
      const trades = [
        {
          id: '0xd1c898a3648ba625aee902f2e271944155eb911544695bb9dcefee49f67341a3-23',
          serialId: '92632',
          timestamp: '1695259177',
          takerEffectiveUser: address1,
          takerMarketId: '14',
          takerInputTokenDeltaPar: '-0.018',
          takerOutputTokenDeltaPar: '0.02',
          makerEffectiveUser: null,
          makerMarketId: '0'
        },
      ];
      parseTrades(accountToAssetToEventsMap, trades);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['14'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]).toBeNull;
    });
  })

  describe('parseLiquidation', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const liquidations = [
        {
          id: '0xfb787b3126a0879f083d79b38c64144188da8732902c07836acbacb0de6c0cc1-17',
          serialId: '89497',
          timestamp: '1694424325',
          solidEffectiveUser: address1,
          liquidEffectiveUser: address2,
          heldToken: '0',
          borrowedToken: '2',
          solidHeldTokenAmountDeltaPar: '0.4',
          liquidHeldTokenAmountDeltaPar: '-0.4',
          solidBorrowedTokenAmountDeltaPar: '-612',
          liquidBorrowedTokenAmountDeltaPar: '607'
        }
      ];
      parseLiquidations(accountToAssetToEventsMap, liquidations);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['2'].length).toEqual(1);

      expect(accountToAssetToEventsMap[address1]['0'][0].amount).toEqual("0.4");
      expect(accountToAssetToEventsMap[address1]['2'][0].amount).toEqual("-612");
      expect(accountToAssetToEventsMap[address2]['0'][0].amount).toEqual("-0.4");
      expect(accountToAssetToEventsMap[address2]['2'][0].amount).toEqual("607");
    });
  })

  describe('parseLiquidityMiningVestingPositions', () => {
    it('should work normally', async () => {
      const accountToDolomiteBalanceMap = {
        '0x44f6ccf0d09ef0d4991eb74d8c26d77a52a1ba9e': {
          '7': new BalanceAndRewardPoints(1694407206, new BigNumber('1000')) 
        }
      };

      const liquidityMiningVestingPositions = [
        {
          id: '0x4d5d9d8a6c6f9e9b1f3f3f8a0b3a9d1d2a0f8a7d1b8a0a5b5a4c5a3b2a1a0a9a8-12',
          effectiveUser: address1,
          amount: 5
        }
      ]

      parseLiquidityMiningVestingPositions(accountToDolomiteBalanceMap, liquidityMiningVestingPositions);
      expect(accountToDolomiteBalanceMap[address1][ARB_MARKET_ID].balance).toEqual(new BigNumber(1005));
    });
  });

  describe('parseVestingPositionTransfers', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const vestingPositionTransfers = [
        {
          id: '0x4d5d9d8a6c6f9e9b1f3f3f8a0b3a9d1d2a0f8a7d1b8a0a5b5a4c5a3b2a1a0a9a8-12',
          serialId: '95109',
          timestamp: '1696057612',
          fromEffectiveUser: address1,
          toEffectiveUser: address2,
          amount: 5
        },
      ];
      parseVestingPositionTransfers(accountToAssetToEventsMap, vestingPositionTransfers);
      expect(accountToAssetToEventsMap[address1][ARB_MARKET_ID].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1][ARB_MARKET_ID][0].amount).toEqual(new BigNumber(-5));
      expect(accountToAssetToEventsMap[address2][ARB_MARKET_ID].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2][ARB_MARKET_ID][0].amount).toEqual(5);
    });
  });
})