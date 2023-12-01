import { DolomiteMargin, Web3 } from '@dolomite-exchange/dolomite-margin';
import { ChainId } from '../lib/chain-id';
import Logger from '../lib/logger';
import '../lib/env';

const accountWalletAddress = process.env.ACCOUNT_WALLET_ADDRESS?.toLowerCase() ?? '';
const opts = { defaultAccount: accountWalletAddress };

const provider: any = new Web3.providers.HttpProvider(process.env.ETHEREUM_NODE_URL ?? '');

const networkId = Number(process.env.NETWORK_ID);
if (Object.keys(ChainId).indexOf(networkId.toString()) === -1) {
  throw new Error(`Invalid networkId ${process.env.NETWORK_ID}`)
}

export const dolomite = new DolomiteMargin(
  provider,
  Number(process.env.NETWORK_ID),
  opts,
);

export async function loadAccounts() {
  if (!accountWalletAddress) {
    throw new Error('ACCOUNT_WALLET_ADDRESS is not defined!');
  }

  if (!process.env.ACCOUNT_WALLET_PRIVATE_KEY) {
    const errorMessage = 'ACCOUNT_WALLET_PRIVATE_KEY is not provided';
    Logger.error({
      at: 'web3#loadAccounts',
      message: errorMessage,
    });
    return Promise.reject(new Error(errorMessage));
  }

  if (!process.env.ACCOUNT_WALLET_ADDRESS) {
    const errorMessage = 'ACCOUNT_WALLET_ADDRESS is not provided';
    Logger.error({
      at: 'web3#loadAccounts',
      message: errorMessage,
    });
    return Promise.reject(new Error(errorMessage));
  }

  const dolomiteAccount = dolomite.web3.eth.accounts.wallet.add(process.env.ACCOUNT_WALLET_PRIVATE_KEY);

  if (dolomiteAccount.address.toLowerCase() !== accountWalletAddress) {
    Logger.error({
      at: 'web3#loadAccounts',
      message: 'Owner private key does not match ENV variable address',
      privateKeyResolvesTo: dolomiteAccount.address.toLowerCase(),
      environmentVariable: accountWalletAddress.toLowerCase(),
    });
    return Promise.reject(new Error('Owner private key does not match address'));
  }

  Logger.info({
    at: 'web3#loadAccounts',
    message: 'Loaded liquidator account',
    accountWalletAddress,
    dolomiteAccountNumber: process.env.DOLOMITE_ACCOUNT_NUMBER,
  });
  return Promise.resolve(dolomiteAccount.address);
}

export async function initializeDolomiteLiquidations() {
  await checkOperatorIsApproved(dolomite.contracts.expiryProxy.options.address);
  await checkOperatorIsApproved(dolomite.contracts.liquidatorProxyV1.options.address);
  await checkOperatorIsApproved(dolomite.contracts.liquidatorProxyV1WithAmm.options.address);
  await checkOperatorIsApproved(dolomite.contracts.liquidatorProxyV2WithExternalLiquidity.options.address);
  await checkOperatorIsApproved(dolomite.contracts.liquidatorProxyV3WithLiquidityToken.options.address);
  await checkOperatorIsApproved(dolomite.contracts.liquidatorProxyV4WithGenericTrader.options.address);
}

async function checkOperatorIsApproved(operator?: string) {
  if (!operator) {
    return
  }

  if (!(await getIsGlobalOperator(operator)) && !(await getIsLocalOperator(operator))) {
    Logger.info({
      at: 'web3#loadAccounts',
      message: `Proxy contract at ${operator} has not been approved. Approving...`,
      address: accountWalletAddress,
      operator,
    });

    await dolomite.permissions.approveOperator(
      operator,
      { from: accountWalletAddress },
    );
  }
}

async function getIsGlobalOperator(operator: string): Promise<boolean> {
  return dolomite.getters.getIsGlobalOperator(
    operator,
    { from: accountWalletAddress },
  );
}

async function getIsLocalOperator(operator: string): Promise<boolean> {
  return dolomite.getters.getIsLocalOperator(
    accountWalletAddress,
    operator,
    { from: accountWalletAddress },
  );
}
