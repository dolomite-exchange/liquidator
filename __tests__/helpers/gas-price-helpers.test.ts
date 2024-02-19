import { getGasPriceWei, resetGasPriceWei, updateGasPrice } from '../../src/helpers/gas-price-helpers';
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
      expect(getGasPriceWei()).toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));

      await updateGasPrice(dolomite);
      expect(getGasPriceWei()).not.toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));
      console.log('Arbitrum gas price:', getGasPriceWei().toFixed());
    });

    it('Successfully retrieves it for PolygonZkEvm', async () => {
      process.env.NETWORK_ID = ChainId.PolygonZkEvm.toString();
      expect(getGasPriceWei()).toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));

      await updateGasPrice(dolomite);
      expect(getGasPriceWei()).not.toEqual(new BigNumber(process.env.INITIAL_GAS_PRICE_WEI));
      console.log('Polygon zkEVM gas price:', getGasPriceWei().toFixed());
    });
  });
});
