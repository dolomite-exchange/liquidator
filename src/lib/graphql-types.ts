import { ApiAsyncDepositStatus, ApiAsyncWithdrawalStatus } from '@dolomite-exchange/zap-sdk';

export interface GraphqlToken {
  id: string;
  marketId: string;
  symbol: string;
  name: string;
  decimals: string;
}

export interface GraphqlAsyncDeposit {
  id: string;
  key: string;
  marginAccount: {
    user: {
      id: string
    }
    accountNumber: string;
  }
  inputToken: GraphqlToken
  inputAmount: string;
  outputToken: GraphqlToken
  minOutputAmount: string
  status: ApiAsyncDepositStatus
  isRetryable: boolean
}

export interface GraphqlAsyncWithdrawal {
  id: string;
  key: string;
  marginAccount: {
    user: {
      id: string
    }
    accountNumber: string;
  }
  inputToken: GraphqlToken
  inputAmount: string;
  outputToken: GraphqlToken
  outputAmount: string
  status: ApiAsyncWithdrawalStatus
  isRetryable: boolean
}

export interface GraphqlAsyncDepositResult {
  data: {
    asyncDeposits: GraphqlAsyncDeposit[]
  }
}

export interface GraphqlAsyncWithdrawalResult {
  data: {
    asyncWithdrawals: GraphqlAsyncWithdrawal[]
  }
}

export interface GraphqlAccountResult {
  data: {
    marginAccounts: GraphqlAccount[]
  }
}

export interface GraphqlTokenValue {
  token: GraphqlToken
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
  amountDeltaPar: string
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

export interface GraphqlMarketResult {
  data: {
    marketRiskInfos: GraphqlMarket[]
  }
  errors: any
}

export interface GraphqlMarket {
  id: string
  token: GraphqlToken
  marginPremium: string
  liquidationRewardPremium: string
  isBorrowingDisabled: boolean
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

export interface GraphqlLiquidationsResult {
  data: {
    liquidations: GraphqlLiquidations[]
  }
  errors: any
}

export interface GraphqlLiquidations {
  heldTokenAmountUSD: string
  borrowedTokenAmountUSD: string
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
  token: {
    id: string
    marketId: string
    symbol: string
    decimals: string
    supplyLiquidity: string
    borrowLiquidity: string
  }
  borrowInterestRate: string
  supplyInterestRate: string
}

export interface GraphqlInterestIndex {
  token: {
    id: string
  }
  supplyIndex: string;
  borrowIndex: string;
}

export interface GraphqlOraclePrice {
  token: {
    id: string
  }
  price: string;
}

type GraphqlAmmDataForUserResultSubResult =
  GraphqlAmmPairData
  | GraphqlInterestRate
  | GraphqlAmmLiquidityPosition
  | GraphqlInterestIndex
  | GraphqlOraclePrice
  | GraphqlTokenValue

export interface GraphqlAmmDataForUserResult {
  data: Record<string, GraphqlAmmDataForUserResultSubResult[]>
}
