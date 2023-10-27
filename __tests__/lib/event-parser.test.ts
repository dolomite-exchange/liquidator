import { BigNumber } from "@dolomite-exchange/dolomite-margin";
import { parseLiquidations, parseTrades, parseTransfers } from "../../src/lib/event-parser";

const address1 = '0x44f6ccf0d09ef0d4991eb74d8c26d77a52a1ba9e';
const address2 = '0x668035c440606da01e788991bfbba5c0d24133ab';

describe('event-parser', () => {
  describe('parseTransfer', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const transfers = [
        {
          id: '0x1c2ed98993ebee7e9d673e826f669947f33402b969864dc8a286a60103a4054d-11',
          serialId: '1',
          timestamp: '1690000000',
          fromEffectiveUser: address1,
          toEffectiveUser: address2,
          marketId: 17,
          amountDeltaWei: 3000
        },
      ];
      parseTransfers(accountToAssetToEventsMap, transfers);
      expect(accountToAssetToEventsMap[address1]['17'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['17'][0].amount).toEqual(new BigNumber("-3000"));
      expect(accountToAssetToEventsMap[address2]['17'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['17'][0].amount).toEqual(3000);
    });

    it('should skip if fromEffectiveUser equals toEffectiveUser', async () => {
      const accountToAssetToEventsMap = {};
      const transfers = [
        {
          id: '0x1c2ed98993ebee7e9d673e826f669947f33402b969864dc8a286a60103a4054d-11',
          serialId: '1',
          timestamp: '1690000000',
          fromEffectiveUser: address1,
          toEffectiveUser: address1,
          marketId: 17,
          amountDeltaWei: 3000
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
          id: '0x575f01de1e7b1060cdf4c238be7f969c6e0f945dd34d1057174bc2dc8a8d05ce-18',
          serialId: '1',
          timestamp: '1690000000',
          takerEffectiveUser: address1,
          takerMarketId: '2',
          takerAmountDeltaWei: '300',
          makerEffectiveUser: address2,
          makerMarketId: '0',
          makerAmountDeltaWei: '300'
        },
      ];
      parseTrades(accountToAssetToEventsMap, trades);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['0'][0].amount).toEqual("300");
      expect(accountToAssetToEventsMap[address1]['2'][0].amount).toEqual(new BigNumber("-300"));
      expect(accountToAssetToEventsMap[address2]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['0'][0].amount).toEqual(new BigNumber("-300"));
      expect(accountToAssetToEventsMap[address2]['2'][0].amount).toEqual("300");
    });

    it('should only update taker if maker effective user is null', async () => {
      const accountToAssetToEventsMap = {};
      const trades = [
        {
          id: '0x575f01de1e7b1060cdf4c238be7f969c6e0f945dd34d1057174bc2dc8a8d05ce-18',
          serialId: '1',
          timestamp: '1690000000',
          takerEffectiveUser: address1,
          takerMarketId: '2',
          takerAmountDeltaWei: '300',
          makerEffectiveUser: null,
          makerMarketId: '0',
          makerAmountDeltaWei: '300'
        },
      ];
      parseTrades(accountToAssetToEventsMap, trades);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]).toBeNull;
    });
  })

  describe('parseLiquidation', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap = {};
      const liquidations = [
        {
          id: '0xfb787b3126a0879f083d79b38c64144188da8732902c07836acbacb0de6c0cc1-17',
          serialId: '1',
          timestamp: '1694424325',
          solidEffectiveUser: address1,
          liquidEffectiveUser: address2,
          heldToken: '0',
          heldTokenAmountDeltaWei: '0.5',
          heldTokenLiquidationRewardWei: '0.1',
          borrowedToken: '2',
          borrowedTokenAmountDeltaWei: '600'
        }
      ];
      parseLiquidations(accountToAssetToEventsMap, liquidations);
      expect(accountToAssetToEventsMap[address1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]['2'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]['2'].length).toEqual(1);

      expect(accountToAssetToEventsMap[address1]['0'][0].amount).toEqual("0.1");
      expect(accountToAssetToEventsMap[address1]['2'][0].amount).toEqual(new BigNumber(-600));
      expect(accountToAssetToEventsMap[address2]['0'][0].amount).toEqual(new BigNumber(-.5));
      expect(accountToAssetToEventsMap[address2]['2'][0].amount).toEqual("600");
    });
  })
});