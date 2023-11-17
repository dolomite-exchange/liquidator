import { address, Integer } from '@dolomite-exchange/dolomite-margin';

interface ApiMarginAccount {
  user: string;
  accountNumber: string;
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

export interface ApiDeposit {
  id: string;
  serialId: number;
  timestamp: number;
  effectiveUser: string;
  marginAccount: ApiMarginAccount;
  marketId: number;
  amountDeltaPar: Integer;
}

export interface ApiAmmLiquidityPosition {
  id: string;
  effectiveUser: string;
  balance: number;
}

export interface ApiAmmLiquiditySnapshot {
  id: string;
  effectiveUser: string;
  liquidityTokenBalance: string;
  block: string;
  timestamp: string;
}

export interface ApiLiquidation {
  id: string;
  serialId: number;
  timestamp: number;
  solidEffectiveUser: string;
  liquidEffectiveUser: string;
  solidMarginAccount: ApiMarginAccount;
  liquidMarginAccount: ApiMarginAccount;
  heldToken: number;
  borrowedToken: number;
  solidHeldTokenAmountDeltaPar: Integer;
  liquidHeldTokenAmountDeltaPar: Integer;
  solidBorrowedTokenAmountDeltaPar: Integer;
  liquidBorrowedTokenAmountDeltaPar: Integer;
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

export interface ApiTransfer {
  id: string;
  serialId: number;
  timestamp: number;
  fromEffectiveUser: string;
  toEffectiveUser: string;
  fromMarginAccount: ApiMarginAccount;
  toMarginAccount: ApiMarginAccount;
  marketId: number;
  fromAmountDeltaPar: Integer;
  toAmountDeltaPar: Integer;
}

export interface ApiTrade {
  id: string;
  serialId: number;
  timestamp: number;
  takerEffectiveUser: string;
  takerMarginAccount: ApiMarginAccount;
  takerMarketId: number;
  takerInputTokenDeltaPar: Integer;
  takerOutputTokenDeltaPar: Integer;
  makerEffectiveUser: string | undefined;
  makerMarginAccount: ApiMarginAccount | undefined;
  makerMarketId: number;
}

export interface ApiVestingPositionTransfer {
  id: string;
  serialId: number;
  timestamp: number;
  fromEffectiveUser: string;
  toEffectiveUser: string;
  amount: Integer;
}

export interface ApiLiquidityMiningVestingPosition {
  id: string;
  effectiveUser: string;
  amount: string;
}

export interface ApiWithdrawal {
  id: string;
  serialId: number;
  timestamp: number;
  effectiveUser: string;
  marginAccount: ApiMarginAccount;
  marketId: number;
  amountDeltaPar: Integer;
}

export interface MarketIndex {
  marketId: number
  borrow: Integer
  supply: Integer
}
