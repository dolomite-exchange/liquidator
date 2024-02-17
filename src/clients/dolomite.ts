/* eslint-disable max-len */
import { address, BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import axios from 'axios';
import { dolomite } from '../helpers/web3';
import {
  ApiAccount,
  ApiAsyncActionType,
  ApiAsyncDeposit,
  ApiAsyncWithdrawal,
  ApiBalance,
  ApiMarket,
  ApiRiskParam,
  ApiToken,
  MarketIndex,
  TotalValueLockedAndFees,
} from '../lib/api-types';
import { TEN_BI } from '../lib/constants';
import {
  GraphqlAccountResult,
  GraphqlAmmDataForUserResult,
  GraphqlAmmLiquidityPosition,
  GraphqlAmmPairData,
  GraphqlAsyncDepositResult,
  GraphqlAsyncWithdrawalResult,
  GraphqlInterestRate,
  GraphqlMarketResult,
  GraphqlRiskParamsResult,
  GraphqlTimestampToBlockResult,
  GraphqlToken,
} from '../lib/graphql-types';
import Pageable from '../lib/pageable';
import '../lib/env';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ethers = require('ethers');

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
};

const subgraphUrl = process.env.SUBGRAPH_URL ?? '';
if (!subgraphUrl) {
  throw new Error('SUBGRAPH_URL is not set')
}

async function getAccounts(
  marketIndexMap: { [marketId: string]: { borrow: Decimal, supply: Decimal } },
  query: string,
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const decimalBase = new BigNumber('1000000000000000000');
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
    .then(graphqlAccounts => graphqlAccounts.map<ApiAccount>(account => {
      const balances = account.tokenValues.reduce<{ [marketNumber: string]: ApiBalance }>((memo, value) => {
        const tokenBase = TEN_BI.pow(value.token.decimals);
        const valuePar = new BigNumber(value.valuePar).times(tokenBase);
        const indexObject = marketIndexMap[value.token.marketId];
        const index = (new BigNumber(valuePar).lt('0') ? indexObject.borrow : indexObject.supply).times(decimalBase);
        memo[value.token.marketId] = {
          marketId: Number(value.token.marketId),
          tokenName: value.token.name,
          tokenSymbol: value.token.symbol,
          tokenDecimals: Number.parseInt(value.token.decimals, 10),
          tokenAddress: value.token.id,
          par: valuePar,
          wei: new BigNumber(valuePar).times(index)
            .div(decimalBase)
            .integerValue(BigNumber.ROUND_HALF_UP),
          expiresAt: value.expirationTimestamp ? new BigNumber(value.expirationTimestamp) : null,
          expiryAddress: value.expiryAddress,
        };
        return memo;
      }, {});
      return {
        id: `${account.user.id}-${account.accountNumber}`,
        owner: account.user?.id.toLowerCase(),
        number: new BigNumber(account.accountNumber),
        effectiveUser: account.user.effectiveUser?.id.toLowerCase(), // unavailable on the Liquidator subgraph
        balances,
      };
    }));

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
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId);
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
                  id
                  user {
                    id
                  }
                  accountNumber
                  tokenValues {
                    token {
                      id
                      marketId
                      name
                      symbol
                      decimals
                    }
                    valuePar
                    expirationTimestamp
                    expiryAddress
                  }
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
                marketRiskInfos(block: { number: $blockNumber } first: ${Pageable.MAX_PAGE_SIZE} where: { id_gt: $lastId } orderBy: id) {
                  token {
                    id
                    marketId
                    name
                    symbol
                    decimals
                  }
                  marginPremium
                  liquidationRewardPremium
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

  const marketPriceCalls = result.data.marketRiskInfos.map(market => {
    return {
      target: dolomite.address,
      callData: dolomite.contracts.dolomiteMargin.methods.getMarketPrice(market.token.marketId).encodeABI(),
    };
  });

  // Even though the block number from the subgraph is certainly behind the RPC, we want the most updated chain data!
  const { results: marketPriceResults } = await dolomite.multiCall.aggregate(marketPriceCalls);

  const markets: Promise<ApiMarket>[] = result.data.marketRiskInfos.map(async (market, i) => {
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

export async function getTimestampToBlockNumberMap(timestamps: number[]): Promise<Record<string, number>> {
  let queries = '';
  timestamps.forEach(timestamp => {
    queries += `_${timestamp}:blocks(where: { timestamp_gt: ${timestamp - 15}, timestamp_lt: ${timestamp
    + 15} } first: 1) { number }`
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
  lendingYield: Decimal
  totalYield: Decimal
}

export async function getTotalAmmPairYield(blockNumbers: number[], user: address): Promise<TotalYield> {
  const queryChunks = blockNumbers.reduce<string[]>((memo, blockNumber, i) => {
    if (!memo[Math.floor(i / 100)]) {
      memo[Math.floor(i / 100)] = '';
    }
    memo[Math.floor(i / 100)] += `
      ammPair_${blockNumber}:ammPairs(where: { id: "0xb77a493a4950cad1b049e222d62bce14ff423c6f" } block: { number: ${blockNumber} }) {
        volumeUSD
        reserveUSD
        reserve0
        reserve1
        totalSupply
      }
      wethInterestRate_${blockNumber}:interestRates(where: {id: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" } block: { number: ${blockNumber} }) {
        supplyInterestRate
      }
      usdcInterestRate_${blockNumber}:interestRates(where: {id: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8" } block: { number: ${blockNumber} }) {
        supplyInterestRate
      }
      ammLiquidityPosition_${blockNumber}:ammLiquidityPositions(where: { user: "${user}"} block: { number: ${blockNumber} }) {
        liquidityTokenBalance
      }
    `
    return memo;
  }, []);

  const totalYield: TotalYield = {
    totalEntries: 0,
    swapYield: new BigNumber(0),
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
    const tempTotalYield = reduceResultIntoTotalYield(result, blockNumbers);
    totalYield.totalEntries += tempTotalYield.totalEntries;
    totalYield.swapYield = totalYield.swapYield.plus(tempTotalYield.swapYield);
    totalYield.lendingYield = totalYield.lendingYield.plus(tempTotalYield.lendingYield);
    totalYield.totalYield = totalYield.totalYield.plus(tempTotalYield.totalYield);
  }

  return totalYield;
}

export async function getTotalValueLockedAndFees(blockNumbers: number[]): Promise<TotalValueLockedAndFees> {
  const queryChunks = blockNumbers.map(blockNumber => {
    return `
      interestRates(
        block: { number: ${blockNumber} }
        orderBy: token__marketId
        orderDirection: asc
      ) {
        token {
          id
          decimals
          supplyLiquidity
          borrowLiquidity
        }
        borrowInterestRate
      }
    `;
  }, []);

  const allTvlAndFees: TotalValueLockedAndFees = {
    totalValueLocked: [],
    borrowFees: [],
  };
  for (let i = 0; i < queryChunks.length; i += 1) {
    const blockNumber = blockNumbers[i];
    const numberOfMarkets = await dolomite.getters.getNumMarkets({ blockNumber });
    const allMarkets: BigNumber[] = []
    for (let j = 0; j < numberOfMarkets.toNumber(); j += 1) {
      allMarkets.push(new BigNumber(j));
    }

    const allPrices = await Promise.all(
      allMarkets.map(market => dolomite.getters.getMarketPrice(market, { blockNumber })),
    );

    const interestRates = await axios.post(
      subgraphUrl,
      {
        query: `query getTvlAndInterestRatesByMarkets { ${queryChunks[i]} }`,
      },
      defaultAxiosConfig,
    )
      .then(response => response.data)
      .then(json => (json.data.interestRates) as GraphqlInterestRate[]);

    interestRates.forEach((rate, j) => {
      if (!allTvlAndFees.totalValueLocked[i]) {
        allTvlAndFees.totalValueLocked[i] = new BigNumber(0);
        allTvlAndFees.borrowFees[i] = new BigNumber(0);
      }

      const supplyLiquidity = new BigNumber(rate.token.supplyLiquidity);
      const borrowLiquidity = new BigNumber(rate.token.borrowLiquidity);
      const scaleFactor = new BigNumber(10).pow(new BigNumber(36).minus(rate.token.decimals))
      const priceUsd = allPrices[j].div(scaleFactor);

      allTvlAndFees.totalValueLocked[i] = allTvlAndFees.totalValueLocked[i].plus(supplyLiquidity.times(priceUsd));

      const feesDaily = borrowLiquidity.times(priceUsd).times(rate.borrowInterestRate).div(365);
      allTvlAndFees.borrowFees[i] = allTvlAndFees.borrowFees[i].plus(feesDaily);
    });
  }

  return allTvlAndFees;
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
    .then(json => {
      return (json.data) as { start: { transactionCount: string }[], end: { transactionCount: string }[] }
    });

  return new BigNumber(end[0].transactionCount).minus(start[0].transactionCount);
}

function mapGraphqlTokenToApiToken(token: GraphqlToken): ApiToken {
  return {
    tokenAddress: token.id,
    marketId: new BigNumber(token.marketId),
    decimals: parseInt(token.decimals, 10),
    symbol: token.symbol,
    name: token.name,
  }
}

export async function getRetryableAsyncDeposits(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ deposits: ApiAsyncDeposit[] }> {
  const deposits: ApiAsyncDeposit[] = await axios.post(
    subgraphUrl,
    {
      query: `query getAsyncDeposits(
        $blockNumber: Int!
      ) {
        asyncDeposits(
          where: { isRetryable: true }
          block: { number: $blockNumber }
        ) {
          id
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
    .then(graphqlDeposits => graphqlDeposits.map<ApiAsyncDeposit>(deposit => {
      const inputValueBase = TEN_BI.pow(deposit.inputToken.decimals)
      const outputValueBase = TEN_BI.pow(deposit.outputToken.decimals)
      return {
        id: `${deposit.id}`,
        actionType: ApiAsyncActionType.DEPOSIT,
        owner: deposit.marginAccount.user.id,
        accountNumber: new BigNumber(deposit.marginAccount.accountNumber),
        status: deposit.status,
        inputToken: mapGraphqlTokenToApiToken(deposit.inputToken),
        inputAmount: new BigNumber(deposit.inputAmount).times(inputValueBase),
        outputToken: mapGraphqlTokenToApiToken(deposit.outputToken),
        minOutputAmount: new BigNumber(deposit.minOutputAmount).times(outputValueBase),
      };
    }));

  return { deposits };
}

export async function getRetryableAsyncWithdrawals(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ deposits: ApiAsyncWithdrawal[] }> {
  const withdrawals: ApiAsyncWithdrawal[] = await axios.post(
    subgraphUrl,
    {
      query: `query getAsyncWithdrawals(
        $blockNumber: Int!
      ) {
        asyncWithdrawals(
          where: { isRetryable: true }
          block: { number: $blockNumber }
        ) {
          id
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
        id: `${withdrawal.id}`,
        actionType: ApiAsyncActionType.WITHDRAWAL,
        owner: withdrawal.marginAccount.user.id,
        accountNumber: new BigNumber(withdrawal.marginAccount.accountNumber),
        status: withdrawal.status,
        inputToken: mapGraphqlTokenToApiToken(withdrawal.inputToken),
        inputAmount: new BigNumber(withdrawal.inputAmount).times(inputValueBase),
        outputToken: mapGraphqlTokenToApiToken(withdrawal.outputToken),
        outputAmount: new BigNumber(withdrawal.outputAmount).times(outputValueBase),
      };
    }));

  return { deposits: withdrawals };
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
    const wethInterestRateStruct = result.data[`wethInterestRate_${blockNumber}`]?.[0] as GraphqlInterestRate | undefined;
    const usdcInterestRateStruct = result.data[`usdcInterestRate_${blockNumber}`]?.[0] as GraphqlInterestRate | undefined;
    const ammLiquidityPosition = result.data[`ammLiquidityPosition_${blockNumber}`]?.[0] as GraphqlAmmLiquidityPosition | undefined;
    if (!ammPair || !ammPairYesterday || !wethInterestRateStruct || !usdcInterestRateStruct || !ammLiquidityPosition) {
      return memo
    }
    const wethInterestRate = new BigNumber(wethInterestRateStruct.supplyInterestRate).div(365);
    const usdcInterestRate = new BigNumber(usdcInterestRateStruct.supplyInterestRate).div(365);

    const ratio = new BigNumber(ammLiquidityPosition.liquidityTokenBalance).div(ammPair.totalSupply);
    const lendingYield = wethInterestRate.plus(usdcInterestRate).div(2).times(ratio).times(ammPair.reserveUSD);
    const volumeUSD = new BigNumber(ammPair.volumeUSD).minus(ammPairYesterday.volumeUSD);
    const swapYield = volumeUSD.times(ratio).times(0.003);
    const totalYield = lendingYield.plus(swapYield);
    return {
      totalEntries: memo.totalEntries + 1,
      swapYield: memo.swapYield.plus(swapYield),
      lendingYield: memo.lendingYield.plus(lendingYield),
      totalYield: memo.totalYield.plus(totalYield),
    }
  }, {
    totalEntries: 0,
    swapYield: new BigNumber(0),
    lendingYield: new BigNumber(0),
    totalYield: new BigNumber(0),
  });
}
