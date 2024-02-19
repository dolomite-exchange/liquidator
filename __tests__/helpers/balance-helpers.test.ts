import { DateTime } from 'luxon';
import { getLiquidatableDolomiteAccounts } from '../../src/clients/dolomite';
import { _getLargestBalanceUSD } from '../../src/helpers/balance-helpers';
import AccountStore from '../../src/stores/account-store';
import BlockStore from '../../src/stores/block-store';
import MarketStore from '../../src/stores/market-store';
import Pageable from '../../src/lib/pageable';

// eslint-disable-next-line max-len
const ACCOUNT_ID = '0xb5dd5cfa0577b53aeb7b6ed4662794d5a44affbe-103576997491961730661524320610884432955705929610587706488872870347971589683830';

describe('balance-helpers', () => {
  let accountStore: AccountStore;
  let blockStore: BlockStore;
  let marketStore: MarketStore;

  beforeEach(() => {
    blockStore = new BlockStore();
    marketStore = new MarketStore(blockStore);
    accountStore = new AccountStore(blockStore, marketStore);
  });

  describe('#_getLargestBalanceUSD', () => {
    it('Successfully sorts balances by USD value', async () => {
      const blockNumber = 116_552_758;
      process.env.BLOCK_NUMBER = blockNumber.toString();
      await blockStore._update();
      await marketStore._update();
      await accountStore._update();

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
