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
import { defaultAbiCoder, keccak256, parseEther } from 'ethers/lib/utils';
import fs from 'fs';
import { MerkleTree } from 'merkletreejs';
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
  calculateTotalRewardPoints,
  OArbFinalAmount,
} from '../lib/rewards';
import liquidityMiningConfig from './config/oarb-season-0.json';

/* eslint-enable */

async function start() {
  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid epoch, found: ${epoch}`));
  }

  const marketStore = new MarketStore();

  const blockRewardStart = liquidityMiningConfig.epochs[epoch].startBlockNumber;
  const blockRewardStartTimestamp = liquidityMiningConfig.epochs[epoch].startTimestamp;
  const blockRewardEnd = liquidityMiningConfig.epochs[epoch].endBlockNumber;
  const blockRewardEndTimestamp = liquidityMiningConfig.epochs[epoch].endTimestamp;

  const rewardWeights = liquidityMiningConfig.epochs[epoch].rewardWeights as Record<string, string>;
  const oArbRewardMap = Object.keys(rewardWeights).reduce<Record<string, BigNumber>>((acc, key) => {
    acc[key] = new BigNumber(parseEther(rewardWeights[key]).toString());
    return acc;
  }, {});

  const { riskParams } = await getDolomiteRiskParams(blockRewardStart);
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

  const userToOarbRewards = calculateFinalRewards(
    accountToDolomiteBalanceMap,
    ammLiquidityBalances,
    totalPointsPerMarket,
    totalLiquidityPoints,
    oArbRewardMap,
  );

  const walletAddressToFinalDataMap: Record<string, OArbFinalAmount> = {}
  const leaves: string[] = [];
  const userAccounts = Object.keys(userToOarbRewards);
  userAccounts.forEach(account => {
    const amount = userToOarbRewards[account].toFixed(0);
    const leaf = keccak256(
      defaultAbiCoder.encode(
        ['address', 'uint256'],
        [account, amount],
      ),
    );
    walletAddressToFinalDataMap[account.toLowerCase()] = {
      amount,
      proofs: [leaf], // this will get overwritten once the tree is created
    }
    leaves.push(leaf);
  })

  const tree = new MerkleTree(leaves, keccak256, { sort: true });
  const merkleRoot = tree.getHexRoot();

  userAccounts.forEach(account => {
    const finalData = walletAddressToFinalDataMap[account.toLowerCase()];
    finalData.proofs = tree.getHexProof(finalData.proofs[0]);
  });

  const dataToWrite = readOutputFile();
  dataToWrite.epochs[epoch] = walletAddressToFinalDataMap;
  dataToWrite.metadata[epoch] = {
    merkleRoot,
    isFinalized: true,
  }
  writeOutputFile(dataToWrite);

  return true;
}

interface OutputFile {
  epochs: {
    [epoch: string]: {
      [walletAddressLowercase: string]: {
        amount: string // big int
        proofs: string[]
      }
    }
  }
  metadata: {
    [epoch: string]: {
      isFinalized: boolean
      merkleRoot: string
    }
  }
}

const FILE_NAME = `${__dirname}/output/oarb-season-0-output.json`;

function readOutputFile(): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(FILE_NAME, 'utf8')) as OutputFile
  } catch (e) {
    return {
      epochs: {},
      metadata: {},
    }
  }
}

function writeOutputFile(
  fileContent: OutputFile,
): void {
  fs.writeFileSync(
    FILE_NAME,
    JSON.stringify(fileContent, null, 2),
    { encoding: 'utf8', flag: 'w' },
  );
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
