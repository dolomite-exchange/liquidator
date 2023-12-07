/* eslint-disable max-len */
import { address, BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import axios from 'axios';
import { dolomite } from '../helpers/web3';
import {
  ApiAccount,
  ApiAmmLiquidityPosition,
  ApiAmmLiquiditySnapshot,
  ApiBalance,
  ApiDeposit,
  ApiLiquidation,
  ApiLiquidityMiningVestingPosition,
  ApiMarket,
  ApiRiskParam,
  ApiTrade,
  ApiTransfer,
  ApiVestingPositionTransfer,
  ApiWithdrawal,
  MarketIndex,
} from '../lib/api-types';
import {
  GraphqlAccountResult,
  GraphqlAmmDataForUserResult,
  GraphqlAmmLiquidityPosition,
  GraphqlAmmLiquidityPositionsResult,
  GraphqlAmmPairData,
  GraphqlDepositsResult,
  GraphqlInterestRate,
  GraphqlLiquidationsResult,
  GraphqlLiquidityMiningVestingPositionsResult,
  GraphqlMarketResult,
  GraphqlRiskParamsResult,
  GraphqlTimestampToBlockResult,
  GraphqlTradesResult,
  GraphqlTransfersResult,
  GraphqlVestingPositionTransfersResult,
  GraphqlWithdrawalsResult,
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
        const tokenBase = new BigNumber('10').pow(value.token.decimals);
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

export async function getDeposits(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ deposits: ApiDeposit[] }> {
  const query = `
  query getDeposits($startBlock: BigInt, $endBlock: Int, $lastId: ID) {
    deposits(first: 1000, orderBy: id where: { and: [{ transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }} { id_gt: $lastId }]}) {
      id
      serialId
      transaction {
        timestamp
      }
      amountDeltaPar
      token {
        marketId
      }
      marginAccount {
        user {
          id
        }
        accountNumber
      }
      effectiveUser {
        id
      }
    }
  }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlDepositsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const deposits: ApiDeposit[] = result.data.deposits.map(deposit => {
    return {
      id: deposit.id,
      serialId: deposit.serialId,
      timestamp: deposit.transaction.timestamp,
      marginAccount: {
        user: deposit.marginAccount.user.id.toLowerCase(),
        accountNumber: deposit.marginAccount.accountNumber,
      },
      effectiveUser: deposit.effectiveUser.id.toLowerCase(),
      marketId: new BigNumber(deposit.token.marketId),
      amountDeltaPar: new BigNumber(deposit.amountDeltaPar),
    }
  });

  return { deposits };
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

export async function getLiquidations(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ liquidations: ApiLiquidation[] }> {
  const query = `
    query getLiquidations($startBlock: Int, $endBlock: Int, $lastId: ID) {
      liquidations(first: 1000, orderBy: id where: { and: [{ transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }} { id_gt: $lastId }]}) {
        id
        serialId
        transaction {
          timestamp
        }
        solidEffectiveUser {
          id
        }
        liquidEffectiveUser {
          id
        }
        solidMarginAccount {
          user {
            id
          }
          accountNumber
        }
        liquidMarginAccount {
          user {
            id
          }
          accountNumber
        }
        heldToken {
          marketId
        }
        heldTokenAmountDeltaWei
        heldTokenLiquidationRewardWei
        borrowedToken {
          marketId
        }
        borrowedTokenAmountDeltaWei
        solidHeldTokenAmountDeltaPar
        liquidHeldTokenAmountDeltaPar
        solidBorrowedTokenAmountDeltaPar
        liquidBorrowedTokenAmountDeltaPar
      }
    }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidationsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  if (result.data.liquidations.length === 0) {
    return { liquidations: [] };
  }
  const liquidations: ApiLiquidation[] = result.data.liquidations.map(liquidation => {
    return {
      id: liquidation.id,
      serialId: liquidation.serialId,
      timestamp: liquidation.transaction.timestamp,
      solidEffectiveUser: liquidation.solidEffectiveUser.id.toLowerCase(),
      solidMarginAccount: {
        user: liquidation.solidMarginAccount.user.id.toLowerCase(),
        accountNumber: liquidation.solidMarginAccount.accountNumber,
      },
      liquidEffectiveUser: liquidation.liquidEffectiveUser.id.toLowerCase(),
      liquidMarginAccount: {
        user: liquidation.liquidMarginAccount.user.id.toLowerCase(),
        accountNumber: liquidation.liquidMarginAccount.accountNumber,
      },
      heldToken: liquidation.heldToken.marketId,
      borrowedToken: liquidation.borrowedToken.marketId,
      solidHeldTokenAmountDeltaPar: liquidation.solidHeldTokenAmountDeltaPar,
      liquidHeldTokenAmountDeltaPar: liquidation.liquidHeldTokenAmountDeltaPar,
      solidBorrowedTokenAmountDeltaPar: liquidation.solidBorrowedTokenAmountDeltaPar,
      liquidBorrowedTokenAmountDeltaPar: liquidation.liquidBorrowedTokenAmountDeltaPar,
    }
  });

  return { liquidations };
}

export async function getLiquidityMiningVestingPositions(
  blockNumber: number,
  lastId: string,
): Promise<{ liquidityMiningVestingPositions: ApiLiquidityMiningVestingPosition[] }> {
  const query = `
    query getLiquidityMiningVestingPositions($blockNumber: Int, $lastId: ID) {
      liquidityMiningVestingPositions(first: 1000, orderBy: id where: { id_gt: $lastId } block: { number: $blockNumber }) {
        id
        owner {
          id
        }
        arbAmountPar
      }
    }
  `;
  const result: any = await axios.post(
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
    .then(json => json as GraphqlLiquidityMiningVestingPositionsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const liquidityMiningVestingPositions: ApiLiquidityMiningVestingPosition[] = result.data.liquidityMiningVestingPositions.map(
    liquidityMiningVestingPosition => {
      return {
        id: liquidityMiningVestingPosition.id,
        effectiveUser: liquidityMiningVestingPosition.owner.id.toLowerCase(),
        amount: liquidityMiningVestingPosition.arbAmountPar,
      }
    },
  );

  return { liquidityMiningVestingPositions };
}

export async function getLiquidityPositions(
  blockNumber: number,
  lastId: string,
): Promise<{ ammLiquidityPositions: ApiAmmLiquidityPosition[] }> {
  const query = `
    query getLiquidityPositions($blockNumber: Int, $lastId: ID) {
      ammLiquidityPositions(first: 1000, orderBy: id where: { id_gt: $lastId } block: { number: $blockNumber }) {
        id
        effectiveUser {
          id
        }
        liquidityTokenBalance
      }
    }
  `;
  const result: any = await axios.post(
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
    .then(json => json as GraphqlAmmLiquidityPositionsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const ammLiquidityPositions: ApiAmmLiquidityPosition[] = result.data.ammLiquidityPositions.map(ammLiquidityPosition => {
    return {
      id: ammLiquidityPosition.id,
      effectiveUser: ammLiquidityPosition.effectiveUser.id.toLowerCase(),
      balance: ammLiquidityPosition.liquidityTokenBalance,
    }
  });

  return { ammLiquidityPositions };
}

export async function getLiquiditySnapshots(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ snapshots: ApiAmmLiquiditySnapshot[] }> {
  const query = `
    query getAmmLiquidityPositionSnapshots($startBlock: Int, $endBlock: Int, $lastId: ID) {
      ammLiquidityPositionSnapshots(first: 10, orderBy: id where: { and: [{ block_gte:  $startBlock } { block_lt: $endBlock } { id_gt: $lastId }] }) {
        id
        effectiveUser {
          id
        }
        liquidityTokenBalance
        block
        timestamp
      }
    }
  `;

  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlWithdrawalsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const snapshots: ApiAmmLiquiditySnapshot[] = result.data.ammLiquidityPositionSnapshots.map(snapshot => {
    return {
      id: snapshot.id,
      effectiveUser: snapshot.effectiveUser.id,
      block: snapshot.block,
      timestamp: snapshot.timestamp,
      liquidityTokenBalance: snapshot.liquidityTokenBalance,
    }
  });

  return { snapshots };
}

export async function getTrades(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ trades: ApiTrade[] }> {
  const query = `
    query getTrades($startBlock: Int, $endBlock: Int, $lastId: ID) {
      trades(first: 1000, orderBy: id where: { and: [{ transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }} { id_gt: $lastId }]}) {
        id
        serialId
        transaction {
          timestamp
        }
        takerEffectiveUser {
          id
        }
        takerMarginAccount {
          user {
            id
          }
          accountNumber
        }
        takerToken {
          marketId
        }
        takerInputTokenDeltaPar
        takerOutputTokenDeltaPar
        makerEffectiveUser {
          id
        }
        makerMarginAccount {
          user {
            id
          }
          accountNumber
        }
        makerToken {
          marketId
        }
      }
    }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTradesResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const trades: ApiTrade[] = result.data.trades.map(trade => {
    return {
      id: trade.id,
      serialId: trade.serialId,
      timestamp: trade.transaction.timestamp,
      takerEffectiveUser: trade.takerEffectiveUser.id.toLowerCase(),
      takerMarginAccount: {
        user: trade.takerMarginAccount.user.id.toLowerCase(),
        accountNumber: trade.takerMarginAccount.accountNumber,
      },
      takerMarketId: trade.takerToken.marketId,
      takerInputTokenDeltaPar: trade.takerInputTokenDeltaPar,
      takerOutputTokenDeltaPar: trade.takerOutputTokenDeltaPar,
      makerEffectiveUser: trade.makerEffectiveUser ? trade.makerEffectiveUser.id.toLowerCase() : null,
      makerMarginAccount: trade.makerMarginAccount ? {
        user: trade.makerMarginAccount.user.id.toLowerCase(),
        accountNumber: trade.makerMarginAccount.accountNumber,
      } : null,
      makerMarketId: trade.makerToken.marketId,
    }
  });

  return { trades };
}

export async function getTransfers(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ transfers: ApiTransfer[] }> {
  const query = `
    query getTransfers($startBlock: Int, $endBlock: Int, $lastId: ID) {
      transfers(first: 1000, orderBy: id where: { and: [{ transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }} { id_gt: $lastId }]}) {
        id
        serialId
        transaction {
          timestamp
        }
        fromAmountDeltaPar
        toAmountDeltaPar
        fromEffectiveUser {
          id
        }
        toEffectiveUser {
          id
        }
        fromMarginAccount {
          user {
            id
          }
          accountNumber
        }
        toMarginAccount {
          user {
            id
          }
          accountNumber
        }
        token {
          marketId
        }
      }
    }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTransfersResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const transfers: ApiTransfer[] = result.data.transfers.map(transfer => {
    return {
      id: transfer.id,
      serialId: transfer.serialId,
      timestamp: transfer.transaction.timestamp,
      fromEffectiveUser: transfer.fromEffectiveUser.id.toLowerCase(),
      fromMarginAccount: {
        user: transfer.fromMarginAccount.user.id.toLowerCase(),
        accountNumber: transfer.fromMarginAccount.accountNumber,
      },
      toEffectiveUser: transfer.toEffectiveUser.id.toLowerCase(),
      toMarginAccount: {
        user: transfer.toMarginAccount.user.id.toLowerCase(),
        accountNumber: transfer.toMarginAccount.accountNumber,
      },
      marketId: new BigNumber(transfer.token.marketId),
      fromAmountDeltaPar: new BigNumber(transfer.fromAmountDeltaPar),
      toAmountDeltaPar: new BigNumber(transfer.toAmountDeltaPar),
    }
  });

  return { transfers };
}

export async function getVestingPositionTransfers(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ vestingPositionTransfers: ApiVestingPositionTransfer[] }> {
  const query = `
    query getLiquidityMiningVestingPositionTransfers($startBlock: Int, $endBlock: Int, $lastId: ID) {
      vestingPositionTransfers(first: 1000, orderBy: id where: { and: [{ transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }} { id_gt: $lastId }]}) {
        id
        serialId
        transaction {
          timestamp
        }
        fromUser {
          id
        }
        toUser {
          id
        }
        vestingPosition {
          arbAmountPar
        }
      }
    }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlVestingPositionTransfersResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const vestingPositionTransfers: ApiVestingPositionTransfer[] = result.data.vestingPositionTransfers.map(
    vestingPositionTransfer => {
      return {
        id: vestingPositionTransfer.id,
        serialId: vestingPositionTransfer.serialId,
        timestamp: vestingPositionTransfer.transaction.timestamp,
        fromEffectiveUser: vestingPositionTransfer.fromUser.id.toLowerCase(),
        toEffectiveUser: vestingPositionTransfer.toUser.id.toLowerCase(),
        amount: vestingPositionTransfer.arbAmountPar,
      }
    },
  );

  return { vestingPositionTransfers };
}

export async function getWithdrawals(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ withdrawals: ApiWithdrawal[] }> {
  const query = `
    query getWithdrawals($startBlock: Int, $endBlock: Int, $lastId: ID) {
    withdrawals(first: 1000, orderBy: id where: { and: [{ transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }} { id_gt: $lastId }]}) {
        id
        serialId
        transaction {
          timestamp
        }
        amountDeltaPar
        token {
          marketId
        }
        marginAccount {
          user {
            id
          }
          accountNumber
        }
        effectiveUser {
          id
        }
      }
    }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlWithdrawalsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const withdrawals: ApiWithdrawal[] = result.data.withdrawals.map(withdrawal => {
    return {
      id: withdrawal.id,
      serialId: withdrawal.serialId,
      timestamp: withdrawal.transaction.timestamp,
      effectiveUser: withdrawal.effectiveUser.id.toLowerCase(),
      marginAccount: {
        user: withdrawal.marginAccount.user.id.toLowerCase(),
        accountNumber: withdrawal.marginAccount.accountNumber,
      },
      marketId: new BigNumber(withdrawal.token.marketId),
      amountDeltaPar: new BigNumber(withdrawal.amountDeltaPar),
    }
  });

  return { withdrawals };
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
