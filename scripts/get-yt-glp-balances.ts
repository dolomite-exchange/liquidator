/*@formatter:off*/
import {BigNumber} from '@dolomite-exchange/dolomite-margin';
import {parseEther} from 'ethers/lib/utils';
/*@formatter:on*/
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { getSubgraphBlockNumber } from '../src/helpers/block-helper';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import './lib/env-reader';

const YT_GLP_MARKET_ID = 16;

const MIN_AMOUNT = new BigNumber(parseEther('2000').toString());

interface PrintableBalance {
  symbol: string;
  amount: string;
}

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

  const accounts = await Pageable.getPageableValues(async (lastId) => {
    const { accounts } = await getAllDolomiteAccountsWithSupplyValue(marketIndexMap, blockNumber, lastId);
    return accounts;
  });

  const accountToSubAccountToDolomiteBalanceMap: Record<string, Record<string, PrintableBalance[]>> = {};
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const accountAddress = account.owner;
    accountToSubAccountToDolomiteBalanceMap[accountAddress] = accountToSubAccountToDolomiteBalanceMap[accountAddress]
      ?? {};
    const balances = Object.values(account.balances)
      .reduce<PrintableBalance[]>((memo, balance, _unused, balances) => {
        if (balance.marketId === YT_GLP_MARKET_ID && balance.par.gt(MIN_AMOUNT)) {
          return balances.map(balance => {
            return {
              symbol: balance.tokenSymbol,
              amount: balance.wei.div(new BigNumber(10).pow(balance.tokenDecimals)).toString(),
            }
          });
        }
        return memo;
      }, []);
    if (balances.length > 0) {
      accountToSubAccountToDolomiteBalanceMap[accountAddress][account.number.toString()] = balances;
    }
    if (Object.keys(accountToSubAccountToDolomiteBalanceMap[accountAddress]).length === 0) {
      delete accountToSubAccountToDolomiteBalanceMap[accountAddress];
    }
  }

  let totalCount = 0;
  Object.keys(accountToSubAccountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToSubAccountToDolomiteBalanceMap[account]).forEach(subAccount => {
      const balances = accountToSubAccountToDolomiteBalanceMap[account][subAccount];
      totalCount += 1;
      Logger.info({
        message: 'YT-GLP balance for account',
        account: account,
        subAccount: subAccount,
        assetsWithBalances: balances,
      });
    });
  });

  Logger.info(`Number of positions found: ${totalCount}`);
  console.log('All positions:', JSON.stringify(accountToSubAccountToDolomiteBalanceMap));
  return true
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
