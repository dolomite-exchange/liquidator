import { updateGasPrice } from '../helpers/gas-price-helpers';
import { dolomite } from '../helpers/web3';
import { delay } from './delay';
import Logger from './logger';

const UPDATE_FREQUENCY_MS = Number(process.env.GAS_PRICE_POLL_INTERVAL_MS);

export default class GasPriceUpdater {
  start = () => {
    Logger.info({
      at: 'GasPriceUpdater#start',
      message: 'Starting gas price updater',
    });
    this.updateGasPrices();
  }

  updateGasPrices = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await updateGasPrice(dolomite);
      } catch (error: any) {
        Logger.error({
          at: 'GasPriceUpdater#updateGasPrices',
          message: 'Failed to update gas price',
          error,
        });
      }

      await delay(UPDATE_FREQUENCY_MS);
    }
  }
}
