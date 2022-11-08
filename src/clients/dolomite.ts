/* eslint-disable max-len */
import {
  BigNumber,
  Decimal,
} from '@dolomite-exchange/dolomite-margin';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import fetch from 'node-fetch';
import { dolomite } from '../helpers/web3';
import {
  ApiAccount,
  ApiBalance,
  ApiMarket,
  ApiRiskParam,
  MarketIndex,
} from '../lib/api-types';
import {
  GraphqlAccountResult,
  GraphqlMarketResult,
  GraphqlRiskParamsResult,
} from '../lib/graphql-types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ethers = require('ethers');

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
  const accounts: ApiAccount[] = await fetch(subgraphUrl, {
    method: 'POST',
    body: JSON.stringify({
      query,
      variables: {
        blockNumber,
        skip: 1000 * pageIndex,
      },
    }),
    headers: {
      'content-type': 'application/json',
    },
  })
    .then(response => response.json())
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
  const result: any = await fetch(subgraphUrl, {
    method: 'POST',
    body: JSON.stringify({
      query: `query getMarketRiskInfos($blockNumber: Int, $skip: Int) {
                marketRiskInfos(block: { number: $blockNumber } first: 1000 skip: $skip) {
                  token {
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
    }),
    headers: {
      'content-type': 'application/json',
    },
  })
    .then(response => response.json())
    .then(json => json as GraphqlMarketResult);

  if (result.errors && typeof result.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(result.errors[0]);
  }

  const calls = result.data.marketRiskInfos.map(market => {
    return {
      target: (dolomite.contracts.dolomiteMargin.options as any).address,
      callData: dolomite.contracts.dolomiteMargin.methods.getMarketPrice(market.token.marketId)
        .encodeABI(),
    };
  });

  const { results: marketPrices } = await dolomite.multiCall.aggregate(calls, { blockNumber });

  const markets: Promise<ApiMarket>[] = result.data.marketRiskInfos.map(async (market, i) => {
    const oraclePriceString = dolomite.web3.eth.abi.decodeParameter('uint256', marketPrices[i]);
    const apiMarket: ApiMarket = {
      id: Number(market.token.marketId),
      tokenAddress: market.token.id,
      oraclePrice: new BigNumber(oraclePriceString),
      marginPremium: new BigNumber(decimalToString(market.marginPremium)),
      liquidationRewardPremium: new BigNumber(decimalToString(market.liquidationRewardPremium)),
    };
    return apiMarket;
  });

  return { markets: await Promise.all(markets) };
}

export async function getDolomiteRiskParams(blockNumber: number): Promise<{ riskParams: ApiRiskParam }> {
  const result: any = await fetch(`${process.env.SUBGRAPH_URL}`, {
    method: 'POST',
    body: JSON.stringify({
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
    }),
    headers: {
      'content-type': 'application/json',
    },
  })
    .then(response => response.json())
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
