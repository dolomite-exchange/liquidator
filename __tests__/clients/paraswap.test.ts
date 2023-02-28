import { BigNumber, DolomiteMargin } from '@dolomite-exchange/dolomite-margin';
import { getParaswapSwapCalldataForLiquidation } from '../../src/clients/paraswap';
import { ApiMarket } from '../../src/lib/api-types';

describe('paraswap', () => {
  describe('#getParaswapSwapCalldataForLiquidation', () => {
    it('should work under normal conditions', async () => {
      const inputMarket: ApiMarket = {
        id: 0,
        tokenAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        oraclePrice: new BigNumber('1234000000000000000000'),
        marginPremium: new BigNumber('0'),
        liquidationRewardPremium: new BigNumber('0'),
        decimals: 18,
        unwrapperInfo: undefined,
      };
      const outputMarket: ApiMarket = {
        id: 2,
        tokenAddress: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        oraclePrice: new BigNumber('1000000000000000000000000000000'),
        marginPremium: new BigNumber('0'),
        liquidationRewardPremium: new BigNumber('0'),
        decimals: 6,
        unwrapperInfo: undefined,
      };
      const inputAmount = new BigNumber('1000000000000000000'); // 1 ETH
      const minOutputAmount = new BigNumber('100000000'); // 100 USDC
      const solidAccount = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      const networkIdOverride = '42161';
      const dolomite = new DolomiteMargin('', Number(networkIdOverride));
      const result = await getParaswapSwapCalldataForLiquidation(
        inputMarket,
        inputAmount,
        outputMarket,
        minOutputAmount,
        solidAccount,
        dolomite.liquidatorProxyV2WithExternalLiquidity.address,
        networkIdOverride,
      );
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThanOrEqual(100);
    });
  });
});
