/* eslint-disable max-len */
import { address, BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import axios from 'axios';
import { dolomite } from '../helpers/web3';
import { ApiAccount, ApiBalance, ApiMarket, ApiRiskParam, ApiUnwrapperInfo, MarketIndex } from '../lib/api-types';
import {
  getIsolationModeUnwrapperByMarketId,
  getIsolationModeUnwrapperMarketIdByMarketId,
  getLiquidityTokenUnwrapperByMarketId,
  getLiquidityTokenUnwrapperMarketIdByMarketId, isIsolationModeToken, isLiquidityToken,
} from '../lib/constants';
import {
  GraphqlAccountResult,
  GraphqlAmmDataForUserResult,
  GraphqlAmmLiquidityPosition,
  GraphqlAmmPairData,
  GraphqlInterestRate,
  GraphqlMarketResult,
  GraphqlRiskParamsResult,
  GraphqlTimestampToBlockResult,
} from '../lib/graphql-types';
import Pageable from '../lib/pageable';

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
  pageIndex: number = 0,
): Promise<{ accounts: ApiAccount[] }> {
  const decimalBase = new BigNumber('1000000000000000000');
  const accounts: ApiAccount[] = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        skip: Pageable.MAX_PAGE_SIZE * pageIndex,
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
        const tokenBase = new BigNumber('10').pow(value.token.decimals);
        const valuePar = new BigNumber(value.valuePar).times(tokenBase);
        const indexObject = marketIndexMap[value.token.marketId];
        const index = (new BigNumber(valuePar).lt('0') ? indexObject.borrow : indexObject.supply).times(decimalBase);
        memo[value.token.marketId] = {
          marketId: Number(value.token.marketId),
          tokenName: value.token.name,
          tokenSymbol: value.token.symbol,
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
        owner: account.user.id,
        number: new BigNumber(account.accountNumber),
        balances,
      };
    }));

  return { accounts };
}

export async function getLiquidatableDolomiteAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  pageIndex: number = 0,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $skip: Int) {
                marginAccounts(where: { hasBorrowValue: true } block: { number: $blockNumber } first: ${Pageable.MAX_PAGE_SIZE} skip: $skip) {
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
  return getAccounts(marketIndexMap, query, blockNumber, pageIndex);
}

export async function getAllDolomiteAccountsWithSupplyValue(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  pageIndex: number = 0,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $skip: Int) {
                marginAccounts(where: { hasSupplyValue: true } block: { number: $blockNumber } first: ${Pageable.MAX_PAGE_SIZE} skip: $skip) {
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
  return getAccounts(marketIndexMap, query, blockNumber, pageIndex);
}

export async function getExpiredAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  pageIndex: number = 0,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $skip: Int) {
                marginAccounts(where: { hasBorrowValue: true hasExpiration: true } block: { number: $blockNumber } first: ${Pageable.MAX_PAGE_SIZE} skip: $skip) {
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
  return getAccounts(marketIndexMap, query, blockNumber, pageIndex);
}

export async function getDolomiteMarkets(
  blockNumber: number,
  pageIndex: number = 0,
): Promise<{ markets: ApiMarket[] }> {
  const result: GraphqlMarketResult = await axios.post(
    subgraphUrl,
    {
      query: `query getMarketRiskInfos($blockNumber: Int, $skip: Int) {
                marketRiskInfos(block: { number: $blockNumber } first: ${Pageable.MAX_PAGE_SIZE} skip: $skip) {
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
        skip: pageIndex * Pageable.MAX_PAGE_SIZE,
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
    let isolationModeUnwrapperInfo: ApiUnwrapperInfo | undefined;
    if (isIsolationModeToken(market.token)) {
      isolationModeUnwrapperInfo = {
        unwrapperAddress: getIsolationModeUnwrapperByMarketId(marketId),
        outputMarketId: getIsolationModeUnwrapperMarketIdByMarketId(marketId),
      };
    }
    let liquidityTokenUnwrapperInfo: ApiUnwrapperInfo | undefined;
    if (isLiquidityToken(market.token)) {
      liquidityTokenUnwrapperInfo = {
        unwrapperAddress: getLiquidityTokenUnwrapperByMarketId(marketId),
        outputMarketId: getLiquidityTokenUnwrapperMarketIdByMarketId(marketId),
      };
    }
    const apiMarket: ApiMarket = {
      marketId: marketId.toNumber(),
      decimals: Number(market.token.decimals),
      symbol: market.token.symbol,
      name: market.token.name,
      tokenAddress: market.token.id,
      oraclePrice: new BigNumber(oraclePrice),
      marginPremium: new BigNumber(decimalToString(market.marginPremium)),
      liquidationRewardPremium: new BigNumber(decimalToString(market.liquidationRewardPremium)),
      isolationModeUnwrapperInfo,
      liquidityTokenUnwrapperInfo,
    };
    return apiMarket;
  });

  return { markets: await Promise.all(markets) };
}

export async function getDolomiteRiskParams(blockNumber: number): Promise<{ riskParams: ApiRiskParam }> {
  const result: any = await axios.post(
    `${process.env.SUBGRAPH_URL}`,
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
    queries += `_${timestamp}:blocks(where: { timestamp_gt: ${timestamp - 30}, timestamp_lt: ${timestamp
    + 30} } first: 1) { number }`
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
      `${process.env.SUBGRAPH_URL}`,
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
