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
import { getAllDolomiteAccountsWithSupplyValue, getDeposits, getDolomiteRiskParams, getLiquidations, getLiquidityPositions, getLiquiditySnapshots, getTrades, getTransfers, getWithdrawals } from '../clients/dolomite';
import { dolomite } from '../helpers/web3';
/* eslint-disable */
import Logger from '../lib/logger';
import MarketStore from '../lib/market-store';
import Pageable from '../lib/pageable';
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { BalanceAndRewardPoints, BalanceChangeEvent, getAccountBalancesByMarket, getBalanceChangingEvents, getLiquidityPositionAndEvents, parseAmmLiquidityPositions, parseAmmLiquiditySnapshots, parseDeposits, parseLiquidations, parseTrades, parseTransfers, parseWithdrawals } from '../lib/rewards';
import { defaultAbiCoder, keccak256, parseEther } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';


async function start() {

  const marketStore = new MarketStore();

  const blockRewardStart = 130000000;
  const blockRewardStartTimestamp = 1694407206;
  const blockRewardEnd = 141530000;
  const blockRewardEndTimestamp = 1697585246;

  const OARB_REWARD_AMOUNT = new BigNumber(10000);
  const LIQUIDITY_POOL = '0xb77a493a4950cad1b049e222d62bce14ff423c6f';

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
  const accountToAssetToEventsMap: Record<string, Record<number, BalanceChangeEvent[]>> = {};
  await getBalanceChangingEvents(accountToAssetToEventsMap, blockRewardStart, blockRewardEnd);

  // Sort list and loop through to get point total per user
  let totalPointsPerMarket = {};
  let totalPoints = new BigNumber(0);
  for (const account in accountToAssetToEventsMap) {
    for (const market in accountToAssetToEventsMap[account]) {

      // Make sure user => market => balance record exists
      if(!accountToDolomiteBalanceMap[account]) {
        accountToDolomiteBalanceMap[account] = {};
      }
      if (!accountToDolomiteBalanceMap[account][market]) {
          accountToDolomiteBalanceMap[account][market] = new BalanceAndRewardPoints(blockRewardStartTimestamp);
      }
      totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

      // Sort and process events
      accountToAssetToEventsMap[account][market].sort((a,b) => {
        return a.serialId - b.serialId;
      });
      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      accountToAssetToEventsMap[account][market].forEach((event) => {
        const rewardUpdate = userBalStruct.processEvent(event);
        totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(rewardUpdate);
        totalPoints = totalPoints.plus(rewardUpdate);
      });
    }
  }

  // Do final loop through all balances to finish reward point calculation
  for (const account in accountToDolomiteBalanceMap) {
    for (const market in accountToDolomiteBalanceMap[account]) {
      totalPointsPerMarket[market] = totalPointsPerMarket[market] ?? new BigNumber(0);

      const userBalStruct = accountToDolomiteBalanceMap[account][market];
      const rewardUpdate = userBalStruct.processEvent({ amount: new BigNumber(0), timestamp: blockRewardEndTimestamp, serialId: 0})
      totalPointsPerMarket[market] = totalPointsPerMarket[market].plus(rewardUpdate);
      totalPoints = totalPoints.plus(rewardUpdate);
    }
  }

  // LIQUIDITY POOL
  const ammLiquidityBalances = {};
  const userToLiquiditySnapshots = {};
  getLiquidityPositionAndEvents(ammLiquidityBalances, userToLiquiditySnapshots, blockRewardStart, blockRewardEnd, blockRewardStartTimestamp);

  let totalLiquidityPoints = new BigNumber(0);
  for (const account in userToLiquiditySnapshots) {
      userToLiquiditySnapshots[account].sort((a,b) => {
        return a.timestamp - b.timestamp;
      });
      ammLiquidityBalances[account] = ammLiquidityBalances[account] ?? new BalanceAndRewardPoints(blockRewardStartTimestamp, new BigNumber(0));

      userToLiquiditySnapshots[account].forEach((liquiditySnapshot) => {
        totalLiquidityPoints = totalLiquidityPoints.plus(ammLiquidityBalances[account].processLiquiditySnapshot(liquiditySnapshot));
      });
  }

  for (const account in ammLiquidityBalances) {
    const user = ammLiquidityBalances[account];
    const rewardUpdate = user.balance.times(blockRewardEndTimestamp - user.lastUpdated);

    totalLiquidityPoints = totalLiquidityPoints.plus(rewardUpdate);
    user.rewardPoints = user.rewardPoints.plus(rewardUpdate);
    user.lastUpdated = blockRewardEndTimestamp;
  }

  // Final calculations
  const userToOarbRewards = {};
  for (const account in accountToDolomiteBalanceMap) {
    userToOarbRewards[account] = userToOarbRewards[account] ?? new BigNumber(0);
    for (const market in accountToDolomiteBalanceMap[account]) {
      const user = accountToDolomiteBalanceMap[account];
      const oarbReward = OARB_REWARD_AMOUNT.times(user[market].rewardPoints).dividedBy(totalPoints);

      userToOarbRewards[account] = userToOarbRewards[account].plus(oarbReward);
    }
  }

  // Distribute liquidity pool rewards
  for (const account in ammLiquidityBalances) {
    userToOarbRewards[account] = userToOarbRewards[account] ?? new BigNumber(0);
    const user = ammLiquidityBalances[account];
    const rewardAmount = userToOarbRewards[LIQUIDITY_POOL].times(user.rewardPoints).dividedBy(totalLiquidityPoints);

    userToOarbRewards[account] = userToOarbRewards[account].plus(rewardAmount);
    userToOarbRewards[LIQUIDITY_POOL] = userToOarbRewards[LIQUIDITY_POOL].minus(rewardAmount);
  }

  // // @follow-up Why is this not zero
  // console.log(userToOarbRewards[LIQUIDITY_POOL]);

  // Create merkle root
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
