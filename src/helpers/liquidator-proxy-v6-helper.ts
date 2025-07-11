import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { ZapOutputParam } from '@dolomite-exchange/zap-sdk';
import type { ContractTransaction } from 'ethers';
import { SOLID_ACCOUNT } from '../clients/dolomite';
import { ApiAccount, ApiMarket } from '../lib/api-types';
import { GAS_ESTIMATION_MULTIPLIER } from '../lib/constants';
import { getTypedGasPriceWeiWithModifications } from './gas-price-helpers';
import { liquidatorProxyV6 } from './web3';

const TEN = new BigNumber(10);

function getWithdrawAllReward(
  liquidAccount: ApiAccount,
  zapOutput: ZapOutputParam,
  marketMap: { [marketId: string]: ApiMarket },
) {
  const outputMarketId = zapOutput.marketIdsPath[zapOutput.marketIdsPath.length - 1];
  const outputMarket = marketMap[outputMarketId.toFormat()];
  const multiplier = TEN.pow(outputMarket.decimals);
  const currentWei = outputMarket.supplyLiquidity?.times(multiplier);
  const maxSupplyWei = outputMarket.maxSupplyLiquidity?.times(multiplier);
  const outputBalance = liquidAccount.balances[outputMarketId.toFixed()].wei; // must be negative here
  // Reward is the amount ABOVE 0 when the debt is repaid
  const reward = outputBalance.plus(zapOutput.amountWeisPath[zapOutput.amountWeisPath.length - 1].toFixed());
  return !(!currentWei || !maxSupplyWei || reward.plus(currentWei).lt(maxSupplyWei));
}

export async function liquidateV6(
  liquidAccount: ApiAccount,
  inputTokenAmount: Integer,
  zapOutput: ZapOutputParam,
  minOutputAmount: Integer,
  expirationTimestamp: number | null,
  marketMap: { [marketId: string]: ApiMarket },
  gasLimit: Integer,
): Promise<ContractTransaction> {
  const withdrawAllReward = getWithdrawAllReward(liquidAccount, zapOutput, marketMap);
  return liquidatorProxyV6.liquidate(
    {
      solidAccount: { owner: SOLID_ACCOUNT.owner, number: SOLID_ACCOUNT.number.toFixed() },
      liquidAccount: { owner: liquidAccount.owner, number: liquidAccount.number.toFixed() },
      marketIdsPath: zapOutput.marketIdsPath.map((p) => p.toFixed()),
      inputAmountWei: inputTokenAmount.toFixed(),
      minOutputAmountWei: minOutputAmount.toFixed(),
      tradersPath: zapOutput.traderParams,
      makerAccounts: zapOutput.makerAccounts,
      expirationTimestamp: expirationTimestamp ? expirationTimestamp.toString() : '0',
      withdrawAllReward,
    },
    {
      ...getTypedGasPriceWeiWithModifications(),
      gasLimit: gasLimit.times(GAS_ESTIMATION_MULTIPLIER).toFixed(0),
    },
  )
}

export async function liquidateV6EstimateGas(
  liquidAccount: ApiAccount,
  inputTokenAmount: Integer,
  zapOutput: ZapOutputParam,
  minOutputAmount: Integer,
  expirationTimestamp: number | null,
  marketMap: { [marketId: string]: ApiMarket },
): Promise<Integer> {
  const withdrawAllReward = getWithdrawAllReward(liquidAccount, zapOutput, marketMap);
  const gasLimit = await liquidatorProxyV6.estimateGas.liquidate(
    {
      solidAccount: { owner: SOLID_ACCOUNT.owner, number: SOLID_ACCOUNT.number.toFixed() },
      liquidAccount: { owner: liquidAccount.owner, number: liquidAccount.number.toFixed() },
      marketIdsPath: zapOutput.marketIdsPath.map((p) => p.toFixed()),
      inputAmountWei: inputTokenAmount.toFixed(),
      minOutputAmountWei: minOutputAmount.toFixed(),
      tradersPath: zapOutput.traderParams,
      makerAccounts: zapOutput.makerAccounts,
      expirationTimestamp: expirationTimestamp ? expirationTimestamp.toString() : '0',
      withdrawAllReward,
    },
    {
      ...getTypedGasPriceWeiWithModifications(),
    },
  );

  return new BigNumber(gasLimit.toString());
}
