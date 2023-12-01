import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import liquidityMiningConfig from './config/oarb-season-0.json';
import './lib/env-reader';
import {
  addLiquidityMiningVestingPositions,
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getLiquidityPositionAndEvents,
} from './lib/event-parser';
import { calculateFinalPoints, calculateLiquidityPoints, calculateTotalRewardPoints } from './lib/rewards';

/* eslint-enable */

interface OutputFile {
  epochs: {
    [epoch: string]: {
      [walletAddressLowercase: string]: {
        [marketId: string]: string // big int
      }
    }
  };
  metadata: {
    [epoch: string]: {
      totalPointsPerMarket: {
        [marketId: string]: string // big int
      }
    }
  };
}

const FOLDER_NAME = `${__dirname}/output`;

async function start() {
  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }
  const maxMarketId = (await dolomite.getters.getNumMarkets()).toNumber();
  const marketIds = (process.env.MARKET_IDS?.split(',') ?? []).map(marketId => parseInt(marketId.trim(), 10));
  if (marketIds.length === 0 || marketIds.some(marketId => Number.isNaN(marketId))) {
    return Promise.reject(new Error(`Invalid MARKET_IDS, found: ${process.env.MARKET_IDS}`));
  } else if (marketIds.some(marketId => marketId >= maxMarketId)) {
    return Promise.reject(new Error(`MARKET_IDS contains an element that is too large, found: ${marketIds}`));
  }

  const marketStore = new MarketStore();

  const blockRewardStart = liquidityMiningConfig.epochs[epoch].startBlockNumber;
  const blockRewardStartTimestamp = liquidityMiningConfig.epochs[epoch].startTimestamp;
  const blockRewardEnd = liquidityMiningConfig.epochs[epoch].endBlockNumber;
  const blockRewardEndTimestamp = liquidityMiningConfig.epochs[epoch].endTimestamp;

  const marketToIsValidMap = marketIds.reduce((memo, marketId) => {
    memo[marketId] = true;
    return memo;
  }, {});

  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
    blockRewardStart,
    blockRewardStartTimestamp,
    blockRewardEnd,
    blockRewardEndTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    marketToIsValidMap,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();

  const marketMap = marketStore.getMarketMap();
  const marketIndexMap = await marketStore.getMarketIndexMap(marketMap);

  const apiAccounts = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllDolomiteAccountsWithSupplyValue(marketIndexMap, blockRewardStart, lastId);
    return result.accounts;
  });

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(apiAccounts, blockRewardStartTimestamp);
  await addLiquidityMiningVestingPositions(accountToDolomiteBalanceMap, blockRewardStart);

  const accountToAssetToEventsMap = await getBalanceChangingEvents(blockRewardStart, blockRewardEnd);

  const totalPointsPerMarket = calculateTotalRewardPoints(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    blockRewardStartTimestamp,
    blockRewardEndTimestamp,
  );
  const allMarketIds = Object.keys(totalPointsPerMarket);
  allMarketIds.forEach(marketId => {
    if (!marketToIsValidMap[marketId]) {
      delete totalPointsPerMarket[marketId];
    }
  });

  const { ammLiquidityBalances, userToLiquiditySnapshots } = await getLiquidityPositionAndEvents(
    blockRewardStart,
    blockRewardEnd,
    blockRewardStartTimestamp,
  );
  calculateLiquidityPoints(
    ammLiquidityBalances,
    userToLiquiditySnapshots,
    blockRewardStartTimestamp,
    blockRewardEndTimestamp,
  );

  const userToPointsMap = calculateFinalPoints(
    accountToDolomiteBalanceMap,
    marketToIsValidMap,
  );

  const allMarketIdsString = marketIds.join(',');
  // eslint-disable-next-line max-len
  const fileName = `${FOLDER_NAME}/markets-held-${blockRewardStartTimestamp}-${blockRewardEndTimestamp}-(${allMarketIdsString})-output.json`;
  const dataToWrite = readOutputFile(fileName);
  dataToWrite.epochs[epoch] = userToPointsMap;
  dataToWrite.metadata[epoch] = {
    totalPointsPerMarket: Object.entries(totalPointsPerMarket).reduce((memo, [marketId, points]) => {
      memo[marketId] = points.toFixed();
      return memo;
    }, {}),
  };
  writeOutputFile(fileName, dataToWrite);

  return true;
}

function readOutputFile(fileName: string): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8')) as OutputFile;
  } catch (e) {
    return {
      epochs: {},
      metadata: {},
    };
  }
}

function writeOutputFile(
  fileName: string,
  fileContent: OutputFile,
): void {
  if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
  }

  fs.writeFileSync(
    fileName,
    JSON.stringify(fileContent),
    { encoding: 'utf8', flag: 'w' },
  );
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
