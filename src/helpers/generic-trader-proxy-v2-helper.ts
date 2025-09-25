import { BalanceCheckFlag, BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { GenericEventEmissionType } from '@dolomite-exchange/dolomite-margin/dist/src/modules/GenericTraderProxyV1';
import { ZapOutputParam } from '@dolomite-exchange/zap-sdk';
import type { ContractTransaction } from 'ethers';
import { SOLID_ACCOUNT } from '../clients/dolomite';
import { getGasLimitForExecution } from './gas-estimate-helpers';
import { getTypedGasPriceWeiWithModifications } from './gas-price-helpers';
import { genericTraderProxyV2 } from './web3';

export async function swapViaGenericTraderProxy(
  inputTokenAmount: Integer,
  zapOutput: ZapOutputParam,
  gasLimit: Integer,
  options: any,
): Promise<ContractTransaction> {
  return genericTraderProxyV2.swapExactInputForOutput(
    {
      accountNumber: SOLID_ACCOUNT.number.toFixed(),
      marketIdsPath: zapOutput.marketIdsPath.map((p) => p.toFixed()),
      inputAmountWei: inputTokenAmount.toFixed(),
      minOutputAmountWei: zapOutput.amountWeisPath[zapOutput.amountWeisPath.length - 1].toFixed(),
      tradersPath: zapOutput.traderParams,
      makerAccounts: zapOutput.makerAccounts,
      userConfig: {
        balanceCheckFlag: BalanceCheckFlag.Both,
        deadline: Math.floor(Date.now() / 1_000) + (15 * 60),
        eventType: GenericEventEmissionType.None,
      },
    },
    {
      ...options,
      ...getTypedGasPriceWeiWithModifications(),
      gasLimit: getGasLimitForExecution(gasLimit).toFixed(0),
    },
  )
}

export async function estimateGasSwapViaGenericTraderProxy(
  inputTokenAmount: Integer,
  zapOutput: ZapOutputParam,
): Promise<Integer> {
  const gas = await genericTraderProxyV2.estimateGas.swapExactInputForOutput(
    {
      accountNumber: SOLID_ACCOUNT.number.toFixed(),
      marketIdsPath: zapOutput.marketIdsPath.map((p) => p.toFixed()),
      inputAmountWei: inputTokenAmount.toFixed(),
      minOutputAmountWei: zapOutput.amountWeisPath[zapOutput.amountWeisPath.length - 1].toFixed(),
      tradersPath: zapOutput.traderParams,
      makerAccounts: zapOutput.makerAccounts,
      userConfig: {
        balanceCheckFlag: BalanceCheckFlag.Both,
        deadline: Math.floor(Date.now() / 1_000) + (15 * 60),
        eventType: GenericEventEmissionType.None,
      },
    },
  );

  return new BigNumber(gas.toString());
}
