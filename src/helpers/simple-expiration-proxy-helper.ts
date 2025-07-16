import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { ISOLATION_MODE_CONVERSION_MARKET_ID_MAP } from '@dolomite-exchange/zap-sdk';
import { ContractTransaction } from 'ethers';
import { SOLID_ACCOUNT } from '../clients/dolomite';
import { ApiAccount, ApiBalance } from '../lib/api-types';
import { estimateGasOrFallbackIfDisabled, getGasLimitForExecution } from './gas-estimate-helpers';
import { getTypedGasPriceWeiWithModifications } from './gas-price-helpers';
import { expiryProxy } from './web3';

const networkId = Number(process.env.NETWORK_ID);

export async function expireSimple(
  expiredAccount: ApiAccount,
  owedBalance: ApiBalance,
  heldBalance: ApiBalance,
  expiresAt: Integer,
  gasLimit: Integer,
): Promise<ContractTransaction> {
  const isolationModeAssets = [heldBalance.marketId]
    .filter(m => ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[networkId][m]);
  if (isolationModeAssets.length > 0) {
    const assetsString = isolationModeAssets.join(', ');
    return Promise.reject(new Error(`Invalid collateral, found isolation mode asset: ${assetsString}`));
  }

  return expiryProxy.functions.expire(
    SOLID_ACCOUNT.owner,
    SOLID_ACCOUNT.number,
    expiredAccount.owner,
    expiredAccount.number,
    owedBalance.marketId,
    heldBalance.marketId,
    expiresAt.toFixed(0),
    {
      ...getTypedGasPriceWeiWithModifications(),
      gasLimit: getGasLimitForExecution(gasLimit).toFixed(0),
    },
  );
}

export async function estimateGasExpireSimple(
  expiredAccount: ApiAccount,
  owedBalance: ApiBalance,
  heldBalance: ApiBalance,
  expiresAt: Integer,
): Promise<Integer> {
  const isolationModeAssets = [heldBalance.marketId]
    .filter(m => ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[networkId][m]);
  if (isolationModeAssets.length > 0) {
    const assetsString = isolationModeAssets.join(', ');
    return Promise.reject(new Error(`Invalid collateral, found isolation mode asset: ${assetsString}`));
  }

  return estimateGasOrFallbackIfDisabled(
    async () => {
      const gasLimit = await expiryProxy.estimateGas.expire(
        SOLID_ACCOUNT.owner,
        SOLID_ACCOUNT.number,
        expiredAccount.owner,
        expiredAccount.number,
        owedBalance.marketId,
        heldBalance.marketId,
        expiresAt.toFixed(0),
      );
      return new BigNumber(gasLimit.toString())
    },
  );
}
