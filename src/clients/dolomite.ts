/* eslint-disable max-len */
import { address, BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import {
  ApiAsyncAction,
  ApiAsyncActionType,
  ApiAsyncWithdrawal,
  ApiToken as ZapApiToken,
  BigNumber as ZapBigNumber,
} from '@dolomite-exchange/zap-sdk';
import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import axios from 'axios';
import * as ethers from 'ethers';
import { isMarketIgnored } from '../helpers/market-helpers';
import { dolomite } from '../helpers/web3';
import {
  ApiAccount,
  ApiBalance,
  ApiLiquidation,
  ApiMarket,
  ApiRiskParam,
  MarketIndex,
  TotalValueLockedAndFees,
} from '../lib/api-types';
import { ChainId } from '../lib/chain-id';
import { TEN_BI } from '../lib/constants';
import {
  GraphqlAccount,
  GraphqlAccountResult,
  GraphqlAmmDataForUserResult,
  GraphqlAmmLiquidityPosition,
  GraphqlAmmPairData,
  GraphqlAsyncDepositResult,
  GraphqlAsyncWithdrawalResult,
  GraphqlInterestIndex,
  GraphqlInterestRate,
  GraphqlLiquidationsResult,
  GraphqlMarketResult,
  GraphqlOraclePrice,
  GraphqlRiskParamsResult,
  GraphqlTimestampToBlockResult,
  GraphqlToken,
  GraphqlTokenValue,
  GraphqlUserResult,
} from '../lib/graphql-types';
import Logger from '../lib/logger';
import Pageable from '../lib/pageable';
import '../lib/env';
import { chunkArray } from '../lib/utils';

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
};

const subgraphUrl = process.env.SUBGRAPH_URL ?? '';
if (!subgraphUrl) {
  throw new Error('SUBGRAPH_URL is not set')
}

const marginAccountFields = `
                  id
                  user {
                    id
                  }
                  accountNumber
                  tokenValues {
                    token {
                      id
                      marketId
                      decimals
                      symbol
                    }
                    valuePar
                    expirationTimestamp
                    expiryAddress
                  }
`

async function getAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  query: string,
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const accounts: ApiAccount[] = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then((response: any) => {
      if (response.errors && typeof response.errors === 'object') {
        return Promise.reject((response.errors as any)[0]);
      } else {
        return (response as GraphqlAccountResult).data.marginAccounts;
      }
    })
    .then(graphqlAccounts => graphqlAccounts.reduce((memo, account) => {
      const apiAccount = mapGraphqlAccountToApiAccount(account, marketIndexMap)
      if (apiAccount) {
        memo.push(apiAccount);
      }
      return memo;
    }, [] as ApiAccount[]));

  return { accounts };
}

export async function getLiquidatableDolomiteAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $lastId: ID) {
                marginAccounts(
                  where: { hasBorrowValue: true id_gt: $lastId  }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                ${marginAccountFields}
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId);
}

export async function getAllDolomiteUsersWithPositions(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: string[] }> {
  const query = `
            query getUsers($blockNumber: Int, $lastId: ID) {
                users(
                  where: { totalBorrowPositionCount_gt: 0 id_gt: $lastId  }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                  id
                }
              }`;
  const accounts = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then((response: any) => {
      if (response.errors && typeof response.errors === 'object') {
        return Promise.reject((response.errors as any)[0]);
      } else {
        return (response as GraphqlUserResult).data.users;
      }
    })
    .then(graphqlAccounts => graphqlAccounts.map(account => account.id, [] as string[]));

  return { accounts };
}

export async function getAllDolomiteAccountsWithSupplyValue(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $lastId: ID) {
                marginAccounts(
                  where: { hasSupplyValue: true id_gt: $lastId }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                  id
                  user {
                    id
                    effectiveUser {
                      id
                    }
                  }
                  accountNumber
                  tokenValues {
                    token {
                      id
                      marketId
                      decimals
                      symbol
                    }
                    valuePar
                    expirationTimestamp
                    expiryAddress
                  }
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId);
}

export async function getApiAccountsFromAddresses(
  isolationModeToken: string,
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
    query getAccountsByAddresses($blockNumber: Int, $lastId: ID) {
      marginAccounts(
        where: { user_: {
          isolationModeVault: "${isolationModeToken.toLowerCase()}" }
          hasSupplyValue: true
          id_gt: $lastId
        }
        orderBy: id
        first: ${Pageable.MAX_PAGE_SIZE}
        block: { number: $blockNumber }
      ) {
        ${marginAccountFields}
      }
    }
`;
  const accounts = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then((response: any) => {
      if (response.errors && typeof response.errors === 'object') {
        return Promise.reject((response.errors as any)[0]);
      } else {
        return response.data.marginAccounts as GraphqlAccount[];
      }
    })
    .then(graphqlAccounts => graphqlAccounts.reduce((memo, account) => {
      const apiAccount = mapGraphqlAccountToApiAccount(account, marketIndexMap)
      if (apiAccount) {
        memo.push(apiAccount);
      }
      return memo;
    }, [] as ApiAccount[]));

  return { accounts };
}

export async function getExpiredAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $lastId: ID) {
                marginAccounts(
                  where: { hasBorrowValue: true hasExpiration: true id_gt: $lastId }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                  ${marginAccountFields}
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId);
}

export async function getDolomiteMarkets(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ markets: ApiMarket[] }> {
  const result: GraphqlMarketResult = await axios.post(
    subgraphUrl,
    {
      query: `query getMarketRiskInfos($blockNumber: Int, $lastId: ID) {
                marketRiskInfos(
                  block: { number: $blockNumber }
                  first: ${Pageable.MAX_PAGE_SIZE}
                  where: { id_gt: $lastId }
                  orderBy: id
                ) {
                  token {
                    id
                    marketId
                    name
                    symbol
                    decimals
                  }
                  marginPremium
                  liquidationRewardPremium
                  isBorrowingDisabled
                }
              }`,
      variables: {
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlMarketResult);

  if (result.errors && typeof result.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(result.errors[0]);
  }

  const filteredMarketRiskInfos = result.data.marketRiskInfos.filter(market => {
    return !isMarketIgnored(parseInt(market.token.marketId, 10));
  });

  const marketPriceCalls = filteredMarketRiskInfos.map(market => {
    return {
      target: dolomite.address,
      callData: dolomite.contracts.dolomiteMargin.methods.getMarketPrice(market.token.marketId).encodeABI(),
    };
  });

  // Even though the block number from the subgraph is certainly behind the RPC, we want the most updated chain data!
  const { results: marketPriceResults } = await dolomite.multiCall.aggregate(marketPriceCalls);

  const markets: Promise<ApiMarket>[] = filteredMarketRiskInfos.map(async (market, i) => {
    const oraclePrice = dolomite.web3.eth.abi.decodeParameter('uint256', marketPriceResults[i]);
    const marketId = new BigNumber(market.token.marketId)
    const apiMarket: ApiMarket = {
      marketId: marketId.toNumber(),
      decimals: Number(market.token.decimals),
      symbol: market.token.symbol,
      name: market.token.name,
      tokenAddress: market.token.id,
      oraclePrice: new BigNumber(oraclePrice),
      marginPremium: new BigNumber(decimalToString(market.marginPremium)),
      liquidationRewardPremium: new BigNumber(decimalToString(market.liquidationRewardPremium)),
      isBorrowingDisabled: market.isBorrowingDisabled,
    };
    return apiMarket;
  });

  return { markets: await Promise.all(markets) };
}

export async function getDolomiteRiskParams(blockNumber: number): Promise<{ riskParams: ApiRiskParam }> {
  const result: any = await axios.post(
    subgraphUrl,
    {
      query: `query getDolomiteMargins($blockNumber: Int) {
        dolomiteMargins(block: { number: $blockNumber }) {
          id
          liquidationRatio
          liquidationReward
        }
      }`,
      variables: {
        blockNumber,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlRiskParamsResult);

  if (result.errors && typeof result.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(result.errors[0]);
  }

  const riskParams: ApiRiskParam[] = result.data.dolomiteMargins.map(riskParam => {
    return {
      dolomiteMargin: ethers.utils.getAddress(riskParam.id),
      liquidationRatio: new BigNumber(decimalToString(riskParam.liquidationRatio)),
      liquidationReward: new BigNumber(decimalToString(riskParam.liquidationReward)),
    };
  });

  return { riskParams: riskParams[0] };
}

export async function getLiquidationsBetweenTimestamps(
  lowerTimestamp: number,
  upperTimestamp: number,
  lastId: string,
): Promise<{ liquidations: ApiLiquidation[] }> {
  const result = await axios.post(
    subgraphUrl,
    {
      query: `query getLiquidationsBetweenTimestamps($lowerTimestamp: BigInt, $upperTimestamp: BigInt, $lastId: ID) {
        liquidations(
          where: { 
            transaction_: { timestamp_gte: $lowerTimestamp timestamp_lte: $upperTimestamp }
            id_gt: $lastId
          }
          first: 1000
          orderBy: id
          orderDirection: asc
        ) {
          id
          heldTokenAmountUSD
          borrowedTokenAmountUSD
        }
      }`,
      variables: {
        lowerTimestamp,
        upperTimestamp,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidationsResult);

  if (result.errors && typeof result.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(result.errors[0]);
  }

  const liquidations: ApiLiquidation[] = result.data.liquidations.map(liquidation => {
    return {
      id: liquidation.id,
      owedAmountUSD: new BigNumber(liquidation.borrowedTokenAmountUSD),
      heldAmountUSD: new BigNumber(liquidation.heldTokenAmountUSD),
    };
  });

  return { liquidations };
}

export async function getTimestampToBlockNumberMap(timestamps: number[]): Promise<Record<string, number>> {
  let queries = '';
  timestamps.forEach(timestamp => {
    queries += `_${timestamp}:blocks(where: { timestamp_gt: ${timestamp - 30}, timestamp_lte: ${timestamp} } first: 1 orderDirection: desc orderBy: number) { number }\n`
  });
  const result = await axios.post(
    `${process.env.SUBGRAPH_BLOCKS_URL}`,
    {
      query: `query getTimestampToBlockNumberMap {
        ${queries}
      }`,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTimestampToBlockResult);

  return timestamps.reduce((memo, timestamp) => {
    memo[timestamp.toString()] = result.data[`_${timestamp}`]?.[0]?.number;
    return memo;
  }, {});
}

export interface TotalYield {
  totalEntries: number
  swapYield: Decimal
  lpLendingYield: Decimal
  lendingYield: Decimal
  totalYield: Decimal
}

const chunkCount = 25;

export async function getTotalYield(blockNumbers: number[], user: address): Promise<TotalYield> {
  const blockNumberChunks = chunkArray(blockNumbers, chunkCount);
  const queryChunks = blockNumberChunks.reduce<string[]>((memo, blockNumberChunk) => {
    memo.push(
      blockNumberChunk.map(blockNumber => `
      ammPair_${blockNumber}:ammPairs(where: { id: "0xb77a493a4950cad1b049e222d62bce14ff423c6f" } block: { number: ${blockNumber} }) {
        volumeUSD
        reserveUSD
        reserve0
        reserve1
        totalSupply
      }
      interestRates_${blockNumber}:interestRates(block: { number: ${blockNumber} }) {
        supplyInterestRate
        token {
          id
        }
      }
      interestIndexes_${blockNumber}:interestIndexes(block: { number: ${blockNumber} }) {
        supplyIndex
        token {
          id
        }
      }
      oraclePrices_${blockNumber}:oraclePrices(block: { number: ${blockNumber} }) {
        price
        token {
          id
        }
      }
      ammLiquidityPosition_${blockNumber}:ammLiquidityPositions(where: { user: "${user}" } block: { number: ${blockNumber} }) {
        liquidityTokenBalance
      }
      marginAccounts_${blockNumber}:marginAccountTokenValues(where: { effectiveUser: "${user}" } block: { number: ${blockNumber} }) {
        valuePar
        token {
          id
        }
      }
    `).join('\n'),
    );
    return memo;
  }, []);

  const totalYield: TotalYield = {
    totalEntries: 0,
    swapYield: new BigNumber(0),
    lpLendingYield: new BigNumber(0),
    lendingYield: new BigNumber(0),
    totalYield: new BigNumber(0),
  }
  for (let i = 0; i < queryChunks.length; i += 1) {
    const result = await axios.post(
      subgraphUrl,
      {
        query: `query getAmmDataForUser {
        ${queryChunks[i]}
      }`,
      },
      defaultAxiosConfig,
    )
      .then(response => response.data)
      .then(json => json as GraphqlAmmDataForUserResult);
    const tempTotalYield = reduceResultIntoTotalYield(result, blockNumberChunks[i]);
    totalYield.totalEntries += tempTotalYield.totalEntries;
    totalYield.swapYield = totalYield.swapYield.plus(tempTotalYield.swapYield);
    totalYield.lendingYield = totalYield.lendingYield.plus(tempTotalYield.lendingYield);
    totalYield.totalYield = totalYield.totalYield.plus(tempTotalYield.totalYield);
    Logger.info({
      message: 'Sleeping for 3s to reduce rate limiting...',
    })
    await sleep(3000);
  }

  return totalYield;
}

export async function getTotalValueLockedAndFees(
  chainId: number,
  blockNumbers: number[],
): Promise<TotalValueLockedAndFees> {
  const queryChunks = blockNumbers.map(blockNumber => {
    return `
      interestRates(
        block: { number: ${blockNumber} }
        orderBy: token__marketId
        orderDirection: asc
      ) {
        token {
          id
          marketId
          decimals
          supplyLiquidity
          borrowLiquidity
        }
        borrowInterestRate
      }
    `;
  }, []);

  const allTvlAndFees: TotalValueLockedAndFees = {
    totalSupplyLiquidity: [],
    totalBorrowLiquidity: [],
    borrowFees: [],
  };
  for (let i = 0; i < queryChunks.length; i += 1) {
    const blockNumber = blockNumbers[i];
    const numberOfMarkets = await dolomite.getters.getNumMarkets({ blockNumber });
    const allMarkets: BigNumber[] = []
    for (let j = 0; j < numberOfMarkets.toNumber(); j += 1) {
      if (chainId !== ChainId.ArbitrumOne || j !== 10) {
        allMarkets.push(new BigNumber(j));
      }
    }

    const callDatas = allMarkets.map(market => {
      return {
        target: dolomite.address,
        callData: dolomite.contracts.dolomiteMargin.methods.getMarketPrice(market.toNumber()).encodeABI(),
      };
    });
    const { results: allPricesRaw } = await dolomite.multiCall.aggregate(callDatas, { blockNumber });
    const allPrices = allPricesRaw.map(priceEncoded => {
      return new BigNumber(dolomite.web3.eth.abi.decodeParameter('uint256', priceEncoded).toString());
    })

    const allPricesMap = allMarkets.reduce((memo, market, j) => {
      memo[market.toFixed()] = allPrices[j];
      return memo;
    }, {} as Record<string, BigNumber>)

    const interestRates = await axios.post(
      subgraphUrl,
      {
        query: `query getTvlAndInterestRatesByMarkets { ${queryChunks[i]} }`,
      },
      defaultAxiosConfig,
    )
      .then(response => response.data)
      .then(json => (json.data.interestRates) as GraphqlInterestRate[]);

    interestRates.forEach(rate => {
      if (chainId === ChainId.ArbitrumOne && rate.token.marketId === '10') {
        return;
      }

      if (!allTvlAndFees.totalSupplyLiquidity[i]) {
        allTvlAndFees.totalSupplyLiquidity[i] = new BigNumber(0);
        allTvlAndFees.totalBorrowLiquidity[i] = new BigNumber(0);
        allTvlAndFees.borrowFees[i] = new BigNumber(0);
      }

      const supplyLiquidity = new BigNumber(rate.token.supplyLiquidity);
      const borrowLiquidity = new BigNumber(rate.token.borrowLiquidity);
      const scaleFactor = new BigNumber(10).pow(new BigNumber(36).minus(rate.token.decimals))
      const priceUsd = allPricesMap[rate.token.marketId].div(scaleFactor);

      allTvlAndFees.totalSupplyLiquidity[i]
        = allTvlAndFees.totalSupplyLiquidity[i].plus(supplyLiquidity.times(priceUsd));
      allTvlAndFees.totalBorrowLiquidity[i]
        = allTvlAndFees.totalBorrowLiquidity[i].plus(borrowLiquidity.times(priceUsd));

      const feesDaily = borrowLiquidity.times(priceUsd).times(rate.borrowInterestRate).div(365);
      allTvlAndFees.borrowFees[i] = allTvlAndFees.borrowFees[i].plus(feesDaily);
    });
  }

  return allTvlAndFees;
}

export async function getTotalTradeVolume(startBlockNumber: number, endBlockNumber: number): Promise<BigNumber> {
  const query = `
      start:dolomiteMargins(
        block: { number: ${startBlockNumber} }
      ) {
        totalTradeVolumeUSD
      }
      end:dolomiteMargins(
        block: { number: ${endBlockNumber} }
      ) {
        totalTradeVolumeUSD
      }
    `;

  const { start, end } = await axios.post(
    subgraphUrl,
    {
      query: `query getTotalTradeVolume { ${query} }`,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => {
      return (json.data) as { start: { totalTradeVolumeUSD: string }[], end: { totalTradeVolumeUSD: string }[] }
    });

  return new BigNumber(end[0].totalTradeVolumeUSD).minus(start[0].totalTradeVolumeUSD);
}

export async function getTotalTransactions(startBlockNumber: number, endBlockNumber: number): Promise<BigNumber> {
  const query = `
      start:dolomiteMargins(
        block: { number: ${startBlockNumber} }
      ) {
        transactionCount
      }
      end:dolomiteMargins(
        block: { number: ${endBlockNumber} }
      ) {
        transactionCount
      }
    `;

  const { start, end } = await axios.post(
    subgraphUrl,
    {
      query: `query getTotalTransactions { ${query} }`,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => ((json.data) as { start: { transactionCount: string }[], end: { transactionCount: string }[] }));

  return new BigNumber(end[0].transactionCount).minus(start[0].transactionCount);
}

export async function getTotalUniqueUsers(startBlockNumber: number, endBlockNumber: number): Promise<BigNumber> {
  const query = `
      start:dolomiteMargins(
        block: { number: ${startBlockNumber} }
      ) {
        userCount
      }
      end:dolomiteMargins(
        block: { number: ${endBlockNumber} }
      ) {
        userCount
      }
    `;

  const { start, end } = await axios.post(
    subgraphUrl,
    {
      query: `query getTotalTransactions { ${query} }`,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => {
      return (json.data) as { start: { userCount: string }[], end: { userCount: string }[] }
    });

  return new BigNumber(end[0].userCount).minus(start[0].userCount);
}

function mapGraphqlTokenToZapApiToken(token: GraphqlToken): ZapApiToken {
  return {
    tokenAddress: token.id,
    marketId: new ZapBigNumber(token.marketId),
    decimals: parseInt(token.decimals, 10),
    symbol: token.symbol,
    name: token.name,
  }
}

/**
 * Despite the name of this function, we return the data as Withdrawals, since it's used for undoing a deposit (aka
 * withdrawing)
 */
export async function getRetryableAsyncDeposits(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ withdrawals: ApiAsyncAction[] }> {
  const withdrawals: ApiAsyncAction[] = await axios.post(
    subgraphUrl,
    {
      query: `query getAsyncDeposits(
        $blockNumber: Int,
        $lastId: ID
      ) {
        asyncDeposits(
          where: { isRetryable: true, id_gt: $lastId }
          block: { number: $blockNumber }
          first: ${Pageable.MAX_PAGE_SIZE}
          orderBy: id
        ) {
          id
          key
          marginAccount {
            user {
              id
            }
            accountNumber
          }
          inputToken {
            id
            marketId
            symbol
            name
            decimals
          }
          inputAmount
          outputToken {
            id
            marketId
            symbol
            name
            decimals
          }
          minOutputAmount
          status
          isRetryable
        }
      }`,
      variables: {
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then((response: any) => {
      if (response.errors && typeof response.errors === 'object') {
        return Promise.reject((response.errors as any)[0]);
      } else {
        return (response as GraphqlAsyncDepositResult).data.asyncDeposits;
      }
    })
    .then(graphqlDeposits => graphqlDeposits.map<ApiAsyncAction>(withdrawal => {
      const inputValueBase = TEN_BI.pow(withdrawal.inputToken.decimals)
      const outputValueBase = TEN_BI.pow(withdrawal.outputToken.decimals)
      return {
        id: withdrawal.id,
        key: withdrawal.key,
        actionType: ApiAsyncActionType.DEPOSIT,
        owner: withdrawal.marginAccount.user.id.toLowerCase(),
        accountNumber: new ZapBigNumber(withdrawal.marginAccount.accountNumber),
        status: withdrawal.status,
        inputToken: mapGraphqlTokenToZapApiToken(withdrawal.outputToken),
        inputAmount: new ZapBigNumber(withdrawal.minOutputAmount).times(outputValueBase).integerValue(),
        outputToken: mapGraphqlTokenToZapApiToken(withdrawal.inputToken),
        outputAmount: new ZapBigNumber(withdrawal.inputAmount).times(inputValueBase).integerValue(),
      };
    }));

  return { withdrawals };
}

export async function getRetryableAsyncWithdrawals(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ withdrawals: ApiAsyncWithdrawal[] }> {
  const withdrawals: ApiAsyncWithdrawal[] = await axios.post(
    subgraphUrl,
    {
      query: `query getAsyncWithdrawals(
        $blockNumber: Int,
        $lastId: ID
      ) {
        asyncWithdrawals(
          where: { isRetryable: true, id_gt: $lastId }
          block: { number: $blockNumber }
          first: ${Pageable.MAX_PAGE_SIZE}
          orderBy: id
        ) {
          id
          key
          marginAccount {
            user {
              id
            }
            accountNumber
          }
          inputToken {
            id
            marketId
            symbol
            name
            decimals
          }
          inputAmount
          outputToken {
            id
            marketId
            symbol
            name
            decimals
          }
          outputAmount
          status
          isRetryable
        }
      }`,
      variables: {
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then((response: any) => {
      if (response.errors && typeof response.errors === 'object') {
        return Promise.reject((response.errors as any)[0]);
      } else {
        return (response as GraphqlAsyncWithdrawalResult).data.asyncWithdrawals;
      }
    })
    .then(graphqlWithdrawals => graphqlWithdrawals.map<ApiAsyncWithdrawal>(withdrawal => {
      const inputValueBase = TEN_BI.pow(withdrawal.inputToken.decimals)
      const outputValueBase = TEN_BI.pow(withdrawal.outputToken.decimals)
      return {
        id: withdrawal.id,
        key: withdrawal.key,
        actionType: ApiAsyncActionType.WITHDRAWAL,
        owner: withdrawal.marginAccount.user.id.toLowerCase(),
        accountNumber: new ZapBigNumber(withdrawal.marginAccount.accountNumber),
        status: withdrawal.status,
        inputToken: mapGraphqlTokenToZapApiToken(withdrawal.inputToken),
        inputAmount: new ZapBigNumber(withdrawal.inputAmount).times(inputValueBase).integerValue(),
        outputToken: mapGraphqlTokenToZapApiToken(withdrawal.outputToken),
        outputAmount: new ZapBigNumber(withdrawal.outputAmount).times(outputValueBase).integerValue(),
      };
    }));

  return { withdrawals };
}

function mapGraphqlAccountToApiAccount(
  account: GraphqlAccount,
  marketIndexMap: { [marketId: string]: MarketIndex | undefined },
): ApiAccount | undefined {
  let skip = false;
  const balances = account.tokenValues.reduce<{ [marketNumber: string]: ApiBalance }>((memo, value) => {
    const tokenBase = TEN_BI.pow(value.token.decimals);
    const valuePar = new BigNumber(value.valuePar).times(tokenBase);
    const indexObject = marketIndexMap[value.token.marketId];
    if (!indexObject) {
      skip = true;
      return memo;
    }

    const index = (valuePar.lt('0') ? indexObject.borrow : indexObject.supply)
      .times(INTEGERS.INTEREST_RATE_BASE);
    memo[value.token.marketId] = {
      marketId: Number(value.token.marketId),
      tokenName: value.token.name,
      tokenSymbol: value.token.symbol,
      tokenDecimals: Number.parseInt(value.token.decimals, 10),
      tokenAddress: value.token.id,
      par: valuePar,
      wei: new BigNumber(valuePar).times(index)
        .div(INTEGERS.INTEREST_RATE_BASE)
        .integerValue(BigNumber.ROUND_HALF_UP),
      expiresAt: value.expirationTimestamp ? new BigNumber(value.expirationTimestamp) : null,
      expiryAddress: value.expiryAddress,
    };
    return memo;
  }, {});

  if (skip) {
    return undefined;
  }

  return {
    id: `${account.user.id.toLowerCase()}-${account.accountNumber}`,
    owner: account.user.id.toLowerCase(),
    number: new BigNumber(account.accountNumber),
    effectiveUser: account.user.effectiveUser?.id.toLowerCase(), // unavailable on the Liquidator subgraph
    balances,
  };
}

function reduceResultIntoTotalYield(
  result: GraphqlAmmDataForUserResult,
  blockNumbers: number[],
): TotalYield {
  const blockNumbersAsc = blockNumbers.sort((a, b) => a - b);

  return blockNumbersAsc.reduce<TotalYield>((memo, blockNumber, i) => {
    const blockNumberYesterday = i === 0 ? undefined : blockNumbersAsc[i - 1];
    const ammPair = result.data[`ammPair_${blockNumber}`]?.[0] as GraphqlAmmPairData | undefined;
    const ammPairYesterday = result.data[`ammPair_${blockNumberYesterday}`]?.[0] as GraphqlAmmPairData | undefined;
    const interestRateMap = (result.data[`interestRates_${blockNumber}`] as GraphqlInterestRate[])?.reduce<Record<string, BigNumber>>(
      (map, interestRate) => {
        map[interestRate.token.id] = new BigNumber(interestRate.supplyInterestRate).div(365);
        return map;
      },
      {},
    );
    const interestIndexMap = (result.data[`interestIndexes_${blockNumber}`] as GraphqlInterestIndex[])?.reduce<Record<string, BigNumber>>(
      (map, interestIndex) => {
        map[interestIndex.token.id] = new BigNumber(interestIndex.supplyIndex);
        return map;
      },
      {},
    );
    const oraclePriceMap = (result.data[`oraclePrices_${blockNumber}`] as GraphqlOraclePrice[])?.reduce<Record<string, BigNumber>>(
      (map, price) => {
        map[price.token.id] = new BigNumber(price.price);
        return map;
      },
      {},
    );
    const ammLiquidityPosition = result.data[`ammLiquidityPosition_${blockNumber}`]?.[0] as GraphqlAmmLiquidityPosition | undefined;
    if (!ammPair || !interestRateMap || !interestIndexMap || !oraclePriceMap) {
      return memo
    }

    const wethInterestRate = interestRateMap['0x82af49447d8a07e3bd95bd0d56f35241523fbab1'];
    const bridgedUsdcInterestRate = interestRateMap['0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'];
    const equityPercent = ammLiquidityPosition
      ? new BigNumber(ammLiquidityPosition.liquidityTokenBalance).div(ammPair.totalSupply)
      : INTEGERS.ZERO;
    const lpLendingYield = wethInterestRate.plus(bridgedUsdcInterestRate)
      .div(2)
      .times(equityPercent)
      .times(ammPair.reserveUSD);
    const volumeUSD = ammPairYesterday
      ? new BigNumber(ammPair.volumeUSD).minus(ammPairYesterday.volumeUSD)
      : INTEGERS.ZERO;
    const swapYield = volumeUSD.times(equityPercent).times(0.003);

    const lendingYield = (result.data[`marginAccounts_${blockNumber}`] as GraphqlTokenValue[]).reduce((
      valueUsd,
      tokenValue,
    ) => {
      const valuePar = new BigNumber(tokenValue.valuePar);
      if (valuePar.eq(INTEGERS.ZERO)) {
        return valueUsd;
      }

      const index = interestIndexMap[tokenValue.token.id];
      const interestRate = interestRateMap[tokenValue.token.id];
      const price = oraclePriceMap[tokenValue.token.id];
      return valueUsd.plus(valuePar.times(index).times(interestRate).times(price));
    }, INTEGERS.ZERO);
    const totalYield = lpLendingYield.plus(swapYield).plus(lendingYield);
    return {
      totalEntries: memo.totalEntries + 1,
      swapYield: memo.swapYield.plus(swapYield),
      lpLendingYield: memo.lpLendingYield.plus(lpLendingYield),
      lendingYield: memo.lendingYield.plus(lendingYield),
      totalYield: memo.totalYield.plus(totalYield),
    }
  }, {
    totalEntries: 0,
    swapYield: new BigNumber(0),
    lpLendingYield: new BigNumber(0),
    lendingYield: new BigNumber(0),
    totalYield: new BigNumber(0),
  });
}
