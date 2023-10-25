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
    id
    effectiveUser: {
      id: string
    }
  }
  accountNumber: string
  tokenValues: GraphqlTokenValue[]
}

export interface GraphqlDeposit {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  amountDeltaWei: string
  effectiveUser: {
    id: string
  }
  token: {
    marketId: string
  }
}

export interface GraphqlDepositsResult {
  data: {
    deposits: GraphqlDeposit[]
  }
}

export interface GraphqlAmmLiquidityPosition {
  id: string
  effectiveUser: {
    id: string
  }
  liquidityTokenBalance: string
}

export interface GraphqlAmmLiquidityPositionsResult {
  data: {
    ammLiquidityPositions: GraphqlAmmLiquidityPosition[]
  }
}

export interface GraphqlAmmLiquidityPositionSnapshot {
  id: string
  effectiveUser: {
    id: string
  }
  liquidityTokenBalance: string
  block: string
  timestamp: string
}

export interface GraphqlAmmLiquidityPositionSnapshotsResult {
  data: {
    ammLiquidityPositionSnapshots: GraphqlAmmLiquidityPositionSnapshot[]
  }
}

export interface GraphqlLiquidation {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  solidEffectiveUser: {
    id: string
  }
  liquidEffectiveUser: {
    id: string
  }
  heldToken: {
    marketId: string
  }
  heldTokenAmountDeltaWei
  heldTokenLiquidationRewardWei
  borrowedToken: {
    marketId: string
  }
  borrowedTokenAmountDeltaWei
}

export interface GraphqlLiquidationsResult {
  data: {
    liquidations: GraphqlLiquidation[]
  }
}

export interface GraphqlTransfer {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  amountDeltaWei: string
  fromEffectiveUser: {
    id: string
  }
  toEffectiveUser: {
    id: string
  }
  token: {
    marketId: string
  }
}

export interface GraphqlTrade {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  takerEffectiveUser: {
    id: string
  }
  takerToken: {
    marketId: string
  }
  takerTokenDeltaWei: string;
  makerEffectiveUser: {
    id: string
  }
  makerToken: {
    marketId: string
  }
  makerTokenDeltaWei: string;
}

export interface GraphqlTradesResult {
  data: {
    trades: GraphqlTrade[]
  }
}

export interface GraphqlTransfersResult {
  data: {
    transfers: GraphqlTransfer[]
  }
}

export interface GraphqlWithdrawal {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  amountDeltaWei: string
  effectiveUser: {
    id: string
  }
  token: {
    marketId: string
  }
}

export interface GraphqlWithdrawalsResult {
  data: {
    withdrawals: GraphqlWithdrawal[]
  }
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
