import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { BYTES_EMPTY } from '@dolomite-exchange/zap-sdk/dist/src/lib/Constants';
import v8 from 'v8';
import {
  getAllIsolationModeVaultAddresses,
  getApiAccountsFromAddresses,
  getDolomiteRiskParams,
} from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ApiAccount } from '../src/lib/api-types';
import '../src/lib/env';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import { chunkArray } from '../src/lib/utils';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';
import DolomiteMigratorAbi from './abis/dolomite-migrator.json';

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore);

  await blockStore._update();

  const blockNumber = blockStore.getBlockNumber()!;
  const { riskParams } = await getDolomiteRiskParams(blockNumber);
  const networkId = await dolomite.web3.eth.net.getId();
  const fromMarketId = process.env.FROM_MARKET_ID;
  const toMarketId = process.env.TO_MARKET_ID;

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
  } else if (!fromMarketId || Number.isNaN(parseInt(fromMarketId, 10))) {
    return Promise.reject(new Error(`Invalid fromMarketId, found: ${fromMarketId}`));
  } else if (!toMarketId || Number.isNaN(parseInt(toMarketId, 10))) {
    return Promise.reject(new Error(`Invalid toMarketId, found: ${toMarketId}`));
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
  const isolationModeTokenAddress = marketMap[fromMarketId].tokenAddress;

  // These accounts are not actually liquidatable, but rather accounts that have ANY debt.
  const allVaultAccounts = await Pageable.getPageableValues(async (lastId) => {
    const { vaultAccounts } = await getAllIsolationModeVaultAddresses(isolationModeTokenAddress, blockNumber, lastId);
    return vaultAccounts;
  });

  const accounts: ApiAccount[] = [];
  const vaultChunks = chunkArray(allVaultAccounts, 100);
  for (let i = 0; i < vaultChunks.length; i += 1) {
    const { accounts: chunkedAccounts } = await getApiAccountsFromAddresses(
      vaultChunks[i].map(v => v.vault),
      marketIndexMap,
      blockNumber,
    );
    accounts.push(...chunkedAccounts.filter(a => Object.keys(a.balances).length > 0));
  }

  const accountChunks = chunkArray(accounts, 10);
  const migrator = new dolomite.web3.eth.Contract(
    DolomiteMigratorAbi,
    ModuleDeployments.DolomiteMigratorV1[networkId].address,
  );
  for (let i = 0; i < accountChunks.length; i += 1) {
    await dolomite.contracts.callContractFunction(
      migrator.methods.migrate(
        accountChunks[i].map(a => ({ owner: a.owner, number: a.number.toFixed() })),
        fromMarketId,
        toMarketId,
        BYTES_EMPTY,
      ),
    );
  }

  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
