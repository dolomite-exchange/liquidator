import { ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { AccountInfo } from '@dolomite-exchange/zap-sdk';
import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import { BYTES_EMPTY } from '@dolomite-exchange/zap-sdk/dist/src/lib/Constants';
import v8 from 'v8';
import { getApiAccountsFromAddresses, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite, loadAccounts } from '../src/helpers/web3';
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

  await loadAccounts();

  Logger.info({
    message: 'DolomiteMargin data',
    account: dolomite.web3.eth.defaultAccount,
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

  const accounts: ApiAccount[] = await Pageable.getPageableValues(async lastId => {
    const { accounts: innerAccounts } = await getApiAccountsFromAddresses(
      isolationModeTokenAddress,
      marketIndexMap,
      blockNumber,
      lastId,
    );
    return innerAccounts.filter(a => {
      const keys = Object.keys(a.balances);
      if (keys.length === 0) {
        return false;
      }
      for (let j = 0; j < keys.length; j += 1) {
        if (!a.balances[keys[j]].par.eq(0)) {
          return true;
        }
      }
      return false;
    });
  });

  console.log('Accounts to migrate: ', accounts.length);
  const accountChunks = chunkArray(accounts, 10);
  const migrator = new dolomite.web3.eth.Contract(
    DolomiteMigratorAbi,
    ModuleDeployments.DolomiteMigratorV2[networkId].address,
  );
  for (let i = 0; i < accountChunks.length; i += 1) {
    try {
      await dolomite.contracts.callContractFunction(
        migrator.methods.migrate(
          accountChunks[i]
            .map(a => ({ owner: a.owner.toLowerCase(), number: a.number.toFixed() }))
            .filter(a => !accountsToIgnore.some(b => a.owner === b.owner && a.number === b.number)),
          fromMarketId,
          toMarketId,
          BYTES_EMPTY,
        ),
        {
          confirmationType: ConfirmationType.Hash,
          gas: 40_000_000,
          from: dolomite.web3.eth.defaultAccount,
          gasPrice: 100_000_000,
        },
      );
    } catch (e) {
      console.error(e);
    }
    await sleep(1000);
  }

  return true;
}

const accountsToIgnore: AccountInfo[] = [
  {
    owner: '0x83c723d14b61f0849637e5419a725dc06192f1d0'.toLowerCase(),
    number: '106355966584316647552964118650638526593132437016427473340879626176810999661438',
  },
  {
    owner: '0xb33b524e7fbd9010a83889112bc2d6ccdc496419'.toLowerCase(),
    number: '56578262499501044814520285659550852628945592870424513688010112081049278900960',
  },
]

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
