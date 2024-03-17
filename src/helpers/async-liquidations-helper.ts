import { ContractCallOptions, Integer } from '@dolomite-exchange/dolomite-margin';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import IsolationModeFreezableLiquidatorProxyAbi from '../abis/isolation-mode-freezable-liquidator-proxy.json';
import { ApiAccount } from '../lib/api-types';
import { getGasPriceWei } from './gas-price-helpers';
import { dolomite } from './web3';

const solidAccountOwner = process.env.ACCOUNT_WALLET_ADDRESS as string;

const isolationModeFreezableLiquidatorProxy = new dolomite.web3.eth.Contract(
  IsolationModeFreezableLiquidatorProxyAbi,
  ModuleDeployments.LiquidatorProxyV4WithGenericTraderOld[process.env.NETWORK_ID].address,
);

export async function prepareForLiquidation(
  liquidAccount: ApiAccount,
  freezableMarketId: Integer,
  inputTokenAmount: Integer,
  outputMarketId: Integer,
  minOutputAmount: Integer,
  expirationTimestamp: number | undefined,
  extraData: string,
  options: ContractCallOptions = {},
): Promise<TxResult> {
  return dolomite.contracts.callContractFunction(
    isolationModeFreezableLiquidatorProxy.methods.prepareForLiquidation({
      liquidAccount: { owner: liquidAccount.owner, number: liquidAccount.number.toFixed() },
      freezableMarketId: freezableMarketId.toFixed(),
      inputTokenAmount: inputTokenAmount.toFixed(),
      outputMarketId: outputMarketId.toFixed(),
      minOutputAmount: minOutputAmount.toFixed(),
      expirationTimestamp: expirationTimestamp ? expirationTimestamp.toString() : '0',
      extraData,
    }),
    {
      ...options,
      gasPrice: getGasPriceWei().toFixed(),
      from: solidAccountOwner,
      confirmationType: ConfirmationType.Hash,
    },
  )
}
