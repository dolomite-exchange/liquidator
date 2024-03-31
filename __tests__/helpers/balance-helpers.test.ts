import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { DateTime } from 'luxon';
import { getLiquidatableDolomiteAccounts } from '../../src/clients/dolomite';
import { getLargestBalanceUSD } from '../../src/helpers/balance-helpers';
import Pageable from '../../src/lib/pageable';
import AccountStore from '../../src/stores/account-store';
import BalanceStore from '../../src/stores/balance-store';
import BlockStore from '../../src/stores/block-store';
import MarketStore from '../../src/stores/market-store';

// eslint-disable-next-line max-len
const ACCOUNT_ID_1 = '0xb5dd5cfa0577b53aeb7b6ed4662794d5a44affbe-103576997491961730661524320610884432955705929610587706488872870347971589683830';
const ACCOUNT_ID_2 = '0x52256ef863a713ef349ae6e97a7e8f35785145de-70091649351367748290422611441766679494476833384245294727860561944953981138328';

describe('balance-helpers', () => {
  let accountStore: AccountStore;
  let blockStore: BlockStore;
  let marketStore: MarketStore;
  let balanceStore: BalanceStore;

  beforeEach(() => {
    blockStore = new BlockStore();
    marketStore = new MarketStore(blockStore);
    balanceStore = new BalanceStore(marketStore);
    accountStore = new AccountStore(blockStore, marketStore);
  });

  describe('#_getLargestBalanceUSD', () => {
    it('Successfully sorts balances by USD value', async () => {
      const blockNumber = 116_552_758;
      process.env.BLOCK_NUMBER = blockNumber.toString();
      await blockStore._update();
      await marketStore._update();
      await balanceStore._update();
      await accountStore._update();

      const marketMap = marketStore.getMarketMap();
      const balanceMap = balanceStore.getMarketBalancesMap();
      const accounts = await Pageable.getPageableValues(async (lastId) => {
        const results = await getLiquidatableDolomiteAccounts(
          await marketStore.getMarketIndexMap(marketMap),
          blockNumber,
          lastId,
        );
        return results.accounts;
      });
      const account = accounts.find(a => a.id === ACCOUNT_ID_1);
      expect(account).toBeDefined();

      const largestOwedBalance = getLargestBalanceUSD(
        Object.values(account!.balances),
        true,
        marketMap,
        balanceMap,
        DateTime.now(),
        false,
      );
      expect(largestOwedBalance.tokenAddress).toBe('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8');

      const largestHeldBalance = getLargestBalanceUSD(
        Object.values(account!.balances),
        false,
        marketMap,
        balanceMap,
        DateTime.now(),
        false,
      );
      expect(largestHeldBalance.tokenSymbol).toBe('dPT-GLP-28MAR2024');
    });

    it('Successfully sorts balances by USD value when balance is too low for a value', async () => {
      const blockNumber = 116_552_758;
      process.env.BLOCK_NUMBER = blockNumber.toString();
      await blockStore._update();
      await marketStore._update();
      await accountStore._update();

      const usdcMarketId = 2;
      (balanceStore as any).marketBalancesMap = { [usdcMarketId]: INTEGERS.ONE };

      const marketMap = marketStore.getMarketMap();
      const balanceMap = balanceStore.getMarketBalancesMap();
      const accounts = await Pageable.getPageableValues(async (lastId) => {
        const results = await getLiquidatableDolomiteAccounts(
          await marketStore.getMarketIndexMap(marketMap),
          blockNumber,
          lastId,
        );
        return results.accounts;
      });
      const account = accounts.find(a => a.id === ACCOUNT_ID_2);
      expect(account).toBeDefined();

      const largestHeldBalance = getLargestBalanceUSD(
        Object.values(account!.balances),
        false,
        marketMap,
        balanceMap,
        DateTime.now(),
        false,
      );
      expect(largestHeldBalance.tokenSymbol).toBe('WETH');
    });
  });
});
