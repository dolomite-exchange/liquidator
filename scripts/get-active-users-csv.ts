import { formatEther, parseEther } from 'ethers/lib/utils';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteUsersWithPositions, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';
import '../src/lib/env';

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore);

  // const { blockNumber } = await getSubgraphBlockNumber();
  const blockNumber = 5_252_669;
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

  const allUsers = await Pageable.getPageableValues(async (lastId) => {
    const { accounts } = await getAllDolomiteUsersWithPositions(blockNumber, lastId);
    return accounts.map(a => ({ id: a }));
  });

  const percentage = formatEther(parseEther('1').div(allUsers.length));
  const data = allUsers.map(u => `${u.id},${percentage}`).join('\r\n');
  fs.writeFileSync('scripts/output/all-users.csv', data);

  Logger.info({
    message: 'Data for Dolomite accounts',
    allUsers: allUsers.length,
  });
  return true
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
