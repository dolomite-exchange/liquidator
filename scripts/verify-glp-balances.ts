/*@formatter:off*/
/*@formatter:on*/
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { getSubgraphBlockNumber } from '../src/helpers/block-helper';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import GlpIsolationModeVaultAbi from './abis/glp-isolation-mode-vault.json';
import vGlpAbi from './abis/gmx-vester.json';
import './lib/env-reader';

const GLP_MARKET_ID = 6;
const GLP_TOKEN_ADDRESS = '0x1aDDD80E6039594eE970E5872D247bf0414C8903';
const V_GLP_TOKEN_ADDRESS = '0xa75287d2f8b217273e7fcd7e86ef07d33972042e';

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

  const accountToDolomiteBalanceMap: Record<string, BigNumber> = {};
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const dolomiteBalance = Object.values(account.balances)
      .reduce((memo, balance) => {
        if (balance.marketId === GLP_MARKET_ID) {
          memo = memo.plus(balance.par);
        }
        return memo;
      }, INTEGERS.ZERO);
    const oldBalance = accountToDolomiteBalanceMap[account.owner] ?? INTEGERS.ZERO;
    accountToDolomiteBalanceMap[account.owner] = oldBalance.plus(dolomiteBalance);
  }

  const vGlpToken = new dolomite.web3.eth.Contract(vGlpAbi, V_GLP_TOKEN_ADDRESS);

  let invalidBalanceCount = 0;
  let totalGmxBalances = new BigNumber(0);
  const accountOwners = Object.keys(accountToDolomiteBalanceMap);
  for (let i = 0; i < accountOwners.length; i++) {
    const dolomiteBalance = accountToDolomiteBalanceMap[accountOwners[i]];
    if (dolomiteBalance.gt(INTEGERS.ZERO)) {
      const glpIsolationModeVault = new dolomite.web3.eth.Contract(GlpIsolationModeVaultAbi, accountOwners[i]);
      const [nakedBalance, vGlpBalanceString, gmxBalanceString] = await Promise.all([
        dolomite.token.getBalance(GLP_TOKEN_ADDRESS, accountOwners[i], { blockNumber }),
        dolomite.contracts.callConstantContractFunction(
          vGlpToken.methods['pairAmounts'](accountOwners[i]),
          { blockNumber },
        ),
        dolomite.contracts.callConstantContractFunction(
          glpIsolationModeVault.methods['gmxBalanceOf'](),
          { blockNumber },
        ),
      ]);
      const actualBalance = nakedBalance.plus(vGlpBalanceString);
      totalGmxBalances = totalGmxBalances.plus(gmxBalanceString);

      if (!dolomiteBalance.eq(actualBalance)) {
        invalidBalanceCount += 1;
        Logger.warn({
          message: 'Found invalid balance for account',
          account: accountOwners[i],
          dolomiteBalance: dolomiteBalance.div(1e18).toFixed(18),
          actualBalance: actualBalance.div(1e18).toFixed(18),
          holeBalance: dolomiteBalance.minus(actualBalance).div(1e18).toFixed(18),
        })
      }
    }
  }

  Logger.info(`Total GMX: ${totalGmxBalances.div(1e18).toFixed()}`);
  Logger.info(`Number of invalid balances found ${invalidBalanceCount}`);
  return true
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
