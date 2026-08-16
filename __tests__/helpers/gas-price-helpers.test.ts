import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { getGasPriceWeiWithModifications, resetGasPriceWei, updateGasPrice } from '../../src/helpers/gas-price-helpers';
import { dolomite } from '../../src/helpers/web3';
import { ChainId } from '../../src/lib/chain-id';

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
  });
});
