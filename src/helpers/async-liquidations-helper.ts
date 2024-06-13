import { ContractCallOptions, Integer } from '@dolomite-exchange/dolomite-margin';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
// import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { ApiAsyncAction, ApiAsyncActionType } from '@dolomite-exchange/zap-sdk';
import { ApiMarketConverter } from '@dolomite-exchange/zap-sdk/dist/src/lib/Constants';
import AsyncUnwrapperAbi from '../abis/async-unwrapper-trader.json';
import AsyncWrapperAbi from '../abis/async-wrapper-trader.json';
import IsolationModeFreezableLiquidatorProxyAbi from '../abis/isolation-mode-freezable-liquidator-proxy.json';
import { ApiAccount } from '../lib/api-types';
import { getGasPriceWei } from './gas-price-helpers';
import { dolomite } from './web3';

const solidAccountOwner = process.env.ACCOUNT_WALLET_ADDRESS as string;

const isolationModeFreezableLiquidatorProxy = new dolomite.web3.eth.Contract(
  IsolationModeFreezableLiquidatorProxyAbi,
  // ModuleDeployments.IsolationModeFreezableLiquidatorProxyV3[process.env.NETWORK_ID as string].address,
  '0x76Ac5542eE033A15f78D1f8B4aD48af618a33E44',
);

export async function retryDepositOrWithdrawalAction(
  action: ApiAsyncAction,
  converter: ApiMarketConverter,
  options: ContractCallOptions = {},
): Promise<TxResult | undefined> {
  if (action.actionType === ApiAsyncActionType.DEPOSIT) {
    const wrapper = new dolomite.web3.eth.Contract(AsyncWrapperAbi, converter.wrapper);
    return dolomite.contracts.callContractFunction(
      wrapper.methods.executeDepositCancellationForRetry(action.key),
      {
        ...options,
        gasPrice: getGasPriceWei().toFixed(),
        from: solidAccountOwner,
        confirmationType: ConfirmationType.Hash,
      },
    );
  } else if (action.actionType === ApiAsyncActionType.WITHDRAWAL) {
    const unwrapper = new dolomite.web3.eth.Contract(AsyncUnwrapperAbi, converter.unwrapper);
    return dolomite.contracts.callContractFunction(
      unwrapper.methods.executeWithdrawalForRetry(action.key),
      {
        ...options,
        gasPrice: getGasPriceWei().toFixed(),
        from: solidAccountOwner,
        confirmationType: ConfirmationType.Hash,
      },
    );
  }

  return Promise.reject(new Error(`#retryDepositOrWithdrawalAction: Found unknown action type: ${action.actionType}`));
}

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
      gas: 10_000_000,
      from: solidAccountOwner,
      confirmationType: ConfirmationType.Hash,
    },
  );
}
