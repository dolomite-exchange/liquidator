import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { getDefaultGasLimit } from './gas-price-helpers';

export async function estimateGasOrFallbackIfDisabled(estimator: () => Promise<Integer>): Promise<Integer> {
  if (process.env.GAS_ESTIMATION_ENABLED === 'false') {
    return new BigNumber(getDefaultGasLimit());
  }

  return estimator();
}
