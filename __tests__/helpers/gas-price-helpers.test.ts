import { getGasPriceWeiWithModifications, resetGasPriceWei, updateGasPrice } from '../../src/helpers/gas-price-helpers';
import { ChainId } from '../../src/lib/chain-id';
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { dolomite } from '../../src/helpers/web3';

describe('gas-price-helpers', () => {

  beforeEach(() => {
    resetGasPriceWei();
  });

  describe('#updateGasPrice', () => {
    it('Successfully retrieves it for Arbitrum', async () => {
      process.env.NETWORK_ID = ChainId.ArbitrumOne.toString();
      expect(getGasPriceWeiWithModifications()).toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));

      await updateGasPrice(dolomite);
      expect(getGasPriceWeiWithModifications()).not.toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));
      console.log('Arbitrum gas price:', getGasPriceWeiWithModifications().toFixed());
    });

    it('Successfully retrieves it for PolygonZkEvm', async () => {
      process.env.NETWORK_ID = ChainId.PolygonZkEvm.toString();
      expect(getGasPriceWeiWithModifications()).toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));

      await updateGasPrice(dolomite);
      expect(getGasPriceWeiWithModifications()).not.toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));
      console.log('Polygon zkEVM gas price:', getGasPriceWeiWithModifications().toFixed());
    });
  });
});
