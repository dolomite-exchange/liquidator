/* eslint-disable max-len */
import { address, BigNumber, Decimal, Networks } from '@dolomite-exchange/dolomite-margin';
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
import AccountRiskOverrideSetterAbi from '../abis/account-risk-override-setter.json';
import { isMarketIgnored } from '../helpers/market-helpers';
import { dolomite } from '../helpers/web3';
import {
  ALL_E_MODE_CATEGORIES,
  ApiAccount,
  ApiBalance,
  ApiLiquidation,
  ApiMarket,
  ApiRiskParam,
  ApiTokenResponse,
  EModeCategory,
  EModeCategoryStruct,
  EModeRiskFeature,
  EModeRiskFeatureStruct,
  MarketIndex,
  SingleCollateralParam,
  TotalValueLockedAndFees,
} from '../lib/api-types';
import { ChainId } from '../lib/chain-id';
import { ACCOUNT_RISK_OVERRIDE_SETTER_ADDRESS, TEN_BI } from '../lib/constants';
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
  GraphqlRiskParams,
  GraphqlRiskParamsResult,
  GraphqlTimestampToBlockResult,
  GraphqlToken,
  GraphqlTokenValue,
  GraphqlUserResult,
} from '../lib/graphql-types';
import Logger from '../lib/logger';
import { aggregateWithExceptionHandler } from '../lib/multi-call-with-exception-handler';
import Pageable from '../lib/pageable';
import '../lib/env';
import { chunkArray, DECIMAL_BASE } from '../lib/utils';

const { defaultAbiCoder } = ethers.utils;

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
};

const subgraphUrl = process.env.SUBGRAPH_URL ?? '';
if (!subgraphUrl) {
  throw new Error('SUBGRAPH_URL is not set')
}

export const SOLID_ACCOUNT = {
  owner: process.env.ACCOUNT_WALLET_ADDRESS as string,
  number: new BigNumber(process.env.DOLOMITE_ACCOUNT_NUMBER as string),
};

const marginAccountFields = `
                  id
                  user {
                    id
                  }
                  accountNumber
                  tokenValues(where: { valuePar_not: "0" }) {
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
  extraVariables: object = {},
): Promise<{ accounts: ApiAccount[] }> {
  const accounts: ApiAccount[] = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        ...extraVariables,
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

export async function getLiquidatableDolomiteAccountsWithCertainSupplyAsset(
  marketIndexMap: { [marketId: string]: MarketIndex },
  tokenAddress: string,
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($tokenAddress: String, $blockNumber: Int, $lastId: ID) {
                marginAccounts(
                  where: { hasBorrowValue: true id_gt: $lastId supplyTokens_contains: [$tokenAddress]  }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                ${marginAccountFields}
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId, { tokenAddress });
}

export async function getLiquidatableDolomiteAccountsWithCertainBorrowAsset(
  marketIndexMap: { [marketId: string]: MarketIndex },
  tokenAddress: string,
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($tokenAddress: String, $blockNumber: Int, $lastId: ID) {
                marginAccounts(
                  where: { hasBorrowValue: true id_gt: $lastId borrowTokens_contains: [$tokenAddress]  }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                ${marginAccountFields}
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId, { tokenAddress });
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
  filterOutBadPrices: boolean,
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
                  id
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
  const marketPriceResults = await aggregateWithExceptionHandler(marketPriceCalls);

  const marketToDolomiteApiMarket: Record<string, {
    supplyWei: Decimal;
    maxSupplyWei: Decimal | undefined
  } | undefined> = {};
  try {
    const resultJson = await axios.get(`https://api.dolomite.io/tokens/${dolomite.networkId}`)
      .then(res => {
        if (res.status !== 200) {
          return Promise.reject(new Error(`Failed to fetch token info: ${res.statusText}`));
        }

        return Promise.resolve(res.data.tokens as ApiTokenResponse[]);
      });

    resultJson.forEach(token => {
      marketToDolomiteApiMarket[token.marketId] = {
        supplyWei: new BigNumber(token.supplyLiquidity),
        maxSupplyWei: token.riskInfo.supplyMaxWei ? new BigNumber(token.riskInfo.supplyMaxWei) : undefined,
      }
    });
  } catch (e) {
    Logger.warn({
      at: 'getDolomiteMarkets',
      message: 'Could not get API response for current liquidity',
    });
  }

  const badMarkets: number[] = [];
  const markets: ApiMarket[] = filteredMarketRiskInfos
    .map((market, i) => {
      const marketId = new BigNumber(market.token.marketId)
      if (!marketPriceResults[i].success) {
        badMarkets.push(marketId.toNumber());
      }

      if (!marketPriceResults[i].success && filterOutBadPrices) {
        return undefined;
      }
      const oraclePrice = marketPriceResults[i].success
        ? dolomite.web3.eth.abi.decodeParameter('uint256', marketPriceResults[i].returnData)
        : INTEGERS.ZERO;
      const apiMarket: ApiMarket = {
        id: market.id,
        marketId: marketId.toNumber(),
        decimals: Number(market.token.decimals),
        symbol: market.token.symbol,
        name: market.token.name,
        tokenAddress: market.token.id,
        oraclePrice: new BigNumber(oraclePrice.toString()),
        marginPremium: new BigNumber(decimalToString(market.marginPremium)),
        liquidationRewardPremium: new BigNumber(decimalToString(market.liquidationRewardPremium)),
        isBorrowingDisabled: market.isBorrowingDisabled,
        supplyLiquidity: marketToDolomiteApiMarket[market.id]?.supplyWei,
        maxSupplyLiquidity: marketToDolomiteApiMarket[market.id]?.maxSupplyWei,
      };
      return apiMarket;
    })
    .filter((m): m is ApiMarket => m !== undefined);

  if (badMarkets.length !== 0) {
    Logger.info({
      message: 'Found markets with invalid oracle prices:',
      badMarkets: badMarkets.join(', '),
    });
  }

  return { markets };
}

export async function getDolomiteRiskParams(blockNumber: number): Promise<{ riskParams: ApiRiskParam }> {
  const subgraphResult: any = await axios.post(
    subgraphUrl,
    {
      query: `query getDolomiteMargins($blockNumber: Int) {
        dolomiteMargins(block: { number: $blockNumber }) {
          id
          liquidationRatio
          liquidationReward
          numberOfMarkets
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

  if (subgraphResult.errors && typeof subgraphResult.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(subgraphResult.errors[0]);
  }

  const dolomiteGql = subgraphResult.data.dolomiteMargins[0] as GraphqlRiskParams;
  const marketCount = Number(dolomiteGql.numberOfMarkets);

  const marketIdToCategoryMap: Record<number, EModeCategoryStruct | undefined> = {};
  const marketIdToRiskFeatureMap: Record<number, EModeRiskFeatureStruct | undefined> = {};
  if (dolomite.networkId !== Networks.ARBITRUM_ONE) {
    const accountRiskOverrideSetter = new dolomite.web3.eth.Contract(
      AccountRiskOverrideSetterAbi,
      ACCOUNT_RISK_OVERRIDE_SETTER_ADDRESS,
    );
    const calls: {
      target: string;
      callData: string;
    }[] = [];

    ALL_E_MODE_CATEGORIES.forEach(category => {
      calls.push({
        target: accountRiskOverrideSetter.options.address,
        callData: accountRiskOverrideSetter.methods.getCategoryParamByCategory(category).encodeABI(),
      });
    });

    for (let marketId = 0; marketId < marketCount; marketId++) {
      calls.push({
        target: accountRiskOverrideSetter.options.address,
        callData: accountRiskOverrideSetter.methods.getCategoryByMarketId(marketId).encodeABI(),
      });
    }

    for (let marketId = 0; marketId < marketCount; marketId++) {
      calls.push({
        target: accountRiskOverrideSetter.options.address,
        callData: accountRiskOverrideSetter.methods.getRiskFeatureParamByMarketId(marketId).encodeABI(),
      });
    }

    const chunks = chunkArray(calls, 100);
    const results: string[] = [];
    for (const chunk of chunks) {
      const { results: resultChunk } = await dolomite.multiCall.aggregate(chunk, { blockNumber });
      results.push(...resultChunk);
    }

    let cursor = 0;
    const categoryToParam: Record<EModeCategory, EModeCategoryStruct | undefined> = {
      [EModeCategory.NONE]: undefined,
      [EModeCategory.BERA]: undefined,
      [EModeCategory.BTC]: undefined,
      [EModeCategory.ETH]: undefined,
      [EModeCategory.STABLE]: undefined,
    };
    ALL_E_MODE_CATEGORIES.forEach(category => {
      const result = defaultAbiCoder.decode(['(uint8,(uint256),(uint256))'], results[cursor++])[0];
      categoryToParam[category] = {
        category: result[0],
        marginRatioOverride: new BigNumber(result[1][0].toString()).plus(DECIMAL_BASE),
        liquidationRewardOverride: new BigNumber(result[2][0].toString()).plus(DECIMAL_BASE),
      };
    });

    for (let marketId = 0; marketId < marketCount; marketId++) {
      const result = defaultAbiCoder.decode(['uint8'], results[cursor++]);
      const category = result[0] as EModeCategory;
      if (category !== EModeCategory.NONE) {
        marketIdToCategoryMap[marketId] = {
          category,
          marginRatioOverride: categoryToParam[category]!.marginRatioOverride,
          liquidationRewardOverride: categoryToParam[category]!.liquidationRewardOverride,
        };
      }
    }

    for (let marketId = 0; marketId < marketCount; marketId++) {
      const result = defaultAbiCoder.decode(['(uint8, bytes)'], results[cursor++])[0];
      const riskFeature = result[0] as EModeRiskFeature;
      if (riskFeature === EModeRiskFeature.BORROW_ONLY) {
        marketIdToRiskFeatureMap[marketId] = {
          feature: EModeRiskFeature.BORROW_ONLY,
        };
      } else if (riskFeature === EModeRiskFeature.SINGLE_COLLATERAL_WITH_STRICT_DEBT) {
        const params = defaultAbiCoder.decode(['(uint256[], (uint256), (uint256))[]'], result[1])[0];
        const mappedParams: SingleCollateralParam[] = [];
        for (let i = 0; i < params.length; i++) {
          mappedParams.push({
            debtMarketIds: params[i][0].map((m: any) => new BigNumber(m.toNumber())),
            marginRatioOverride: new BigNumber(params[i][1].toString()).plus(DECIMAL_BASE),
            liquidationRewardOverride: new BigNumber(params[i][2].toString()).plus(DECIMAL_BASE),
          });
        }
        marketIdToRiskFeatureMap[marketId] = {
          params: mappedParams,
          feature: EModeRiskFeature.SINGLE_COLLATERAL_WITH_STRICT_DEBT,
        };
      }
    }
  }

  const riskParams: ApiRiskParam[] = subgraphResult.data.dolomiteMargins.map(riskParam => {
    return {
      dolomiteMargin: ethers.utils.getAddress(riskParam.id),
      liquidationRatio: new BigNumber(decimalToString(riskParam.liquidationRatio)),
      liquidationReward: new BigNumber(decimalToString(riskParam.liquidationReward)),
      numberOfMarkets: marketCount,
      riskOverrideSettings: {
        marketIdToCategoryMap,
        marketIdToRiskFeatureMap,
      },
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
    queries += `_${timestamp}:blocks(where: { timestamp_gt: ${timestamp
    - 30}, timestamp_lte: ${timestamp} } first: 1 orderBy: number orderDirection: desc) { number }\n`
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
    const allPricesRaw = await aggregateWithExceptionHandler(callDatas, { blockNumber });
    const allPrices = allPricesRaw.map(priceEncoded => {
      if (!priceEncoded.success) {
        return undefined;
      }
      return new BigNumber(dolomite.web3.eth.abi.decodeParameter('uint256', priceEncoded.returnData).toString());
    })

    const allPricesMap = allMarkets.reduce((memo, market, j) => {
      const price = allPrices[j];
      if (price) {
        memo[market.toFixed()] = price;
      }
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
      .times(DECIMAL_BASE);
    memo[value.token.marketId] = {
      marketId: Number(value.token.marketId),
      tokenName: value.token.name,
      tokenSymbol: value.token.symbol,
      tokenDecimals: Number.parseInt(value.token.decimals, 10),
      tokenAddress: value.token.id,
      par: valuePar,
      wei: new BigNumber(valuePar).times(index)
        .div(DECIMAL_BASE)
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
