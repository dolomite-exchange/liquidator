import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';
import { dolomite } from '../../src/helpers/web3';
import { ApiAccount, ApiMarket, ApiRiskParam } from '../../src/lib/api-types';
import DolomiteLiquidator from '../../src/lib/dolomite-liquidator';
import { LiquidationMode } from '../../src/lib/liquidation-mode';
import AccountStore from '../../src/stores/account-store';
import AsyncActionRetryStore from '../../src/stores/async-action-retry-store';
import AsyncActionStore from '../../src/stores/async-action-store';
import BalanceStore from '../../src/stores/balance-store';
import BlockStore from '../../src/stores/block-store';
import LiquidationStore from '../../src/stores/liquidation-store';
import MarketStore from '../../src/stores/market-store';
import RiskParamsStore from '../../src/stores/risk-params-store';

jest.mock('@dolomite-exchange/dolomite-margin/dist/src/modules/operate/AccountOperation');

describe('dolomite-liquidator', () => {
  let blockStore: BlockStore;
  let accountStore: AccountStore;
  let asyncActionStore: AsyncActionStore;
  let asyncActionRetryStore: AsyncActionRetryStore;
  let marketStore: MarketStore;
  let balanceStore: BalanceStore;
  let liquidationStore: LiquidationStore;
  let dolomiteLiquidator: DolomiteLiquidator;
  let riskParamsStore: RiskParamsStore;

  beforeEach(() => {
    process.env.EXPIRATIONS_ENABLED = 'true';
    process.env.LIQUIDATION_MODE = LiquidationMode.Simple;
    process.env.MIN_VALUE_LIQUIDATED = '1';

    jest.clearAllMocks();
    blockStore = new BlockStore();
    marketStore = new MarketStore(blockStore);
    balanceStore = new BalanceStore(marketStore);
    accountStore = new AccountStore(blockStore, marketStore);
    asyncActionStore = new AsyncActionStore(blockStore);
    asyncActionRetryStore = new AsyncActionRetryStore();
    liquidationStore = new LiquidationStore();
    riskParamsStore = new RiskParamsStore(blockStore);
    dolomiteLiquidator = new DolomiteLiquidator(
      accountStore,
      asyncActionStore,
      asyncActionRetryStore,
      blockStore,
      marketStore,
      balanceStore,
      liquidationStore,
      riskParamsStore,
    );
    (
      blockStore.getBlockTimestamp as any
    ) = jest.fn().mockImplementation(() => DateTime.utc(2020, 1, 1));
  });

  describe('#_liquidateAccounts', () => {
    it('Successfully liquidates accounts normally', async () => {
      const liquidatableAccounts = getTestLiquidatableAccounts();
      const expiredAccounts = getTestExpiredAccounts();
      const markets = getTestMarkets();
      const riskParams = getTestRiskParams();
      accountStore.getLiquidatableDolomiteAccounts = jest.fn().mockImplementation(() => liquidatableAccounts);
      accountStore.getExpirableDolomiteAccounts = jest.fn().mockImplementation(() => expiredAccounts);
      marketStore.getMarketMap = jest.fn().mockImplementation(() => markets);
      riskParamsStore.getDolomiteRiskParams = jest.fn().mockImplementation(() => riskParams);
      dolomite.getters.isAccountLiquidatable = jest.fn().mockImplementation(() => true);

      const liquidations: any[] = [];
      const liquidatableExpiredAccounts: any[] = [];
      dolomite.expiryProxy.expire = jest.fn().mockImplementation((...args) => {
        liquidatableExpiredAccounts.push(args);
      });
      dolomite.liquidatorProxyV1.liquidate = jest.fn().mockImplementation((...args) => {
        liquidations.push(args);
        return { gas: 1 };
      });

      await dolomiteLiquidator._liquidateAccounts();

      expect(liquidations.length)
        .toBe(liquidatableAccounts.length);
      expect(liquidatableExpiredAccounts.length)
        .toBe(1);

      const sortedLiquidations = liquidatableAccounts.map((account: ApiAccount) => {
        return liquidations.find((l) => l[2] === account.owner && l[3] === account.number);
      });

      expect(sortedLiquidations[0][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(sortedLiquidations[0][1].toFixed())
        .toBe(process.env.DOLOMITE_ACCOUNT_NUMBER);
      expect(sortedLiquidations[0][4].toFixed())
        .toBe(process.env.MIN_ACCOUNT_COLLATERALIZATION);
      expect(sortedLiquidations[0][5].toFixed())
        .toBe(new BigNumber(process.env.MIN_VALUE_LIQUIDATED).toFixed());
      expect(sortedLiquidations[0][6])
        .toEqual(process.env.OWED_PREFERENCES.split(',')
          .map((p) => new BigNumber(p)));
      expect(sortedLiquidations[0][7])
        .toEqual(process.env.COLLATERAL_PREFERENCES.split(',')
          .map((p) => new BigNumber(p)));

      expect(sortedLiquidations[1][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(sortedLiquidations[1][1].toFixed())
        .toBe(process.env.DOLOMITE_ACCOUNT_NUMBER);
      expect(sortedLiquidations[1][4].toFixed())
        .toBe(process.env.MIN_ACCOUNT_COLLATERALIZATION);
      expect(sortedLiquidations[1][5].toFixed())
        .toBe(new BigNumber(process.env.MIN_VALUE_LIQUIDATED).toFixed());
      expect(sortedLiquidations[1][6])
        .toEqual(process.env.OWED_PREFERENCES.split(',')
          .map((p) => new BigNumber(p)));
      expect(sortedLiquidations[1][7])
        .toEqual(process.env.COLLATERAL_PREFERENCES.split(',')
          .map((p) => new BigNumber(p)));

      expect(liquidatableExpiredAccounts[0][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(liquidatableExpiredAccounts[0][1])
        .toEqual(new BigNumber(process.env.DOLOMITE_ACCOUNT_NUMBER));
      expect(liquidatableExpiredAccounts[0][3])
        .toEqual(new BigNumber(22)); // liquidAccountNumber
      expect(liquidatableExpiredAccounts[0][4].eq(new BigNumber(0)))
        .toBe(true); // marketId
    });
  });
});

function getTestLiquidatableAccounts(): ApiAccount[] {
  return [
    {
      id: '0x78F4529554137A9015dC653758aB600aBC2ffD48-0',
      owner: '0x78F4529554137A9015dC653758aB600aBC2ffD48',
      effectiveUser: '0x78F4529554137A9015dC653758aB600aBC2ffD48',
      number: new BigNumber('0'),
      balances: {
        0: {
          par: new BigNumber('100'),
          wei: new BigNumber('200'),
          marketId: 0,
          tokenDecimals: 18,
          tokenAddress: '0x0000000000000000000000000000000000000000',
          tokenName: 'Ethereum',
          tokenSymbol: 'ETH',
          expiresAt: null,
          expiryAddress: null,
        },
        1: {
          par: new BigNumber('-15573'),
          wei: new BigNumber('-31146'),
          marketId: 1,
          tokenDecimals: 6,
          tokenAddress: '0x0000000000000000000000000000000000000001',
          tokenName: 'USD Coin',
          tokenSymbol: 'USDC',
          expiresAt: null,
          expiryAddress: null,
        },
      },
    },
    {
      id: '0x78F4529554137A9015dC653758aB600aBC2ffD48-1',
      owner: '0x78F4529554137A9015dC653758aB600aBC2ffD48',
      effectiveUser: '0x78F4529554137A9015dC653758aB600aBC2ffD48',
      number: new BigNumber('1'),
      balances: {
        0: {
          par: new BigNumber('-1010101010101010010101010010101010101001010'),
          wei: new BigNumber('-2010101010101010010101010010101010101001010'),
          marketId: 0,
          tokenDecimals: 18,
          tokenAddress: '0x0000000000000000000000000000000000000000',
          tokenName: 'Ethereum',
          tokenSymbol: 'ETH',
          expiresAt: null,
          expiryAddress: null,
        },
        1: {
          par: new BigNumber('1010101010101010010101010010101'),
          wei: new BigNumber('2010101010101010010101010010101'),
          marketId: 1,
          tokenDecimals: 6,
          tokenAddress: '0x0000000000000000000000000000000000000001',
          tokenName: 'USD Coin',
          tokenSymbol: 'USDC',
          expiresAt: null,
          expiryAddress: null,
        },
      },
    },
  ];
}

function getTestExpiredAccounts(): ApiAccount[] {
  return [
    {
      id: '0x78F4529554137A9015dC653758aB600aBC2ffD48-22',
      owner: '0x78F4529554137A9015dC653758aB600aBC2ffD48',
      effectiveUser: '0x78F4529554137A9015dC653758aB600aBC2ffD48',
      number: new BigNumber('22'),
      balances: {
        0: {
          par: new BigNumber('-1010101010101010010101010010101010101001010'),
          wei: new BigNumber('-2010101010101010010101010010101010101001010'),
          marketId: 0,
          tokenDecimals: 18,
          tokenAddress: '0x0000000000000000000000000000000000000000',
          tokenName: 'Ethereum',
          tokenSymbol: 'ETH',
          expiresAt: new BigNumber(Math.floor(new Date(1982, 5, 25).getTime() / 1000)),
          expiryAddress: dolomite.contracts.expiry.options.address,
        },
        1: {
          par: new BigNumber('-1010101010101010010101010010101010101001010'),
          wei: new BigNumber('-2010101010101010010101010010101010101001010'),
          marketId: 1,
          tokenDecimals: 18,
          tokenAddress: '0x0000000000000000000000000000000000000002',
          tokenName: 'DAI Stablecoin',
          tokenSymbol: 'DAI',
          expiresAt: new BigNumber(Math.floor(new Date(2050, 5, 25).getTime() / 1000)),
          expiryAddress: dolomite.contracts.expiry.options.address,
        },
        2: {
          par: new BigNumber('1010101010101010010101010010101010101001010'),
          wei: new BigNumber('2010101010101010010101010010101010101001010'),
          marketId: 2,
          tokenDecimals: 6,
          tokenAddress: '0x0000000000000000000000000000000000000001',
          tokenName: 'USD Coin',
          tokenSymbol: 'USDC',
          expiresAt: null,
          expiryAddress: null,
        },
        3: {
          marketId: 3,
          tokenDecimals: 18,
          tokenAddress: '0x0000000000000000000000000000000000000003',
          tokenName: 'Chainlink Token',
          tokenSymbol: 'LINK',
          par: new BigNumber('1010101010101010010101010010101010101001010'),
          wei: new BigNumber('2010101010101010010101010010101010101001010'),
          expiresAt: null,
          expiryAddress: null,
        },
      },
    },
  ];
}

function getTestMarkets(): ApiMarket[] {
  return [
    {
      id: '0',
      marketId: 0,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      tokenAddress: '0x0234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('173192500000000000000'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
      isBorrowingDisabled: false,
      supplyLiquidity: undefined,
      borrowLiquidity: undefined,
      maxSupplyLiquidity: undefined,
    },
    {
      id: '1',
      marketId: 1,
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      tokenAddress: '0x1234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('985976069960621971'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
      isBorrowingDisabled: false,
      supplyLiquidity: undefined,
      borrowLiquidity: undefined,
      maxSupplyLiquidity: undefined,
    },
    {
      id: '2',
      marketId: 2,
      symbol: 'USDC',
      name: 'USD Coin',
      tokenAddress: '0x2234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('985976069960621971'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
      isBorrowingDisabled: false,
      supplyLiquidity: undefined,
      borrowLiquidity: undefined,
      maxSupplyLiquidity: undefined,
    },
    {
      id: '3',
      marketId: 3,
      symbol: 'LINK',
      name: 'Chainlink Token',
      tokenAddress: '0x3234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('985976069960621971'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
      isBorrowingDisabled: false,
      supplyLiquidity: undefined,
      borrowLiquidity: undefined,
      maxSupplyLiquidity: undefined,
    },
  ];
}

function getTestRiskParams(): ApiRiskParam {
  return {
    dolomiteMargin: '0x0000000000000000000000000000000000000000',
    liquidationRatio: new BigNumber('1150000000000000000'), // 115% or 1.15
    liquidationReward: new BigNumber('1050000000000000000'), // 105% or 1.05
    numberOfMarkets: 32,
    riskOverrideSettings: {
      marketIdToCategoryMap: {},
      marketIdToRiskFeatureMap: {},
    },
  };
}
