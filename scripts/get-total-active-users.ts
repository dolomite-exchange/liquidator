/*@formatter:off*/
/*@formatter:on*/
import v8 from 'v8';
import {
  getAllDolomiteAccountsWithSupplyValue,
  getDolomiteRiskParams,
  getLiquidatableDolomiteAccounts,
} from '../src/clients/dolomite';
import { getSubgraphBlockNumber } from '../src/helpers/block-helper';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import './lib/env-reader';

async function start() {
  const marketStore = new MarketStore();

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

  const debtAccounts = await Pageable.getPageableValues(async (pageIndex) => {
    const { accounts } = await getLiquidatableDolomiteAccounts(marketIndexMap, blockNumber, pageIndex);
    return accounts;
  });
  const debtAccountsTallied = debtAccounts.reduce((acc, account) => {
    acc[account.owner] = true;
    return acc;
  }, {});
  const supplyAccounts = await Pageable.getPageableValues(async (lastId) => {
    const { accounts } = await getAllDolomiteAccountsWithSupplyValue(marketIndexMap, blockNumber, lastId);
    return accounts;
  });
  const supplyAccountsTallied = supplyAccounts.reduce((acc, account) => {
    acc[account.owner] = true;
    return acc;
  }, {});

  Logger.info({
    message: 'Data for Dolomite accounts',
    debtAccounts: Object.keys(debtAccountsTallied).length,
    supplyAccounts: Object.keys(supplyAccountsTallied).length,
  });
  return true
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
