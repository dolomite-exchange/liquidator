import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam, EModeCategory } from '../../src/lib/api-types';
import { DECIMAL_BASE, getAccountHealthFactor, isCollateralized } from '../../src/lib/utils';

const OWNER = '0x78f4529554137a9015dc653758ab600abc2ffd48';
const WETH_MARKET_ID = 0;
const USDC_MARKET_ID = 1;

describe('utils', () => {
  describe('#getAccountHealthFactor', () => {
    it('divides the supply value by the borrow value and the liquidation ratio', () => {
      const account = getTestAccount('1', { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-100' });

      const healthFactor = getAccountHealthFactor(account, getTestMarketMap(), getTestRiskParams());

      expect(healthFactor?.toFixed()).toEqual('2'); // 230 / 100 / 1.15
    });

    it('adjusts the borrow value by the margin premium of its market', () => {
      const account = getTestAccount('1', { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-100' });
      const marketMap = getTestMarketMap();
      marketMap[USDC_MARKET_ID].marginPremium = DECIMAL_BASE.times('0.1');

      const healthFactor = getAccountHealthFactor(account, marketMap, getTestRiskParams());

      expect(healthFactor?.toFixed(4)).toEqual('1.8182'); // 230 / (100 * 1.1) / 1.15
    });

    it('uses the E-Mode margin ratio override and ignores margin premiums when one applies', () => {
      const account = getTestAccount('1', { [WETH_MARKET_ID]: '230', [USDC_MARKET_ID]: '-100' });
      const marketMap = getTestMarketMap();
      marketMap[USDC_MARKET_ID].marginPremium = DECIMAL_BASE.times('0.1');
      const riskParams = getTestRiskParams();
      const category = {
        category: EModeCategory.STABLE,
        marginRatioOverride: DECIMAL_BASE.times('1.05'),
        liquidationRewardOverride: DECIMAL_BASE.times('1.02'),
      };
      riskParams.riskOverrideSettings.marketIdToCategoryMap = {
        [WETH_MARKET_ID]: category,
        [USDC_MARKET_ID]: category,
      };

      const healthFactor = getAccountHealthFactor(account, marketMap, riskParams);

      expect(healthFactor?.toFixed(4)).toEqual('2.1905'); // 230 / 100 / 1.05
    });

    it('is undefined when the account has no borrow value', () => {
      const account = getTestAccount('1', { [WETH_MARKET_ID]: '230' });

      const healthFactor = getAccountHealthFactor(account, getTestMarketMap(), getTestRiskParams());

      expect(healthFactor).toBeUndefined();
    });
  });

  describe('#isCollateralized', () => {
    it('is collateralized when the health factor is at least 1', () => {
      const account = getTestAccount('1', { [WETH_MARKET_ID]: '115', [USDC_MARKET_ID]: '-100' }); // exactly 1.0

      const result = isCollateralized(account, getTestMarketMap(), getTestRiskParams());

      expect(result).toEqual({ isCollateralized: true, partialLiquidation: true });
    });

    it('is not collateralized when the health factor is below 1', () => {
      const account = getTestAccount('1', { [WETH_MARKET_ID]: '100', [USDC_MARKET_ID]: '-100' }); // 0.8696

      const result = isCollateralized(account, getTestMarketMap(), getTestRiskParams());

      expect(result).toEqual({ isCollateralized: false, partialLiquidation: false });
    });
  });
});

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
