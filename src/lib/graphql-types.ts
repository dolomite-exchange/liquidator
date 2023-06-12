export interface GraphqlAccountResult {
  data: {
    marginAccounts: GraphqlAccount[]
  }
}

export interface GraphqlTokenValue {
  token: {
    id: string
    marketId: string
    name: string
    symbol: string
    decimals: string
  }
  valuePar: string
  expirationTimestamp: string | null
  expiryAddress: string | null
}

export interface GraphqlAccount {
  id: string
  user: {
    id: string
  }
  accountNumber: string
  tokenValues: GraphqlTokenValue[]
}

export interface GraphqlMarketResult {
  data: {
    marketRiskInfos: GraphqlMarket[]
  }
  errors: any
}

export interface GraphqlToken {
  id: string
  decimals: string
  marketId: string
  name: string
  symbol: string
}

export interface GraphqlMarket {
  id: string
  token: GraphqlToken
  marginPremium: string
  liquidationRewardPremium: string
}

export interface GraphqlRiskParamsResult {
  data: {
    dolomiteMargins: GraphqlRiskParams[]
  }
}

export interface GraphqlRiskParams {
  id: string
  liquidationRatio: string
  liquidationReward: string
}

interface GraphqlBlockResult {
  number: string
}

export interface GraphqlTimestampToBlockResult {
  data: Record<string, GraphqlBlockResult[]>
}

export interface GraphqlAmmPairData {
  volumeUSD: string
  reserveUSD: string
  reserve0: string
  reserve1: string
  totalSupply: string
}

export interface GraphqlInterestRate {
  supplyInterestRate: string
}

export interface GraphqlAmmLiquidityPosition {
  liquidityTokenBalance: string
}

type GraphqlAmmDataForUserResultSubResult = GraphqlAmmPairData | GraphqlInterestRate | GraphqlAmmLiquidityPosition

export interface GraphqlAmmDataForUserResult {
  data: Record<string, GraphqlAmmDataForUserResultSubResult[]>
}
