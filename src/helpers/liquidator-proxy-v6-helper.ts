import { BigNumber, ContractCallOptions, Integer } from '@dolomite-exchange/dolomite-margin';
import { TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { ZapOutputParam } from '@dolomite-exchange/zap-sdk';
import axios from 'axios';
import { SOLID_ACCOUNT } from '../clients/dolomite';
import { ApiAccount } from '../lib/api-types';
import Logger from '../lib/logger';
import { dolomite, liquidatorProxyV6 } from './web3';

const networkId = Number(process.env.NETWORK_ID);

const TEN = new BigNumber(10);

async function getWithdrawAllReward(liquidAccount: ApiAccount, zapOutput: ZapOutputParam) {
  const outputMarketId = zapOutput.marketIdsPath[zapOutput.marketIdsPath.length - 1];
  try {
    const resultJson = await axios.get(`https://api.dolomite.io/tokens/${networkId}`)
      .then(res => {
        if (res.status !== 200) {
          return Promise.reject(new Error(`Failed to fetch token info: ${res.statusText}`));
        }

        return Promise.resolve(res.data);
      });
    const outputMarketInfo = resultJson.tokens.find(t => t.marketId === outputMarketId.toFixed());
    const decimals = parseInt(outputMarketInfo.decimals, 10);
    const currentWei = new BigNumber(outputMarketInfo.supplyLiquidity).times(TEN.pow(decimals));
    const maxSupplyWei = new BigNumber(outputMarketInfo.riskInfo.supplyMaxWei).times(TEN.pow(decimals));
    const outputBalance = liquidAccount.balances[outputMarketId.toFixed()].wei; // must be negative here
    // Reward is the amount ABOVE 0 when the debt is repaid
    const reward = outputBalance.plus(zapOutput.amountWeisPath[zapOutput.amountWeisPath.length - 1].toFixed());
    return !(maxSupplyWei === null || reward.plus(currentWei).lt(maxSupplyWei));
  } catch (e) {
    Logger.error({
      message: 'Could not get available liquidity from Dolomite Server...',
      error: e,
    })
    return false;
  }
}

export async function liquidateV6(
  liquidAccount: ApiAccount,
  inputTokenAmount: Integer,
  zapOutput: ZapOutputParam,
  minOutputAmount: Integer,
  expirationTimestamp: number | null,
  options: ContractCallOptions = {},
): Promise<TxResult> {
  const withdrawAllReward = await getWithdrawAllReward(liquidAccount, zapOutput);

  return dolomite.contracts.callContractFunction(
    liquidatorProxyV6.methods.liquidate({
      solidAccount: { owner: SOLID_ACCOUNT.owner, number: SOLID_ACCOUNT.number.toFixed() },
      liquidAccount: { owner: liquidAccount.owner, number: liquidAccount.number.toFixed() },
      marketIdsPath: zapOutput.marketIdsPath.map((p) => p.toFixed()),
      inputAmountWei: inputTokenAmount.toFixed(),
      minOutputAmountWei: minOutputAmount.toFixed(),
      tradersPath: zapOutput.traderParams,
      makerAccounts: zapOutput.makerAccounts,
      expirationTimestamp: expirationTimestamp ? expirationTimestamp.toString() : '0',
      withdrawAllReward,
    }),
    options,
  );
}
