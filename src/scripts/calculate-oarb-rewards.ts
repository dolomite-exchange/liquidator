// eslint-disable-next-line
if (process.env.ENV_FILENAME) {
  // eslint-disable-next-line
  require('dotenv').config({ path: `${__dirname}/../../${process.env.ENV_FILENAME}` });
} else {
  Logger.warn({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv').config();
}

/* eslint-disable */
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../clients/dolomite';
import { dolomite } from '../helpers/web3';
import {
  addLiquidityMiningVestingPositions,
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getLiquidityPositionAndEvents,
} from '../lib/event-parser';
import Logger from '../lib/logger';
import MarketStore from '../lib/market-store';
import Pageable from '../lib/pageable';
import {
  calculateFinalRewards,
  calculateLiquidityPoints,
  calculateMerkleRootAndProofs,
  calculateTotalRewardPoints,
  OArbFinalAmount,
} from '../lib/rewards';
import liquidityMiningConfig from './config/oarb-season-0.json';

/* eslint-enable */

interface OutputFile {
  epochs: {
    [epoch: string]: {
      [walletAddressLowercase: string]: {
        amount: string // big int
        proofs: string[]
      }
    }
  };
  metadata: {
    [epoch: string]: {
      isFinalized: boolean
      merkleRoot: string
    }
  };
}

const FOLDER_NAME = `${__dirname}/output`;

const MINIMUM_OARB_AMOUNT_WEI = new BigNumber(ethers.utils.parseEther('0.1').toString());

async function start() {
  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const marketStore = new MarketStore();

  const blockRewardStart = liquidityMiningConfig.epochs[epoch].startBlockNumber;
  const blockRewardStartTimestamp = liquidityMiningConfig.epochs[epoch].startTimestamp;
  const blockRewardEnd = liquidityMiningConfig.epochs[epoch].endBlockNumber;
  const blockRewardEndTimestamp = liquidityMiningConfig.epochs[epoch].endTimestamp;

  const oArbAmount = liquidityMiningConfig.epochs[epoch].oArbAmount;
  const rewardWeights = liquidityMiningConfig.epochs[epoch].rewardWeights as Record<string, string>;
  const oArbRewardWeiMap = Object.keys(rewardWeights).reduce<Record<string, BigNumber>>((acc, key) => {
    acc[key] = new BigNumber(parseEther(rewardWeights[key]).toString());
    return acc;
  }, {});

  const { riskParams } = await getDolomiteRiskParams(blockRewardStart);
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
    blockRewardStart,
    blockRewardStartTimestamp,
    blockRewardEnd,
    blockRewardEndTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    oArbAmount,
    rewardWeights,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();

  const marketMap = marketStore.getMarketMap();
  const marketIndexMap = await marketStore.getMarketIndexMap(marketMap);

  const apiAccounts = await Pageable.getPageableValues(async (lastIndex) => {
    const result = await getAllDolomiteAccountsWithSupplyValue(marketIndexMap, blockRewardStart, lastIndex);
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

  const { ammLiquidityBalances, userToLiquiditySnapshots } = await getLiquidityPositionAndEvents(
    blockRewardStart,
    blockRewardEnd,
    blockRewardStartTimestamp,
  );
  const totalLiquidityPoints = calculateLiquidityPoints(
    ammLiquidityBalances,
    userToLiquiditySnapshots,
    blockRewardStartTimestamp,
    blockRewardEndTimestamp,
  );

  const userToOArbRewards = calculateFinalRewards(
    accountToDolomiteBalanceMap,
    ammLiquidityBalances,
    totalPointsPerMarket,
    totalLiquidityPoints,
    oArbRewardWeiMap,
    MINIMUM_OARB_AMOUNT_WEI,
  );

  const { merkleRoot, walletAddressToLeavesMap } = calculateMerkleRootAndProofs(userToOArbRewards);

  const fileName = `${FOLDER_NAME}/oarb-season-0-epoch-${epoch}-output.json`;
  const dataToWrite = readOutputFile(fileName);
  dataToWrite.epochs[epoch] = walletAddressToLeavesMap;
  dataToWrite.metadata[epoch] = {
    merkleRoot,
    isFinalized: true,
  };
  writeOutputFile(fileName, dataToWrite);

  rectifyRewardsForEpoch0IfNecessary(epoch, dataToWrite.epochs[epoch]);

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

function rectifyRewardsForEpoch0IfNecessary(
  epoch: number,
  walletAddressToLeavesMap: Record<string, OArbFinalAmount>,
): void {
  if (epoch !== 0) {
    console.log('Skipping rectifying amounts...');
    return;
  }

  const oldFile = `${__dirname}/finalized/oarb-season-0-epoch-${epoch}-output.json`;
  const oldWalletAddressToFinalDataMap = readOutputFile(oldFile).epochs[epoch];

  let cumulative = new BigNumber(0);
  const deltasMap = Object.keys(walletAddressToLeavesMap).reduce<Record<string, BigNumber>>((map, wallet) => {
    const oldAmount = new BigNumber(oldWalletAddressToFinalDataMap[wallet.toLowerCase()]?.amount ?? '0');
    const newAmount = new BigNumber(walletAddressToLeavesMap[wallet.toLowerCase()].amount);
    if (newAmount.gt(oldAmount)) {
      map[wallet] = newAmount.minus(oldAmount);
      cumulative = cumulative.plus(map[wallet]);
    }
    return map;
  }, {});
  console.log('Cumulative amount for fix (in wei):', cumulative.toString());
  const deltasMerkleRootAndProofs = calculateMerkleRootAndProofs(deltasMap);

  const rectifiedEpochNumber = '999';
  writeOutputFile(
    `${FOLDER_NAME}/oarb-season-0-epoch-${rectifiedEpochNumber}-deltas-output.json`,
    {
      epochs: {
        [rectifiedEpochNumber]: deltasMerkleRootAndProofs.walletAddressToLeavesMap,
      },
      metadata: {
        [rectifiedEpochNumber]: {
          isFinalized: true,
          merkleRoot: deltasMerkleRootAndProofs.merkleRoot,
        },
      },
    },
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
