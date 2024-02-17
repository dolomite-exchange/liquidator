import { address, BigNumber, Decimal, Integer } from '@dolomite-exchange/dolomite-margin';

export interface ApiToken {
  marketId: BigNumber;
  symbol: string;
  name: string;
  tokenAddress: string;
  decimals: number;
}

export interface ApiBalance {
  marketId: number;
  tokenDecimals: number;
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  par: Integer;
  wei: Integer;
  expiresAt: Integer | null;
  expiryAddress: string | null;
}

export interface ApiAccount {
  id: string;
  owner: string;
  number: Integer;
  effectiveUser: string;
  balances: {
    [marketNumber: string]: ApiBalance;
  };
}

export enum ApiAsyncDepositStatus {
  CREATED = 'CREATED',
  DEPOSIT_EXECUTED = 'DEPOSIT_EXECUTED',
  DEPOSIT_FAILED = 'DEPOSIT_FAILED',
  DEPOSIT_CANCELLED = 'DEPOSIT_CANCELLED',
  DEPOSIT_CANCELLED_FAILED = 'DEPOSIT_CANCELLED_FAILED',
}

export enum ApiAsyncActionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
}

export interface ApiAsyncAction<T> {
  id: string;
  actionType: ApiAsyncActionType;
  owner: string;
  accountNumber: BigNumber;
  status: T;
  inputToken: ApiToken;
  inputAmount: Decimal;
  outputToken: ApiToken;
}

export interface ApiAsyncDeposit extends ApiAsyncAction<ApiAsyncDepositStatus> {
  actionType: ApiAsyncActionType.DEPOSIT;
  minOutputAmount: Decimal;
}

export enum ApiAsyncWithdrawalStatus {
  CREATED = 'CREATED',
  WITHDRAWAL_EXECUTED = 'WITHDRAWAL_EXECUTED',
  WITHDRAWAL_EXECUTION_FAILED = 'WITHDRAWAL_EXECUTION_FAILED',
  WITHDRAWAL_CANCELLED = 'WITHDRAWAL_CANCELLED',
}

export interface ApiAsyncWithdrawal extends ApiAsyncAction<ApiAsyncWithdrawalStatus> {
  actionType: ApiAsyncActionType.WITHDRAWAL;
  outputAmount: Decimal;
}

export interface ApiMarket {
  marketId: number
  symbol: string
  name: string
  tokenAddress: address
  decimals: number
  oraclePrice: Integer
  marginPremium: Integer
  liquidationRewardPremium: Integer
}

export interface ApiRiskParam {
  dolomiteMargin: address;
  liquidationRatio: Integer;
  liquidationReward: Integer;
}

export interface MarketIndex {
  marketId: number
  borrow: Integer
  supply: Integer
}

export interface TotalValueLockedAndFees {
  totalValueLocked: Decimal[]
  borrowFees: Decimal[]
}
