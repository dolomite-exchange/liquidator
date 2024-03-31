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

export interface ApiMarket {
  marketId: number;
  symbol: string;
  name: string;
  tokenAddress: address;
  decimals: number;
  oraclePrice: Integer;
  marginPremium: Integer;
  liquidationRewardPremium: Integer;
  isBorrowingDisabled: boolean;
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
