import { TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { glvRegistry } from './web3';
import { dolomite } from './web3';

export async function updateGlvTokenToGmMarketForDeposit(
  glvToken: string,
  gmMarket: string
): Promise<TxResult> {
  return dolomite.contracts.callContractFunction(
    glvRegistry.methods.ownerSetGlvTokenToGmMarketForDeposit(
      glvToken,
      gmMarket
    )
  );
}

export async function updateGlvTokenToGmMarketForWithdrawal(
  glvToken: string,
  gmMarket: string
): Promise<TxResult> {
  return dolomite.contracts.callContractFunction(
    glvRegistry.methods.ownerSetGlvTokenToGmMarketForWithdrawal(
      glvToken,
      gmMarket
    )
  );
}