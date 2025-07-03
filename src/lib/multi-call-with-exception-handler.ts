import '../lib/env';
import { MultiCallWithExceptionHandler } from '../abis/MultiCallWithExceptionHandler';
import type { CallOverrides } from 'ethers';
import * as ethers from 'ethers';
import MultiCallWithExceptionHandlerAbi from '../abis/multi-call-with-exception-handler.json';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';

const multiCallWithExceptionHandlerAddress =
  ModuleDeployments.MultiCallWithExceptionHandler[process.env.NETWORK_ID!].address;
if (!multiCallWithExceptionHandlerAddress) {
  throw new Error('Could not find multiCallWithExceptionHandlerAddress');
}

export async function aggregateWithExceptionHandler(
  calls: MultiCallWithExceptionHandler.CallStruct[],
  overrides?: CallOverrides,
) {
  const multiCallWithExceptionHandler = new ethers.Contract(
    multiCallWithExceptionHandlerAddress,
    MultiCallWithExceptionHandlerAbi,
    new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL),
  ) as MultiCallWithExceptionHandler;
  const { returnData } = await multiCallWithExceptionHandler.callStatic.aggregate(calls, overrides);
  return returnData;
}
