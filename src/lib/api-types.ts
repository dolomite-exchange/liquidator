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
  /**
   * Can be negative for owed, positive for held
   */
  par: Integer;
  /**
   * Can be negative for owed, positive for held
   */
  wei: Integer;
  expiresAt: Integer | null;
  expiryAddress: string | null;
}

export interface ApiIsolationModeVaultAccount {
  id: string;
  vault: string;
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
  id: string;
  marketId: number;
  symbol: string;
  name: string;
  tokenAddress: address;
  decimals: number;
  oraclePrice: Integer;
  marginPremium: Integer;
  liquidationRewardPremium: Integer;
  isBorrowingDisabled: boolean;
  supplyLiquidity: Decimal | undefined;
  borrowLiquidity: Decimal | undefined;
  maxSupplyLiquidity: Decimal | undefined;
}

export interface ApiTokenResponse {
  id: string;
  marketId: string;
  supplyLiquidity: string;
  borrowLiquidity: string;
  riskInfo: {
    supplyMaxWei: string | null;
  };
}

export enum EModeCategory {
  NONE,
  BERA,
  BTC,
  ETH,
  STABLE
}

export const ALL_E_MODE_CATEGORIES = Object.values(EModeCategory).filter(
  (value): value is EModeCategory => typeof value === 'number' && value !== EModeCategory.NONE,
);

export enum EModeRiskFeature {
  NONE,
  BORROW_ONLY,
  SINGLE_COLLATERAL_WITH_STRICT_DEBT
}

export interface EModeCategoryStruct {
  category: EModeCategory;
  marginRatioOverride: Decimal;
  liquidationRewardOverride: Decimal;
}

export type EModeRiskFeatureStruct = BorrowOnlyStruct | SingleCollateralStruct

export interface BorrowOnlyStruct {
  feature: EModeRiskFeature.BORROW_ONLY;
}

export interface SingleCollateralParam {
  debtMarketIds: Integer[]
  marginRatioOverride: Decimal;
  liquidationRewardOverride: Decimal;
}

export interface SingleCollateralStruct {
  feature: EModeRiskFeature.SINGLE_COLLATERAL_WITH_STRICT_DEBT;
  params: SingleCollateralParam[];
}

export interface ApiRiskOverrideSettings {
  marketIdToCategoryMap: Record<number, EModeCategoryStruct | undefined>;
  marketIdToRiskFeatureMap: Record<number, EModeRiskFeatureStruct | undefined>;
}

export interface ApiRiskParam {
  dolomiteMargin: address;
  liquidationRatio: Integer;
  liquidationReward: Integer;
  numberOfMarkets: number;
  riskOverrideSettings: ApiRiskOverrideSettings;
}

export interface ApiLiquidation {
  owedAmountUSD: Decimal;
  heldAmountUSD: Decimal;
}

export interface MarketIndex {
  marketId: number
  borrow: Integer
  supply: Integer
}

export interface TotalValueLockedAndFees {
  totalSupplyLiquidity: Decimal[]
  totalBorrowLiquidity: Decimal[]
  borrowFees: Decimal[]
}
