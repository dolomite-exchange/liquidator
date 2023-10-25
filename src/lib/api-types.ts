import { address, Integer } from '@dolomite-exchange/dolomite-margin';

export interface ApiBalance {
  marketId: number;
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
  balances: {
    [marketNumber: string]: ApiBalance;
  };
}

export interface ApiDeposit {
  id: string;
  serialId: number;
  timestamp: number;
  effectiveUser: string;
  marketId: number;
  amountDeltaWei: Integer;
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
  heldToken: number;
  heldTokenAmountDeltaWei: Integer;
  heldTokenLiquidationRewardWei: Integer;
  borrowedToken: number;
  borrowedTokenAmountDeltaWei: Integer;
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
  marketId: number;
  amountDeltaWei: Integer;
}

export interface ApiTrade {
  id: string;
  serialId: number;
  timestamp: number;
  takerEffectiveUser: string;
  takerMarketId: number;
  takerTokenDeltaWei: Integer;
  makerEffectiveUser: string;
  makerMarketId: number;
  makerTokenDeltaWei: Integer;
}

export interface ApiWithdrawal {
  id: string;
  serialId: number;
  timestamp: number;
  effectiveUser: string;
  marketId: number;
  amountDeltaWei: Integer;
}

export interface MarketIndex {
  marketId: number
  borrow: Integer
  supply: Integer
}
