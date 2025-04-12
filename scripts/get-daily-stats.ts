/* eslint-disable no-console */
/** @formatter:off */
/** @formatter:on */
import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import axios from 'axios';
import v8 from 'v8';
import {
  getLiquidationsBetweenTimestamps,
  getTimestampToBlockNumberMap,
  getTotalTransactions,
  getTotalValueLockedAndFees,
} from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { TEN_BI } from '../src/lib/constants';
import Logger from '../src/lib/logger';
import '../src/lib/env';
import Pageable from '../src/lib/pageable';

const ONE_DAY_SECONDS = 86_400;
const ONE_DOLLAR = new BigNumber('1000000000000000000000000000000000000');
const PROFIT_THRESHOLD_FOR_DISPLAY: Decimal = new BigNumber(2_500);

const ignoredMarketIds: Record<string, true | undefined> = (process.env.IGNORED_MARKETS ?? '').split(',')
  .reduce((memo, market) => {
    memo[market] = true;
    return memo;
  }, {} as Record<string, true | undefined>);

async function start() {
  Logger.info({
    message: 'Get Daily Stats Configuration:',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId: dolomite.networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
    subgraphBlocksUrl: process.env.SUBGRAPH_BLOCKS_URL,
  });
  const startTimestamp: number = 1744243200; // April 10, 2025
  const endTimestamp: number = 1744416000; // April 12, 2025
  if (startTimestamp % ONE_DAY_SECONDS !== 0 || endTimestamp % ONE_DAY_SECONDS !== 0) {
    return Promise.reject(new Error('Invalid start timestamp or end timestamp'))
  } else if (startTimestamp === endTimestamp) {
    return Promise.reject(new Error('start timestamp cannot equal end timestamp'));
  }

  const timestamps: number[] = [];
  for (let i = startTimestamp; i <= endTimestamp; i += ONE_DAY_SECONDS) {
    timestamps.push(i);
  }
  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);

  const startBlockNumber = timestampToBlockNumberMap[startTimestamp];
  const endBlockNumber = timestampToBlockNumberMap[endTimestamp];
  const durationDaysActual = (endTimestamp - startTimestamp) / ONE_DAY_SECONDS;
  Logger.info({
    message: 'Get timestamp information:',
    startTimestamp: new Date(startTimestamp * 1000).toISOString(),
    startBlock: startBlockNumber,
    endTimestamp: new Date(endTimestamp * 1000).toISOString(),
    endBlock: endBlockNumber,
    durationDays: durationDaysActual,
  });

  const tvlAndFees = await getTotalValueLockedAndFees(
    dolomite.networkId,
    Object.values(timestampToBlockNumberMap),
  );
  // const tvlAndFees = { borrowFees: [], totalSupplyLiquidity: [], totalBorrowLiquidity: [] };
  const totalTransactions = await getTotalTransactions(
    timestampToBlockNumberMap[startTimestamp],
    timestampToBlockNumberMap[endTimestamp - ONE_DAY_SECONDS],
  );

  const allLiquidations = await Pageable.getPageableValues(async lastId => {
    const { liquidations } = await getLiquidationsBetweenTimestamps(startTimestamp, endTimestamp, lastId);
    return liquidations;
  });

  const liquidatedDebtUsd = allLiquidations.reduce((acc, l) => acc.plus(l.owedAmountUSD), INTEGERS.ZERO)

  const borrowFees = tvlAndFees.borrowFees.reduce((acc, value) => acc.plus(value), new BigNumber(0));
  const reserveFactor = INTEGERS.ONE.minus(await dolomite.getters.getEarningsRate({ blockNumber: endBlockNumber }));
  const estimatedRevenue = borrowFees.times(reserveFactor);

  const actualRevenue = await getRealFeesAccrued(startBlockNumber, endBlockNumber);

  const averageSupplyTvl = tvlAndFees.totalSupplyLiquidity
    .reduce((acc, value) => acc.plus(value), new BigNumber(0))
    .div(timestamps.length);
  const averageBorrowTvl = tvlAndFees.totalBorrowLiquidity
    .reduce((acc, value) => acc.plus(value), new BigNumber(0))
    .div(timestamps.length);
  const startTimestampString = new Date(startTimestamp * 1000).toISOString().substring(0, 10);
  const endTimestampString = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().substring(0, 10);

  console.log('----------------------------------------------------')
  console.log('-------------------- TVL Data --------------------');
  console.log('----------------------------------------------------')
  console.log('Average Supply TVL:', `$${averageSupplyTvl.toFormat(2)}`);
  console.log('Average Borrow TVL:', `$${averageBorrowTvl.toFormat(2)}`);
  console.log('Average Daily Transactions (per Day):', `${totalTransactions.div(timestamps.length).toFormat(2)}`);
  console.log('Liquidation Count:', `${allLiquidations.length}`);
  console.log('Liquidated Debt:', `$${liquidatedDebtUsd.toFormat(2)}`);
  console.log('Total Transactions:', `${totalTransactions.toFormat(2)}`);
  console.log('Total Borrow Fees:', `$${borrowFees.toFormat(2)}`);
  console.log('Total Revenue (Estimated):', `$${estimatedRevenue.toFormat(2)}`);
  console.log('Total Revenue (Actual):', `$${actualRevenue.toFormat(2)}`);
  console.log('Average Borrow Fees (per Day):', `$${borrowFees.div(timestamps.length).toFormat(2)}`);
  console.log('Average Estimated Revenue (per Day):', `$${estimatedRevenue.div(timestamps.length).toFormat(2)}`);
  console.log('Average Actual Revenue (per Day):', `$${actualRevenue.div(durationDaysActual).toFormat(2)}`);
  console.log(
    'Estimated Tabulation period:',
    `${timestamps.length} days; ${startTimestampString} through ${endTimestampString}`,
  );
  console.log(
    'Actual Tabulation period:',
    `${durationDaysActual} days; ${startTimestampString} [exclusive] through ${endTimestampString}`,
  );
  console.log();
  const estimatedAnnualizer = new BigNumber(365).div(timestamps.length);
  const annualizedBorrowFees = borrowFees.times(estimatedAnnualizer);
  const actualAnnualizer = new BigNumber(365).div(durationDaysActual);
  console.log('Annualized Borrow Fees:', `$${annualizedBorrowFees.toFormat(2)}`);
  console.log('Reserve Factor:', `${reserveFactor.times(100).toFormat(2)}%`);
  console.log('Annualized Estimated Revenue:', `$${annualizedBorrowFees.times(reserveFactor).toFormat(2)}`);
  console.log('Annualized Actual Revenue:', `$${actualRevenue.times(actualAnnualizer).toFormat(2)}`);
  console.log('----------------------------------------------------')

  return true
}

async function getRealFeesAccrued(startBlockNumber: number, endBlockNumber: number): Promise<Decimal> {
  const marketIdToTokenAddressMap = await axios.get(`https://api.dolomite.io/tokens/${dolomite.networkId}`)
    .then(response => {
      return response.data.tokens.reduce((acc, token) => {
        acc[token.marketId] = {
          marketId: token.marketId,
          address: token.id,
          decimals: token.decimals,
          symbol: token.cleanSymbol,
        };
        return acc;
      }, {} as Record<string, string>)
    });
  const marketToStartUnits: Record<string, Integer | undefined> = {};
  const startMarketsCount = (await dolomite.getters.getNumMarkets({ blockNumber: startBlockNumber })).toNumber();
  for (let i = 0; i < startMarketsCount; i += 1) {
    if (!ignoredMarketIds[i]) {
      const marketId = new BigNumber(i);
      marketToStartUnits[i] = await dolomite.getters.getNumExcessTokens(marketId, { blockNumber: startBlockNumber });
    }
  }

  let actualFees: Decimal = INTEGERS.ZERO;
  const endMarketsCount = (await dolomite.getters.getNumMarkets({ blockNumber: endBlockNumber })).toNumber();
  for (let i = 0; i < endMarketsCount; i += 1) {
    if (!ignoredMarketIds[i]) {
      const marketId = new BigNumber(i);
      const endAmount = await dolomite.getters.getNumExcessTokens(marketId, { blockNumber: endBlockNumber });
      const price = await dolomite.getters.getMarketPrice(marketId, { blockNumber: endBlockNumber });
      const diff = endAmount.minus(marketToStartUnits[i] ?? INTEGERS.ZERO);
      const totalUsdValue = endAmount.times(price).div(ONE_DOLLAR);
      if (totalUsdValue.gt(PROFIT_THRESHOLD_FOR_DISPLAY)) {
        const token = marketIdToTokenAddressMap[i];
        Logger.info({
          message: `Found profits greater than $${PROFIT_THRESHOLD_FOR_DISPLAY.toFormat(2)}`,
          token,
          units: endAmount.div(TEN_BI.pow(token.decimals)).toFormat(6),
          value: `$${totalUsdValue.toFormat(2)}`,
        })
      }

      actualFees = actualFees.plus(diff.times(price).div(ONE_DOLLAR));
    }
  }

  return actualFees;
}

start().catch(error => {
  Logger.error({
    message: `Found error while starting: ${error.toString()}`,
    error,
  });
  process.exit(1);
});
