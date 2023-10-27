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

import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../clients/dolomite';
import { dolomite } from '../helpers/web3';
/* eslint-disable */
import Logger from '../lib/logger';
import MarketStore from '../lib/market-store';
import Pageable from '../lib/pageable';
import { calculateFinalRewards, calculateLiquidityPoints, calculateRewardPoints } from '../lib/rewards';
import { BalanceChangeEvent, getAccountBalancesByMarket, getBalanceChangingEvents, getLiquidityPositionAndEvents } from '../lib/event-parser';
import { defaultAbiCoder, keccak256, parseEther } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';


async function start() {

  const marketStore = new MarketStore();

  const blockRewardStart = 130000000;
  const blockRewardStartTimestamp = 1694407206;
  const blockRewardEnd = 141530000;
  const blockRewardEndTimestamp = 1697585246;

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

  // Get accounts with supply value
  const accounts = await Pageable.getPageableValues(async (lastIndex) => {
    const { accounts } = await getAllDolomiteAccountsWithSupplyValue(marketIndexMap, blockRewardStart, lastIndex);
    return accounts;
  });

  // Load and parse events
  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(accounts, blockRewardStartTimestamp);
  const accountToAssetToEventsMap = await getBalanceChangingEvents(blockRewardStart, blockRewardEnd);

  // Sort list and loop through to get point total per user
  const totalPointsPerMarket = calculateRewardPoints(accountToDolomiteBalanceMap, accountToAssetToEventsMap, blockRewardStartTimestamp, blockRewardEndTimestamp);

  // LIQUIDITY POOL
  const { ammLiquidityBalances, userToLiquiditySnapshots } = await getLiquidityPositionAndEvents(blockRewardStart, blockRewardEnd, blockRewardStartTimestamp);

  const totalLiquidityPoints = calculateLiquidityPoints(ammLiquidityBalances, userToLiquiditySnapshots, blockRewardStartTimestamp, blockRewardEndTimestamp);

  // Final calculations
  const userToOarbRewards = calculateFinalRewards(accountToDolomiteBalanceMap, ammLiquidityBalances, totalPointsPerMarket, totalLiquidityPoints);

  const leaves: string[] = [];
  for (const account in userToOarbRewards) {
    leaves.push(keccak256(defaultAbiCoder.encode(['address', 'uint256'], [account, parseEther(userToOarbRewards[account].toFixed(18))])));
  }

  const tree = new MerkleTree(leaves, keccak256, { sort: true });
  const root = tree.getHexRoot();
  console.log(root);

  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1)
});
