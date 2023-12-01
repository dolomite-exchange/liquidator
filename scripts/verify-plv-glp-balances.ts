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
import plvGlpFarmAbi from './abis/plv-glp-farm.json';
import './lib/env-reader';

const PLV_GLP_MARKET_ID = 9;
const PLV_GLP_TOKEN_ADDRESS = '0x5326E71Ff593Ecc2CF7AcaE5Fe57582D6e74CFF1';
const PLV_GLP_FARM_ADDRESS = '0x4e5cf54fde5e1237e80e87fcba555d829e1307ce';

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
        if (balance.marketId === PLV_GLP_MARKET_ID) {
          // increase the borrow size by the premium
          memo = memo.plus(balance.par);
        }
        return memo;
      }, INTEGERS.ZERO);
    const oldBalance = accountToDolomiteBalanceMap[account.owner] ?? INTEGERS.ZERO;
    accountToDolomiteBalanceMap[account.owner] = oldBalance.plus(dolomiteBalance);
  }

  const plvGlpFarm = new dolomite.web3.eth.Contract(plvGlpFarmAbi, PLV_GLP_FARM_ADDRESS);

  let invalidBalanceCount = 0;
  let usersNotStaking = 0;
  let amountNotStaked = new BigNumber(0);
  const accountOwners = Object.keys(accountToDolomiteBalanceMap);
  for (let i = 0; i < accountOwners.length; i++) {
    const dolomiteBalance = accountToDolomiteBalanceMap[accountOwners[i]];
    if (dolomiteBalance.gt(INTEGERS.ZERO)) {
      let actualBalance = await dolomite.token.getBalance(PLV_GLP_TOKEN_ADDRESS, accountOwners[i], { blockNumber });
      const plvGlpFarmUserInfo = await dolomite.contracts.callConstantContractFunction(
        plvGlpFarm.methods['userInfo'](accountOwners[i]),
        { blockNumber },
      );
      if (actualBalance.gt(0)) {
        usersNotStaking += 1;
        amountNotStaked = amountNotStaked.plus(actualBalance);
        Logger.info({
          message: `Found user not staking: ${accountOwners[i]}`,
          amountNotStaked: actualBalance.div(1e18).toFixed(18),
        })
      }
      const stakedPlvGlp = new BigNumber(plvGlpFarmUserInfo.amount);
      actualBalance = actualBalance.plus(stakedPlvGlp);

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

  Logger.info({
    message: `Found ${usersNotStaking} users not staking`,
    amountNotStaked: amountNotStaked.div(1e18).toFixed(18),
  });

  Logger.info(`Number of invalid balances found ${invalidBalanceCount}`);
  return true
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
