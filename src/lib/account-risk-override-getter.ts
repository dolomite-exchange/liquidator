import { Decimal } from '@dolomite-exchange/dolomite-margin';
import { ApiAccount, ApiRiskParam, EModeCategory, EModeCategoryStruct, EModeRiskFeature } from './api-types';

export interface RiskOverride {
  marginRatioOverride: Decimal;
  liquidationRewardOverride: Decimal;
}

export function getAccountRiskOverride(
  account: ApiAccount,
  riskInfo: ApiRiskParam,
): RiskOverride | undefined {
  const riskFeatureOverride = getRiskFeatureOverride(account, riskInfo);
  if (riskFeatureOverride) {
    return riskFeatureOverride;
  }

  return getRiskCategoryOverride(account, riskInfo);
}

function getRiskFeatureOverride(account: ApiAccount, riskInfo: ApiRiskParam): RiskOverride | undefined {
  const balances = Object.values(account.balances);
  for (const balance of balances) {
    const riskFeature = riskInfo.riskOverrideSettings.marketIdToRiskFeatureMap[balance.marketId];
    if (riskFeature?.feature === EModeRiskFeature.SINGLE_COLLATERAL_WITH_STRICT_DEBT) {
      const { params } = riskFeature;
      for (const param of params) {
        for (const debtMarketId of param.debtMarketIds) {
          if (balances.some(b => b.marketId === debtMarketId.toNumber())) {
            return param;
          }
        }
      }
    }
  }

  return undefined;
}

function getRiskCategoryOverride(account: ApiAccount, riskInfo: ApiRiskParam): RiskOverride | undefined {
  let exclusiveCategory: EModeCategoryStruct | undefined;
  const balances = Object.values(account.balances);
  for (const balance of balances) {
    const param = riskInfo.riskOverrideSettings.marketIdToCategoryMap[balance.marketId];
    if (!param || param.category === EModeCategory.NONE) {
      return undefined;
    }

    if (!exclusiveCategory) {
      exclusiveCategory = param;
    } else if (exclusiveCategory.category !== param.category) {
      return undefined;
    }
  }

  return exclusiveCategory;
}
