/* eslint-disable max-len */
import { address, ADDRESSES, BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import axios from 'axios';
import { dolomite } from '../helpers/web3';
import {
  ApiAccount,
  ApiAccountFromNativeSubgraph,
  ApiBalance,
  ApiMarket,
  ApiRiskParam,
  ApiUnwrapperInfo,
  MarketIndex,
} from '../lib/api-types';
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
        skip: 1000 * pageIndex,
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
        id: `${account.user}-${account.accountNumber}`,
        owner: account.user,
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
                marginAccounts(where: { hasBorrowValue: true } block: { number: $blockNumber } first: 1000 skip: $skip) {
                  id
                  user
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

export async function getAllDolomiteAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  pageIndex: number = 0,
): Promise<{ accounts: ApiAccountFromNativeSubgraph[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $skip: Int) {
                marginAccounts(where: { hasSupplyValue: true } block: { number: $blockNumber } first: 1000 skip: $skip) {
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
  const accounts = await getAccounts(marketIndexMap, query, blockNumber, pageIndex);
  return (accounts as any) as { accounts: ApiAccountFromNativeSubgraph[] };
}

export async function getExpiredAccounts(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  pageIndex: number = 0,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $skip: Int) {
                marginAccounts(where: { hasBorrowValue: true hasExpiration: true } block: { number: $blockNumber } first: 1000 skip: $skip) {
                  id
                  user
                  accountNumber
                  tokenValues {
                    token {
                      id
                      marketId
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
  const result: any = await axios.post(
    subgraphUrl,
    {
      query: `query getMarketRiskInfos($blockNumber: Int, $skip: Int) {
                marketRiskInfos(block: { number: $blockNumber } first: 1000 skip: $skip) {
                  token {
                    id
                    marketId
                    symbol
                    decimals
                  }
                  marginPremium
                  liquidationRewardPremium
                }
              }`,
      variables: {
        blockNumber,
        skip: pageIndex * 1000,
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

  const tokenUnwrapperCalls = result.data.marketRiskInfos.map(market => {
    const contract = dolomite.contracts.liquidatorProxyV3WithLiquidityToken;
    return {
      target: contract.options.address,
      callData: contract.methods.marketIdToTokenUnwrapperMap(market.token.marketId).encodeABI(),
    };
  });

  // Even though the block number from the subgraph is certainly behind the RPC, we want the most updated chain data!
  const { results: marketPriceResults } = await dolomite.multiCall.aggregate(marketPriceCalls);
  const { results: tokenUnwrapperResults } = await dolomite.multiCall.aggregate(tokenUnwrapperCalls);

  const outputMarketIdCalls = tokenUnwrapperResults.reduce<{ marketId: number, target: string; callData: string; }[]>((memo, unwrapperResult, i) => {
    const unwrapper = dolomite.web3.eth.abi.decodeParameter('address', unwrapperResult);
    if (unwrapper !== ADDRESSES.ZERO) {
      const contract = dolomite.getTokenUnwrapper(unwrapper);
      memo.push({
        marketId: result.data.marketRiskInfos[i].token.marketId,
        target: contract.address,
        callData: contract.unwrapperContract.methods.outputMarketId().encodeABI(),
      });
    }
    return memo;
  }, []);

  const { results: outputMarketIdResults } = await dolomite.multiCall.aggregate(outputMarketIdCalls);
  const marketIdToOutputMarketIdMap = outputMarketIdCalls.reduce<{ [marketId: number]: number }>((memo, call, i) => {
    const outputMarketId = dolomite.web3.eth.abi.decodeParameter('uint256', outputMarketIdResults[i]);
    memo[call.marketId] = Number(outputMarketId);
    return memo;
  }, {})

  const markets: Promise<ApiMarket>[] = result.data.marketRiskInfos.map(async (market, i) => {
    const oraclePrice = dolomite.web3.eth.abi.decodeParameter('uint256', marketPriceResults[i]);
    const tokenUnwrapper = dolomite.web3.eth.abi.decodeParameter('address', tokenUnwrapperResults[i]);
    let unwrapperInfo: ApiUnwrapperInfo | undefined;
    if (tokenUnwrapper !== ADDRESSES.ZERO) {
      unwrapperInfo = {
        unwrapperAddress: tokenUnwrapper,
        outputMarketId: marketIdToOutputMarketIdMap[market.token.marketId],
      };
    }
    const apiMarket: ApiMarket = {
      id: Number(market.token.marketId),
      decimals: Number(market.token.decimals),
      tokenAddress: market.token.id,
      oraclePrice: new BigNumber(oraclePrice),
      marginPremium: new BigNumber(decimalToString(market.marginPremium)),
      liquidationRewardPremium: new BigNumber(decimalToString(market.liquidationRewardPremium)),
      unwrapperInfo,
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
  let queries = '';
  blockNumbers.forEach(blockNumber => {
    queries += `
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
  });
  const result = await axios.post(
    `${process.env.SUBGRAPH_URL}`,
    {
      query: `query getAmmDataForUser {
        ${queries}
      }`,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlAmmDataForUserResult);

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
