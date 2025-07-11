import { ContractCallOptions, Integer } from '@dolomite-exchange/dolomite-margin';
import { ConfirmationType, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { ApiAsyncAction, ApiAsyncActionType } from '@dolomite-exchange/zap-sdk';
import { ApiMarketConverter } from '@dolomite-exchange/zap-sdk/dist/src/lib/ApiTypes';
import { ContractTransaction, ethers, type PayableOverrides } from 'ethers';
import AsyncUnwrapperAbi from '../abis/async-unwrapper-trader.json';
import AsyncWrapperAbi from '../abis/async-wrapper-trader.json';
import IsolationModeFreezableLiquidatorProxyAbi from '../abis/isolation-mode-freezable-liquidator-proxy.json';
import { IsolationModeFreezableLiquidatorProxy } from '../abis/IsolationModeFreezableLiquidatorProxy';
import { ApiAccount } from '../lib/api-types';
import { getGasPriceWeiWithModifications, getTypedGasPriceWeiWithModifications } from './gas-price-helpers';
import { dolomite } from './web3';

const solidAccountOwner = process.env.ACCOUNT_WALLET_ADDRESS as string;

const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
const isolationModeFreezableLiquidatorProxy = new ethers.Contract(
  ModuleDeployments.IsolationModeFreezableLiquidatorProxyV3[process.env.NETWORK_ID!].address,
  IsolationModeFreezableLiquidatorProxyAbi,
  new ethers.Wallet(process.env.ACCOUNT_WALLET_PRIVATE_KEY!, provider),
) as IsolationModeFreezableLiquidatorProxy;

export async function emitEventFinalizingEvent(
  action: ApiAsyncAction,
  converter: ApiMarketConverter,
  options: ContractCallOptions = {},
): Promise<TxResult> {
  if (action.actionType === ApiAsyncActionType.DEPOSIT) {
    const wrapper = new dolomite.web3.eth.Contract(AsyncWrapperAbi, converter.wrapper);
    return dolomite.contracts.callContractFunction(
      wrapper.methods.emitDepositCancelled(action.key),
      {
        ...options,
        gasPrice: getGasPriceWeiWithModifications().toFixed(),
        from: solidAccountOwner,
        confirmationType: ConfirmationType.Hash,
      },
    );
  } else if (action.actionType === ApiAsyncActionType.WITHDRAWAL) {
    const unwrapper = new dolomite.web3.eth.Contract(AsyncUnwrapperAbi, converter.unwrapper);
    return dolomite.contracts.callContractFunction(
      unwrapper.methods.emitWithdrawalExecuted(action.key),
      {
        ...options,
        gasPrice: getGasPriceWeiWithModifications().toFixed(),
        from: solidAccountOwner,
        confirmationType: ConfirmationType.Hash,
      },
    );
  }

  return Promise.reject(new Error(`Invalid actionType, found ${action.actionType}`));
}

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
        gasPrice: getGasPriceWeiWithModifications().toFixed(),
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
        gasPrice: getGasPriceWeiWithModifications().toFixed(),
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
  overrides?: PayableOverrides & { from?: string },
): Promise<ContractTransaction> {
  const gas = getTypedGasPriceWeiWithModifications();
  return isolationModeFreezableLiquidatorProxy.prepareForLiquidation(
    {
      liquidAccount: { owner: liquidAccount.owner, number: liquidAccount.number.toFixed() },
      freezableMarketId: freezableMarketId.toFixed(),
      inputTokenAmount: inputTokenAmount.toFixed(),
      outputMarketId: outputMarketId.toFixed(),
      minOutputAmount: minOutputAmount.toFixed(),
      expirationTimestamp: expirationTimestamp ? expirationTimestamp.toString() : '0',
      extraData,
    },
    {
      ...overrides,
      ...gas,
    },
  )
}
