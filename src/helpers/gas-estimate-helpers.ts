import { Integer } from '@dolomite-exchange/dolomite-margin';
import { GAS_ESTIMATION_MULTIPLIER } from '../lib/constants';
import { getDefaultGasLimit } from './gas-price-helpers';

export async function estimateGasOrFallbackIfDisabled(estimator: () => Promise<Integer>): Promise<Integer> {
  if (process.env.GAS_ESTIMATION_ENABLED === 'false') {
    return getDefaultGasLimit();
  }

  return estimator();
}

export function getGasLimitForExecution(gasLimit: Integer): Integer {
  if (gasLimit.gte(getDefaultGasLimit())) {
    return getDefaultGasLimit();
  }

  return gasLimit.times(GAS_ESTIMATION_MULTIPLIER);
}
