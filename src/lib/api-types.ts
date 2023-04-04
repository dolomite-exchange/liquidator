import {
  address,
  Integer,
} from '@dolomite-exchange/dolomite-margin';

export interface ApiBalance {
  marketId: number;
  tokenAddress: string
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

export interface ApiAccountFromNativeSubgraph {
  id: string;
  owner: {
    id: string
  };
  number: Integer;
  balances: {
    [marketNumber: string]: ApiBalance;
  };
}

export interface ApiMarket {
  id: number
  tokenAddress: address
  decimals: number
  oraclePrice: Integer
  marginPremium: Integer
  liquidationRewardPremium: Integer
  unwrapperInfo: ApiUnwrapperInfo | undefined
}

export interface ApiUnwrapperInfo {
  unwrapperAddress: address
  outputMarketId: number
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
