import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { BigNumber as ZapBigNumber, MinimalApiToken } from '@dolomite-exchange/zap-sdk';
import { ContractTransaction, ethers } from 'ethers';
import v8 from 'v8';
import DolomiteERC4626Abi from '../src/abis/dolomite-erc-4626.json';
import { DolomiteERC4626 } from '../src/abis/DolomiteERC4626';
import { getDolomiteRiskParams, SOLID_ACCOUNT } from '../src/clients/dolomite';
import { zap } from '../src/helpers/dolomite-helpers';
import { getTypedGasPriceWeiWithModifications, updateGasPrice } from '../src/helpers/gas-price-helpers';
import {
  estimateGasSwapViaGenericTraderProxy,
  swapViaGenericTraderProxy,
} from '../src/helpers/generic-trader-proxy-v2-helper';
import { dolomite, loadAccounts } from '../src/helpers/web3';
import '../src/lib/env';
import Logger from '../src/lib/logger';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';

const D_USDC_ADDRESS = '0x444868B6e8079ac2c55eea115250f92C2b2c4D14';
const SAFE_ADDRESS = '0xa75c21C5BE284122a87A37a76cc6C4DD3E55a1D4';
const TEN = new BigNumber('10');

const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL!);

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore, false);

  await blockStore._update();

  const blockNumber = blockStore.getBlockNumber()!;
  const { riskParams } = await getDolomiteRiskParams(blockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (riskParams.dolomiteMargin !== libraryDolomiteMargin) {
    const message = `Invalid dolomite margin address found!\n
    { network: ${riskParams.dolomiteMargin} library: ${libraryDolomiteMargin} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  await loadAccounts();

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignoredMarkets: process.env.IGNORED_MARKETS?.split(',').map(m => parseInt(m, 10)) ?? [],
    networkId,
    solidAccount: SOLID_ACCOUNT.owner,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();
  await updateGasPrice(dolomite);

  Logger.info({
    message: 'Finished updating markets',
  });

  const markets = Object.values(marketStore.getMarketMap());
  const dUsdc = new ethers.Contract(D_USDC_ADDRESS, DolomiteERC4626Abi, provider) as DolomiteERC4626;
  const usdcToken: MinimalApiToken = {
    marketId: new ZapBigNumber((await dUsdc.marketId()).toString()),
    symbol: 'USDC',
  };

  let transaction: ContractTransaction | undefined;
  let nonce = await dolomite.web3.eth.getTransactionCount(SOLID_ACCOUNT.owner);
  for (let i = 0; i < markets.length; i += 1) {
    const market = markets[i];
    if (
      !market.borrowLiquidity
      || market.borrowLiquidity.eq(INTEGERS.ZERO)
      || market.marketId === usdcToken.marketId.toNumber()
    ) {
      // eslint-disable-next-line no-continue
      continue;
    }

    let keepFactor = INTEGERS.ONE;
    if (market.symbol === 'WBERA') {
      keepFactor = new BigNumber(0.8);
    }

    const maretId = new BigNumber(market.marketId);
    const rawBalance = await dolomite.getters.getAccountWei(SOLID_ACCOUNT.owner, INTEGERS.ZERO, maretId);
    const balance = rawBalance.times(keepFactor).dividedToIntegerBy(INTEGERS.ONE);
    const balanceUSD = balance.times(market.oraclePrice).div(TEN.pow(36));
    if (balanceUSD.lt(100)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const heldToken: MinimalApiToken = {
      marketId: new ZapBigNumber(market.marketId),
      symbol: market.symbol,
    };
    const zaps = await zap.getSwapExactTokensForTokensParams(
      heldToken,
      new ZapBigNumber(balance.toFixed()),
      usdcToken,
      new ZapBigNumber(1),
      SOLID_ACCOUNT.owner,
      { slippageTolerance: 0.05 },
    );
    if (zaps.length === 0) {
      Logger.warn({
        message: `Could not generate zaps for ${market.symbol} (${market.marketId})`,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    Logger.info({
      message: `Performing swap for ${market.symbol} (${market.marketId})`,
      balance: balance.div(TEN.pow(market.decimals)).toFormat(6),
      balanceUSD: `$${balanceUSD.toFormat(2)}`,
      minOutputAmount: `${zaps[0].amountWeisPath[zaps[0].amountWeisPath.length - 1].toFixed(0)} USDC (wei)`,
    });

    const inputAmount = keepFactor.eq(INTEGERS.ONE) ? INTEGERS.MAX_UINT : balance;
    const gasLimit = await estimateGasSwapViaGenericTraderProxy(inputAmount, zaps[0]);
    transaction = await swapViaGenericTraderProxy(inputAmount, zaps[0], gasLimit, { nonce: nonce++ });
    Logger.info({
      message: `Transaction hash: ${transaction.hash}`,
    });
  }

  if (transaction) {
    await transaction.wait();
  }

  const balance = await dolomite.token.getBalance(
    D_USDC_ADDRESS,
    SOLID_ACCOUNT.owner,
  );
  if (balance.gt(new BigNumber(100).times(TEN.pow(6)))) {
    Logger.info({
      message: 'Transferring dUSDC to Safe',
      balance: balance.div(TEN.pow(6)).toFormat(2),
    });
    const result = await dolomite.token.transfer(
      D_USDC_ADDRESS,
      SOLID_ACCOUNT.owner,
      SAFE_ADDRESS,
      balance,
      getTypedGasPriceWeiWithModifications(),
    );
    Logger.info({
      message: `Transaction hash: ${result.transactionHash}`,
    });
  }

  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
