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
