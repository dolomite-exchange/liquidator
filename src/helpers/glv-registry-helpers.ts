import { ContractCallOptions, TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import Contract from 'web3/eth/contract';
import { dolomite } from './web3';

export async function updateGlvTokenToGmMarketForDeposit(
  glvRegistry: Contract,
  glvToken: string,
  gmMarket: string,
  options?: ContractCallOptions,
): Promise<TxResult> {
  return dolomite.contracts.callContractFunction(
    glvRegistry.methods.handlerSetGlvTokenToGmMarketForDeposit(
      glvToken,
      gmMarket,
    ),
    options,
  );
}

export async function updateGlvTokenToGmMarketForWithdrawal(
  glvRegistry: Contract,
  glvToken: string,
  gmMarket: string,
  options?: ContractCallOptions,
): Promise<TxResult> {
  return dolomite.contracts.callContractFunction(
    glvRegistry.methods.handlerSetGlvTokenToGmMarketForWithdrawal(
      glvToken,
      gmMarket,
    ),
    options,
  );
}
