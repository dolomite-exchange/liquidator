import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { getSubgraphBlockNumber } from '../src/helpers/block-helper';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';
import '../src/lib/env';

const YT_GLP_MARKET_ID = 16;
const YT_GLP_TOKEN_ADDRESS = '0x56051f8e46b67b4d286454995dBC6F5f3C433E34';

async function start() {
  const blockStore = new BlockStore()
  const marketStore = new MarketStore(blockStore);

  const { blockNumber } = await getSubgraphBlockNumber();
  const { riskParams } = await getDolomiteRiskParams(blockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address
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

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();

  const marketMap = marketStore.getMarketMap();
  const marketIndexMap = await marketStore.getMarketIndexMap(marketMap);

  const accounts = await Pageable.getPageableValues(async (lastId) => {
    const { accounts: innerAccounts } = await getAllDolomiteAccountsWithSupplyValue(
      marketIndexMap,
      blockNumber,
      lastId,
    );
    return innerAccounts;
  });

  const accountToDolomiteBalanceMap: Record<string, BigNumber> = {};
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const dolomiteBalance = Object.values(account.balances)
      .reduce((memo, balance) => {
        if (balance.marketId === YT_GLP_MARKET_ID) {
          // increase the borrow size by the premium
          memo = memo.plus(balance.par);
        }
        return memo;
      }, INTEGERS.ZERO);
    const oldBalance = accountToDolomiteBalanceMap[account.owner] ?? INTEGERS.ZERO;
    accountToDolomiteBalanceMap[account.owner] = oldBalance.plus(dolomiteBalance);
  }

  let invalidBalanceCount = 0;
  const accountOwners = Object.keys(accountToDolomiteBalanceMap);
  for (let i = 0; i < accountOwners.length; i += 1) {
    const dolomiteBalance = accountToDolomiteBalanceMap[accountOwners[i]];
    if (dolomiteBalance.gt(INTEGERS.ZERO)) {
      const actualBalance = await dolomite.token.getBalance(YT_GLP_TOKEN_ADDRESS, accountOwners[i], { blockNumber });

      if (!dolomiteBalance.eq(actualBalance)) {
        invalidBalanceCount += 1;
        Logger.warn({
          message: 'Found invalid balance for account',
          account: accountOwners[i],
          dolomiteBalance: dolomiteBalance.div(1e18).toFixed(18),
          actualBalance: actualBalance.div(1e18).toFixed(18),
          holeBalance: dolomiteBalance.minus(actualBalance).div(1e18).toFixed(18),
        });
      }
    }
  }

  Logger.info(`Number of invalid balances found ${invalidBalanceCount}`);
  return true
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
