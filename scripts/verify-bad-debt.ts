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

  const accountsWithBadDebt = accounts.reduce((memo, account) => {
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
      borrowAdj: INTEGERS.ZERO,
      supplyAdj: INTEGERS.ZERO,
    };
    const MARGIN_PREMIUM_BASE = new BigNumber('1000000000000000000');
    const ONE_DOLLAR = new BigNumber(10).pow(36);
    const {
      supply,
      borrow,
      supplyAdj,
      borrowAdj,
    } = Object.values(account.balances)
      .reduce((acc, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const value = balance.wei.times(market.oraclePrice).div(ONE_DOLLAR);
        const adjust = MARGIN_PREMIUM_BASE.plus(market.marginPremium);
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          acc.borrow = acc.borrow.plus(value.abs());
          acc.borrowAdj = acc.borrowAdj.plus(value.abs().times(adjust).div(MARGIN_PREMIUM_BASE));
        } else {
          // decrease the supply size by the premium
          acc.supply = acc.supply.plus(value);
          acc.supplyAdj = acc.supplyAdj.plus(value.times(MARGIN_PREMIUM_BASE).div(adjust));
        }
        return acc;
      }, initial);

    if (borrow.gt(supply)) {
      Logger.warn({
        message: 'Found bad debt!',
        account: account.id,
        markets: Object.values(account.balances).map(b => [b.marketId.toFixed(), b.wei.toFixed()]),
        supplyUSD: supply.toFixed(6),
        borrowUSD: borrow.toFixed(6),
      });

      return memo.concat({
        ...account,
        borrow,
        supply,
      });
    } else if (borrowAdj.times('1.15').gt(supplyAdj)) {
      Logger.warn({
        message: 'Found liquid account!',
        account: account.id,
        markets: Object.values(account.balances).map(b => [b.marketId.toFixed(), b.wei.toFixed()]),
        supplyUSD: supply.toFixed(6),
        borrowUSD: borrow.toFixed(6),
      });
    } else if (borrowAdj.times('1.16').gt(supplyAdj)) {
      Logger.info({
        message: 'Found almost liquid account!',
        account: account.id,
        markets: Object.values(account.balances).map(b => [b.marketId.toFixed(), b.wei.toFixed()]),
        supplyUSD: supply.toFixed(6),
        borrowUSD: borrow.toFixed(6),
      });
    }

    return memo
  }, [] as any[]);

  if (accountsWithBadDebt.length === 0) {
    Logger.info({
      message: `No bad debt found across ${accounts.length} active margin accounts!`,
    });
  } else {
    Logger.info({
      accountsWithBadDebtLength: accountsWithBadDebt.length,
      totalBadDebt: accountsWithBadDebt.reduce((memo, account) => memo.plus(account.borrow), INTEGERS.ZERO).toFixed(),
    });
  }

  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
