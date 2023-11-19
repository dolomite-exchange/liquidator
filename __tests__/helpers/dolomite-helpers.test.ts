import { DateTime } from 'luxon';
import { getLiquidatableDolomiteAccounts } from '../../src/clients/dolomite';
import { _getLargestBalanceUSD } from '../../src/helpers/dolomite-helpers';
import AccountStore from '../../src/lib/account-store';
import MarketStore from '../../src/lib/market-store';
import Pageable from '../../src/lib/pageable';

const ACCOUNT_ID = '0xb5dd5cfa0577b53aeb7b6ed4662794d5a44affbe-103576997491961730661524320610884432955705929610587706488872870347971589683830';

describe('dolomite-helpers', () => {
  let accountStore: AccountStore;
  let marketStore: MarketStore;

  beforeEach(() => {
    marketStore = new MarketStore();
    accountStore = new AccountStore(marketStore);
  });

  describe('#_getLargestBalanceUSD', () => {
    it('Successfully sorts balances by USD value', async () => {
      const blockNumber = 116552758;
      process.env.BLOCK_NUMBER = blockNumber.toString();
      await accountStore._update();
      await marketStore._update();

      const marketMap = marketStore.getMarketMap();
      const accounts = await Pageable.getPageableValues(async (lastId) => {
        const results = await getLiquidatableDolomiteAccounts(
          await marketStore.getMarketIndexMap(marketMap),
          blockNumber,
          lastId,
        );
        return results.accounts;
      });
      const account = accounts.find(a => a.id === ACCOUNT_ID);
      expect(account).toBeDefined();

      const largestOwedBalance = _getLargestBalanceUSD(
        Object.values(account!.balances),
        true,
        marketMap,
        DateTime.now(),
        false,
      );
      expect(largestOwedBalance.tokenAddress).toBe('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'); // USDC
    });
  });
});
