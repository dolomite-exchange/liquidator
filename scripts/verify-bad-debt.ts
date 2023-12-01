/*@formatter:off*/
/*@formatter:on*/
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import v8 from 'v8';
import { getDolomiteRiskParams } from '../src/clients/dolomite';
import { getSubgraphBlockNumber } from '../src/helpers/block-helper';
import { dolomite } from '../src/helpers/web3';
import AccountStore from '../src/lib/account-store';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import './lib/env-reader';

/* eslint-enable */

async function start() {
  const marketStore = new MarketStore();
  const accountStore = new AccountStore(marketStore);

  const { blockNumber } = await getSubgraphBlockNumber();
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

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();
  await accountStore._update();

  const marketMap = marketStore.getMarketMap();

  // These accounts are not actually liquidatable, but rather accounts that have ANY debt.
  const accounts = accountStore.getLiquidatableDolomiteAccounts();

  const accountsWithBadDebt = accounts.filter(account => {
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
    };
    const ONE_DOLLAR = new BigNumber(10).pow(36);
    const {
      supply,
      borrow,
    } = Object.values(account.balances)
      .reduce((memo, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const value = balance.wei.times(market.oraclePrice).div(ONE_DOLLAR);
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          memo.borrow = memo.borrow.plus(value);
        } else {
          // decrease the supply size by the premium
          memo.supply = memo.supply.plus(value);
        }
        return memo;
      }, initial);

    if (borrow.gt(supply)) {
      Logger.warn({
        message: 'Found bad debt!',
        account: account.id,
        supplyUSD: supply.toFixed(6),
        borrowUSD: borrow.toFixed(6),
      });
    }

    return borrow.gt(supply);
  });

  if (accountsWithBadDebt.length === 0) {
    Logger.info({
      message: `No bad debt found across ${accounts.length} active margin accounts!`,
    });
  } else {
    Logger.info({
      accountsWithBadDebtLength: accountsWithBadDebt.length,
      accountsWithBadDebt: accountsWithBadDebt,
    });
  }

  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
