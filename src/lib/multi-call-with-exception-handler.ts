import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { ContractConstantCallOptions } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import MultiCallWithExceptionHandlerAbi from '../abis/multi-call-with-exception-handler.json';
import { dolomite } from '../helpers/web3';
import './env';

export type CallStruct = { target: string; callData: string };

const multiCallWithExceptionHandlerAddress =
  ModuleDeployments.MultiCallWithExceptionHandler[process.env.NETWORK_ID!].address;
if (!multiCallWithExceptionHandlerAddress) {
  throw new Error('Could not find multiCallWithExceptionHandlerAddress');
}

export async function aggregateWithExceptionHandler(
  calls: CallStruct[],
  options?: ContractConstantCallOptions,
) {
  const multiCallWithExceptionHandler = new dolomite.web3.eth.Contract(
    MultiCallWithExceptionHandlerAbi,
    multiCallWithExceptionHandlerAddress,
  );
  const { returnData } = await dolomite.contracts.callConstantContractFunction(
    multiCallWithExceptionHandler.methods.aggregate(calls),
    options,
  );
  return returnData;
}
