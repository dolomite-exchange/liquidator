import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';
import { dolomite } from '../../src/helpers/web3';
import AccountStore from '../../src/lib/account-store';
import { ApiAccount, ApiMarket, ApiRiskParam } from '../../src/lib/api-types';
import DolomiteLiquidator from '../../src/lib/dolomite-liquidator';
import { LiquidationMode } from '../../src/lib/liquidation-mode';
import LiquidationStore from '../../src/lib/liquidation-store';
import MarketStore from '../../src/lib/market-store';
import RiskParamsStore from '../../src/lib/risk-params-store';

jest.mock('@dolomite-exchange/dolomite-margin/dist/src/modules/operate/AccountOperation');

describe('dolomite-liquidator', () => {
  let accountStore: AccountStore;
  let marketStore: MarketStore;
  let liquidationStore: LiquidationStore;
  let dolomiteLiquidator: DolomiteLiquidator;
  let riskParamsStore: RiskParamsStore;

  beforeEach(() => {
    jest.clearAllMocks();
    marketStore = new MarketStore();
    accountStore = new AccountStore(marketStore);
    liquidationStore = new LiquidationStore();
    riskParamsStore = new RiskParamsStore(marketStore);
    dolomiteLiquidator = new DolomiteLiquidator(accountStore, marketStore, liquidationStore, riskParamsStore);
    (
      marketStore.getBlockTimestamp as any
    ) = jest.fn().mockImplementation(() => DateTime.utc(2020, 1, 1));
  });

  describe('#_liquidateAccounts', () => {
    it('Successfully liquidates accounts normally', async () => {
      process.env.EXPIRATIONS_ENABLED = 'true';
      process.env.BRIDGE_TOKEN_ADDRESS = getTestMarkets()[0].tokenAddress;
      process.env.LIQUIDATION_MODE = LiquidationMode.Simple;

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

      expect(liquidatableExpiredAccounts[0][4].eq(new BigNumber(2)))
        .toBe(true); // marketId
      expect(liquidatableExpiredAccounts[0][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(liquidatableExpiredAccounts[0][1])
        .toEqual(new BigNumber(process.env.DOLOMITE_ACCOUNT_NUMBER));
      expect(liquidatableExpiredAccounts[0][3])
        .toEqual(new BigNumber(22)); // liquidAccountNumber
    });

    it('Successfully liquidates accounts while selling collateral', async () => {
      process.env.EXPIRATIONS_ENABLED = 'true';
      process.env.BRIDGE_TOKEN_ADDRESS = getTestMarkets()[0].tokenAddress; // WETH
      process.env.LIQUIDATION_MODE = LiquidationMode.SellWithInternalLiquidity;
      process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL = 'false';

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
      dolomite.liquidatorProxyV1WithAmm.liquidate = jest.fn().mockImplementation((...args) => {
        if (args[7]) {
          liquidatableExpiredAccounts.push(args);
        } else {
          liquidations.push(args);
        }
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

      const discount = INTEGERS.ONE.minus(new BigNumber(process.env.MIN_OWED_OUTPUT_AMOUNT_DISCOUNT));

      expect(sortedLiquidations[0][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(sortedLiquidations[0][1].toFixed())
        .toBe(process.env.DOLOMITE_ACCOUNT_NUMBER);
      expect(sortedLiquidations[0][4].toFixed())
        .toBe(/* owedMarket */ liquidatableAccounts[0].balances[1].marketId.toString());
      expect(sortedLiquidations[0][5].toFixed())
        .toBe(/* heldMarket */ liquidatableAccounts[0].balances[0].marketId.toString());
      expect(sortedLiquidations[0][6])
        .toEqual([
          liquidatableAccounts[0].balances[0].tokenAddress,
          process.env.BRIDGE_TOKEN_ADDRESS,
          liquidatableAccounts[0].balances[1].tokenAddress,
        ]);
      expect(sortedLiquidations[0][7])
        .toEqual(null);
      expect(sortedLiquidations[0][8])
        .toEqual(liquidatableAccounts[0].balances[1].wei.abs().times(discount).integerValue(BigNumber.ROUND_FLOOR));
      expect(sortedLiquidations[0][9])
        .toEqual(process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL === 'true');

      expect(sortedLiquidations[1][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(sortedLiquidations[1][1].toFixed())
        .toBe(process.env.DOLOMITE_ACCOUNT_NUMBER);
      expect(sortedLiquidations[1][4].toFixed())
        .toBe(/* owedMarket */ liquidatableAccounts[0].balances[0].marketId.toString());
      expect(sortedLiquidations[1][5].toFixed())
        .toBe(/* heldMarket */ liquidatableAccounts[0].balances[1].marketId.toString());
      expect(sortedLiquidations[1][6])
        .toEqual([
          liquidatableAccounts[0].balances[1].tokenAddress,
          process.env.BRIDGE_TOKEN_ADDRESS,
          liquidatableAccounts[0].balances[0].tokenAddress,
        ]);
      expect(sortedLiquidations[1][7])
        .toEqual(null);
      expect(sortedLiquidations[1][8])
        .toEqual(liquidatableAccounts[1].balances[0].wei.abs().times(discount).integerValue(BigNumber.ROUND_FLOOR));
      expect(sortedLiquidations[1][9])
        .toEqual(process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL === 'true');

      expect(liquidatableExpiredAccounts[0][0])
        .toBe(process.env.ACCOUNT_WALLET_ADDRESS);
      expect(liquidatableExpiredAccounts[0][1])
        .toEqual(new BigNumber(process.env.DOLOMITE_ACCOUNT_NUMBER));
      expect(liquidatableExpiredAccounts[0][2])
        .toEqual(expiredAccounts[0].owner); // liquidAccountOwner
      expect(liquidatableExpiredAccounts[0][3])
        .toEqual(expiredAccounts[0].number); // liquidAccountNumber
      expect(liquidatableExpiredAccounts[0][4].toFixed())
        .toBe(/* owedMarket */ expiredAccounts[0].balances[2].marketId.toString());
      expect(liquidatableExpiredAccounts[0][5].toFixed())
        .toBe(/* heldMarket */ expiredAccounts[0].balances[1].marketId.toString());
      expect(liquidatableExpiredAccounts[0][6])
        .toEqual([
          expiredAccounts[0].balances[1].tokenAddress,
          process.env.BRIDGE_TOKEN_ADDRESS,
          expiredAccounts[0].balances[2].tokenAddress,
        ]);
      expect(liquidatableExpiredAccounts[0][7])
        .toEqual(expiredAccounts[0].balances[2].expiresAt);
      expect(liquidatableExpiredAccounts[0][8])
        .toEqual(expiredAccounts[0].balances[2].wei.abs().times(discount).integerValue(BigNumber.ROUND_FLOOR));
      expect(liquidatableExpiredAccounts[0][9])
        .toEqual(process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL === 'true');
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
          par: new BigNumber('1010101010101010010101010010101010101001010'),
          wei: new BigNumber('2010101010101010010101010010101010101001010'),
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
          expiresAt: new BigNumber(Math.floor(new Date(2050, 5, 25).getTime() / 1000)),
          expiryAddress: dolomite.contracts.expiry.options.address,
        },
        1: {
          par: new BigNumber('1010101010101010010101010010101010101001010'),
          wei: new BigNumber('2010101010101010010101010010101010101001010'),
          marketId: 1,
          tokenDecimals: 6,
          tokenAddress: '0x0000000000000000000000000000000000000001',
          tokenName: 'USD Coin',
          tokenSymbol: 'USDC',
          expiresAt: null,
          expiryAddress: null,
        },
        2: {
          par: new BigNumber('-1010101010101010010101010010101010101001010'),
          wei: new BigNumber('-2010101010101010010101010010101010101001010'),
          marketId: 2,
          tokenDecimals: 18,
          tokenAddress: '0x0000000000000000000000000000000000000002',
          tokenName: 'DAI Stablecoin',
          tokenSymbol: 'DAI',
          expiresAt: new BigNumber(Math.floor(new Date(1982, 5, 25).getTime() / 1000)),
          expiryAddress: dolomite.contracts.expiry.options.address,
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
      marketId: 0,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      tokenAddress: '0x0234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('173192500000000000000'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
    },
    {
      marketId: 1,
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      tokenAddress: '0x1234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('985976069960621971'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
    },
    {
      marketId: 2,
      symbol: 'USDC',
      name: 'USD Coin',
      tokenAddress: '0x2234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('985976069960621971'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
    },
    {
      marketId: 3,
      symbol: 'LINK',
      name: 'Chainlink Token',
      tokenAddress: '0x3234567812345678123456781234567812345678',
      oraclePrice: new BigNumber('985976069960621971'),
      marginPremium: new BigNumber('0'),
      liquidationRewardPremium: new BigNumber('0'),
      decimals: 18,
    },
  ];
}

function getTestRiskParams(): ApiRiskParam {
  return {
    dolomiteMargin: '0x0000000000000000000000000000000000000000',
    liquidationRatio: new BigNumber('1150000000000000000'), // 115% or 1.15
    liquidationReward: new BigNumber('1050000000000000000'), // 105% or 1.05
  };
}
