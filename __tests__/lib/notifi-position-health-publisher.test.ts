import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';
import { logInToNotifi, NotifiAuthorization, publishNotifiFusionMessages } from '../../src/clients/notifi';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam } from '../../src/lib/api-types';
import NotifiPositionHealthPublisher from '../../src/lib/notifi-position-health-publisher';
import { DECIMAL_BASE } from '../../src/lib/utils';
import AccountStore from '../../src/stores/account-store';
import BlockStore from '../../src/stores/block-store';
import MarketStore from '../../src/stores/market-store';
import RiskParamsStore from '../../src/stores/risk-params-store';

jest.mock('../../src/clients/notifi');

const logInToNotifiMock = logInToNotifi as jest.Mock;
const publishNotifiFusionMessagesMock = publishNotifiFusionMessages as jest.Mock;

const OWNER = '0x78f4529554137a9015dc653758ab600abc2ffd48';
const WETH_MARKET_ID = 0;
const USDC_MARKET_ID = 1;
const EVENT_TYPE_ID = 'position-health-event-type-id';
const TOKEN = 'jwt';

describe('NotifiPositionHealthPublisher', () => {
  let accountStore: AccountStore;
  let marketStore: MarketStore;
  let riskParamsStore: RiskParamsStore;
  let publisher: NotifiPositionHealthPublisher;

  beforeEach(() => {
    process.env.NOTIFI_POSITION_HEALTH_EVENT_TYPE_ID = EVENT_TYPE_ID;
    process.env.NOTIFI_SID = 'sid';
    process.env.NOTIFI_SECRET = 'secret';

    jest.clearAllMocks();
    const blockStore = new BlockStore();
    marketStore = new MarketStore(blockStore);
    accountStore = new AccountStore(blockStore, marketStore);
    riskParamsStore = new RiskParamsStore(blockStore);
    publisher = new NotifiPositionHealthPublisher(accountStore, marketStore, riskParamsStore);

    accountStore.getLiquidatableDolomiteAccounts = jest.fn().mockImplementation(() => getTestAccounts());
    marketStore.getMarketMap = jest.fn().mockImplementation(() => getTestMarketMap());
    riskParamsStore.getDolomiteRiskParams = jest.fn().mockImplementation(() => getTestRiskParams());
    logInToNotifiMock.mockImplementation(async () => getTestAuthorization(DateTime.utc().plus({ hours: 1 })));
    publishNotifiFusionMessagesMock.mockImplementation(async (_token, messages) => ({
      indexToResultIdMap: messages.reduce((memo, _message, i) => {
        memo[i] = `result-${i}`;
        return memo;
      }, {}),
    }));
  });

  describe('#_publish', () => {
    it('does nothing until the risk params are initialized', async () => {
      riskParamsStore.getDolomiteRiskParams = jest.fn().mockImplementation(() => undefined);

      expect(await publisher._publish()).toEqual(false);

      expect(logInToNotifiMock).not.toHaveBeenCalled();
      expect(publishNotifiFusionMessagesMock).not.toHaveBeenCalled();
    });

    it('does nothing until the markets are initialized', async () => {
      marketStore.getMarketMap = jest.fn().mockImplementation(() => ({}));

      expect(await publisher._publish()).toEqual(false);

      expect(logInToNotifiMock).not.toHaveBeenCalled();
      expect(publishNotifiFusionMessagesMock).not.toHaveBeenCalled();
    });

    it('does nothing until the accounts are initialized', async () => {
      accountStore.getLiquidatableDolomiteAccounts = jest.fn().mockImplementation(() => []);

      expect(await publisher._publish()).toEqual(false);

      expect(logInToNotifiMock).not.toHaveBeenCalled();
      expect(publishNotifiFusionMessagesMock).not.toHaveBeenCalled();
    });

    it('publishes every position with debt, skipping account number 0', async () => {
      expect(await publisher._publish()).toEqual(true);

      expect(logInToNotifiMock).toHaveBeenCalledWith('sid', 'secret');
      expect(publishNotifiFusionMessagesMock).toHaveBeenCalledTimes(1);
      expect(publishNotifiFusionMessagesMock).toHaveBeenCalledWith(TOKEN, [
        {
          eventTypeId: EVENT_TYPE_ID,
          variablesJson: {
            chainId: Number(process.env.NETWORK_ID),
            positionId: `${OWNER}-1`,
            healthFactor: '2.00',
            filterVariables: {
              subscription: {
                value: `${OWNER}-1`,
                isCaseSensitive: false,
              },
              belowThreshold: {
                thresholdComparisonValue: 2,
              },
            },
          },
        },
      ]);
    });

    it('rounds the health factor down to two decimal places', async () => {
      accountStore.getLiquidatableDolomiteAccounts = jest.fn().mockImplementation(() => [
        getTestAccount('1', { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-110' }), // 1.8181...
      ]);

      await publisher._publish();

      const [, messages] = publishNotifiFusionMessagesMock.mock.calls[0];
      expect(messages[0].variablesJson.healthFactor).toEqual('1.81');
      expect(messages[0].variablesJson.filterVariables.belowThreshold.thresholdComparisonValue).toEqual(1.81);
    });

    it('publishes in batches of 100', async () => {
      accountStore.getLiquidatableDolomiteAccounts = jest.fn().mockImplementation(() => {
        return Array.from({ length: 250 }, (_, i) => {
          return getTestAccount((i + 1).toString(), { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-100' });
        });
      });

      await publisher._publish();

      expect(publishNotifiFusionMessagesMock).toHaveBeenCalledTimes(3);
      expect(publishNotifiFusionMessagesMock.mock.calls.map(([, messages]) => messages.length)).toEqual([100, 100, 50]);
    });

    it('reuses a token that is not about to expire', async () => {
      await publisher._publish();
      await publisher._publish();

      expect(logInToNotifiMock).toHaveBeenCalledTimes(1);
      expect(publishNotifiFusionMessagesMock).toHaveBeenCalledTimes(2);
    });

    it('logs in again when the token is about to expire', async () => {
      logInToNotifiMock.mockImplementation(async () => getTestAuthorization(DateTime.utc().plus({ minutes: 1 })));

      await publisher._publish();
      await publisher._publish();

      expect(logInToNotifiMock).toHaveBeenCalledTimes(2);
    });

    it('logs in again after a failed publish without throwing', async () => {
      publishNotifiFusionMessagesMock.mockRejectedValueOnce(new Error('401 Unauthorized'));

      expect(await publisher._publish()).toEqual(true);
      await publisher._publish();

      expect(logInToNotifiMock).toHaveBeenCalledTimes(2);
      expect(publishNotifiFusionMessagesMock).toHaveBeenCalledTimes(2);

      // The logger prints error stacks on the next tick; let it flush so it does not log after the test is done
      await new Promise(resolve => setImmediate(resolve));
    });
  });

  describe('#_poll', () => {
    const ONE_MINUTE_MILLIS = 60 * 1000;
    const ONE_HOUR_MILLIS = 60 * ONE_MINUTE_MILLIS;
    let nowMillis: number;
    let dateNowSpy: jest.SpyInstance;
    let publishMock: jest.Mock;

    // Moves the clock and the fake timers forward together, then runs the continuations queued by the timers that
    // fired so `_poll` reaches its next `delay`
    async function advance(millis: number): Promise<void> {
      nowMillis += millis;
      jest.advanceTimersByTime(millis);
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
      }
    }

    beforeEach(() => {
      jest.useFakeTimers();
      nowMillis = Date.UTC(2026, 0, 1, 10, 37); // 10:37 UTC, mid-interval
      dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMillis);
      process.env.NOTIFI_PUBLISH_INTERVAL_MS = ONE_HOUR_MILLIS.toString();
      process.env.ACCOUNT_POLL_INTERVAL_MS = '5000';
      publishMock = jest.fn().mockResolvedValue(true);
      publisher._publish = publishMock;
    });

    afterEach(() => {
      dateNowSpy.mockRestore();
      jest.useRealTimers();
    });

    it('waits for the next interval boundary before publishing, so a restart never re-alerts', async () => {
      publisher._poll();
      await advance(0);

      await advance(22 * ONE_MINUTE_MILLIS); // 10:59
      expect(publishMock).not.toHaveBeenCalled();

      await advance(ONE_MINUTE_MILLIS); // 11:00
      expect(publishMock).toHaveBeenCalledTimes(1);

      await advance(ONE_HOUR_MILLIS - 1); // 11:59:59.999
      expect(publishMock).toHaveBeenCalledTimes(1);

      await advance(1); // 12:00
      expect(publishMock).toHaveBeenCalledTimes(2);
    });

    it('retries at the account cadence until the stores are ready, then waits for the next boundary', async () => {
      publishMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      publisher._poll();
      await advance(0);

      await advance(23 * ONE_MINUTE_MILLIS); // 11:00, the stores are still loading
      expect(publishMock).toHaveBeenCalledTimes(1);

      await advance(5000); // 11:00:05, still loading
      expect(publishMock).toHaveBeenCalledTimes(2);

      await advance(5000); // 11:00:10, ready
      expect(publishMock).toHaveBeenCalledTimes(3);

      await advance(30 * ONE_MINUTE_MILLIS); // 11:30:10
      expect(publishMock).toHaveBeenCalledTimes(3);

      await advance(30 * ONE_MINUTE_MILLIS); // 12:00:10
      expect(publishMock).toHaveBeenCalledTimes(4);
    });
  });
});

function getTestAuthorization(expiry: DateTime): NotifiAuthorization {
  return {
    token: TOKEN,
    expiry: expiry.toISO(),
  };
}

function getTestMarket(marketId: number, symbol: string): ApiMarket {
  return {
    id: marketId.toString(),
    marketId,
    symbol,
    name: symbol,
    tokenAddress: `0x${marketId.toString().padStart(40, '0')}`,
    decimals: 18,
    oraclePrice: DECIMAL_BASE, // $1
    marginPremium: new BigNumber('0'),
    liquidationRewardPremium: new BigNumber('0'),
    isBorrowingDisabled: false,
    isPartialLiquidationSupported: true,
    supplyLiquidity: undefined,
    borrowLiquidity: undefined,
    maxSupplyLiquidity: undefined,
  };
}

function getTestMarketMap(): { [marketId: string]: ApiMarket } {
  return {
    [WETH_MARKET_ID]: getTestMarket(WETH_MARKET_ID, 'WETH'),
    [USDC_MARKET_ID]: getTestMarket(USDC_MARKET_ID, 'USDC'),
  };
}

function getTestRiskParams(): ApiRiskParam {
  return {
    dolomiteMargin: '0x0000000000000000000000000000000000000000',
    liquidationRatio: DECIMAL_BASE.times('1.15'),
    liquidationReward: DECIMAL_BASE.times('1.05'),
    numberOfMarkets: 2,
    riskOverrideSettings: {
      marketIdToCategoryMap: {},
      marketIdToRiskFeatureMap: {},
    },
    liquidationFeeRake: new BigNumber('0.1'),
  };
}

/**
 * @param weiByMarketId Negative wei for owed balances, positive for held
 */
function getTestAccount(accountNumber: string, weiByMarketId: Record<number, string>): ApiAccount {
  const balances = Object.entries(weiByMarketId).reduce<{ [marketId: string]: ApiBalance }>((memo, [marketId, wei]) => {
    const market = getTestMarketMap()[marketId];
    memo[marketId] = {
      marketId: market.marketId,
      tokenDecimals: market.decimals,
      tokenAddress: market.tokenAddress,
      tokenName: market.name,
      tokenSymbol: market.symbol,
      par: new BigNumber(wei),
      wei: new BigNumber(wei),
      expiresAt: null,
      expiryAddress: null,
    };
    return memo;
  }, {});

  return {
    id: `${OWNER}-${accountNumber}`,
    owner: OWNER,
    number: new BigNumber(accountNumber),
    effectiveUser: OWNER,
    balances,
  };
}

function getTestAccounts(): ApiAccount[] {
  return [
    // The user's Dolomite Balance; never published even though it has debt
    getTestAccount('0', { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-100' }),
    // A position with a health factor of exactly 2.00
    getTestAccount('1', { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-100' }),
    // A position without debt, so no health factor to publish
    getTestAccount('2', { [WETH_MARKET_ID]: '230' }),
  ];
}
