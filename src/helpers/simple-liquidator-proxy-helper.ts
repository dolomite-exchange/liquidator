import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { ISOLATION_MODE_CONVERSION_MARKET_ID_MAP } from '@dolomite-exchange/zap-sdk';
import { ContractTransaction } from 'ethers';
import { SOLID_ACCOUNT } from '../clients/dolomite';
import { ApiAccount } from '../lib/api-types';
import { estimateGasOrFallbackIfDisabled, getGasLimitForExecution } from './gas-estimate-helpers';
import { getTypedGasPriceWeiWithModifications } from './gas-price-helpers';
import { liquidatorProxyV1 } from './web3';

const networkId = Number(process.env.NETWORK_ID);

export async function liquidateSimple(
  liquidAccount: ApiAccount,
  owedMarkets: Integer[],
  collateralMarkets: Integer[],
  gasLimit: Integer,
): Promise<ContractTransaction> {
  const owedMarketsConverted = owedMarkets.map(m => m.toNumber());
  const collateralMarketsConverted = collateralMarkets.map(m => m.toNumber());

  const isolationModeAssets = collateralMarketsConverted
    .filter(m => ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[networkId][m]);
  if (isolationModeAssets.length > 0) {
    const assetsString = isolationModeAssets.join(', ');
    return Promise.reject(new Error(`Invalid collateral, found isolation mode asset: ${assetsString}`));
  }

  return liquidatorProxyV1.functions.liquidate(
    SOLID_ACCOUNT.owner,
    SOLID_ACCOUNT.number,
    liquidAccount.owner,
    liquidAccount.number,
    new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION as string),
    new BigNumber(process.env.MIN_VALUE_LIQUIDATED as string),
    owedMarketsConverted,
    collateralMarketsConverted,
    {
      ...getTypedGasPriceWeiWithModifications(),
      gasLimit: getGasLimitForExecution(gasLimit).toFixed(0),
    },
  );
}

export async function estimateGasLiquidateSimple(
  liquidAccount: ApiAccount,
  owedMarkets: Integer[],
  collateralMarkets: Integer[],
): Promise<Integer> {
  const owedMarketsConverted = owedMarkets.map(m => m.toNumber());
  const collateralMarketsConverted = collateralMarkets.map(m => m.toNumber());

  const isolationModeAssets = collateralMarketsConverted
    .filter(m => ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[networkId][m]);
  if (isolationModeAssets.length > 0) {
    const assetsString = isolationModeAssets.join(', ');
    return Promise.reject(new Error(`Invalid collateral, found isolation mode asset: ${assetsString}`));
  }

  return estimateGasOrFallbackIfDisabled(
    async () => {
      const gasLimit = await liquidatorProxyV1.estimateGas.liquidate(
        SOLID_ACCOUNT.owner,
        SOLID_ACCOUNT.number,
        liquidAccount.owner,
        liquidAccount.number,
        new BigNumber(process.env.MIN_ACCOUNT_COLLATERALIZATION as string),
        new BigNumber(process.env.MIN_VALUE_LIQUIDATED as string),
        owedMarketsConverted,
        collateralMarketsConverted,
      );
      return new BigNumber(gasLimit.toString());
    },
  );
}
