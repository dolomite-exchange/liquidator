import { BigNumber, Decimal, Integer } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { getAccountRiskOverride, RiskOverride } from './account-risk-override-getter';
import { ApiAccount, ApiMarket, ApiRiskParam } from './api-types';

export const DECIMAL_BASE = new BigNumber(10).pow(18);

export function isCollateralized(
  account: ApiAccount,
  marketMap: { [marketId: string]: ApiMarket },
  riskParams: ApiRiskParam,
): { isCollateralized: boolean, partialLiquidation: boolean } {
  const riskOverride = getAccountRiskOverride(account, riskParams);
  const initial = {
    borrow: INTEGERS.ZERO,
    supply: INTEGERS.ZERO,
  };
  const {
    borrow,
    supply,
  } = Object.values(account.balances)
    .reduce((memo, balance) => {
      const market = marketMap[balance.marketId.toString()];
      const value = balance.wei.times(market.oraclePrice);
      const adjust = DECIMAL_BASE.plus(riskOverride ? INTEGERS.ZERO : market.marginPremium);
      if (balance.wei.lt(INTEGERS.ZERO)) {
        // increase the borrow size by the premium
        memo.borrow = memo.borrow.plus(value.abs()
          .times(adjust)
          .div(DECIMAL_BASE)
          .integerValue(BigNumber.ROUND_FLOOR));
      } else {
        // decrease the supply size by the premium
        memo.supply = memo.supply.plus(value.times(DECIMAL_BASE)
          .div(adjust)
          .integerValue(BigNumber.ROUND_FLOOR));
      }
      return memo;
    }, initial);

  const liquidationRatio = riskOverride ? riskOverride.marginRatioOverride : riskParams.liquidationRatio;
  const partialLiquidationThreshold = DECIMAL_BASE.times(0.95); // 95%
  const healthScore = supply.times(DECIMAL_BASE).div(borrow).times(DECIMAL_BASE).div(liquidationRatio)
  return {
    isCollateralized: supply.gte(borrow.times(liquidationRatio).dividedToIntegerBy(DECIMAL_BASE)),
    partialLiquidation: healthScore.gte(partialLiquidationThreshold),
  };
}

export function getPartial(amount: Integer, numerator: Integer, denominator: Integer): Integer {
  return amount.times(numerator).dividedToIntegerBy(denominator);
}

export function getPartialRoundUp(target: Integer, numerator: Integer, denominator: Integer): Integer {
  return target.times(numerator).minus(1).dividedToIntegerBy(denominator).plus(1);
}

export function getPartialRoundHalfUp(target: Integer, numerator: Integer, denominator: Integer): Integer {
  return target.times(numerator).plus(denominator.dividedToIntegerBy(2)).dividedToIntegerBy(denominator);
}

export function owedWeiToHeldWei(
  owedWei: Integer,
  owedPrice: Integer,
  heldPrice: Integer,
): Integer {
  return getPartial(owedWei, owedPrice, heldPrice);
}

export function heldWeiToOwedWei(
  heldWei: Integer,
  heldPrice: Integer,
  owedPrice: Integer,
): Integer {
  return getPartialRoundUp(heldWei, heldPrice, owedPrice);
}

export function getLiquidationReward(
  owedMarket: ApiMarket,
  heldMarket: ApiMarket,
  riskOverride: RiskOverride | undefined,
  riskParams: ApiRiskParam,
): Decimal {
  if (riskOverride) {
    return riskOverride.liquidationRewardOverride.minus(DECIMAL_BASE).div(DECIMAL_BASE);
  }

  let reward = riskParams.liquidationReward.minus(DECIMAL_BASE);

  const heldRewardPremium = heldMarket.liquidationRewardPremium;
  reward = reward.plus(getPartial(reward, heldRewardPremium, DECIMAL_BASE));

  const owedRewardPremium = owedMarket.liquidationRewardPremium;
  reward = reward.plus(getPartial(reward, owedRewardPremium, DECIMAL_BASE));

  return reward.div(DECIMAL_BASE);
}

export function getOwedPriceForLiquidation(
  owedMarket: ApiMarket,
  heldMarket: ApiMarket,
  riskOverride: RiskOverride | undefined,
  riskParams: ApiRiskParam,
): Integer {
  if (riskOverride) {
    const reward = riskOverride.liquidationRewardOverride;
    return getPartial(owedMarket.oraclePrice, reward, DECIMAL_BASE)
  }

  let reward = riskParams.liquidationReward.minus(DECIMAL_BASE);

  const heldRewardPremium = heldMarket.liquidationRewardPremium;
  reward = reward.plus(getPartial(reward, heldRewardPremium, DECIMAL_BASE));

  const owedRewardPremium = owedMarket.liquidationRewardPremium;
  reward = reward.plus(getPartial(reward, owedRewardPremium, DECIMAL_BASE));
  return owedMarket.oraclePrice.plus(getPartial(owedMarket.oraclePrice, reward, DECIMAL_BASE));
}

export function getAmountsForLiquidation(
  owedWei: Integer,
  owedPrice: Integer,
  owedPriceAdj: Integer,
  heldWei: Integer,
  heldPrice: Integer,
  heldProtocolBalance: Integer,
  dolomiteFeeRake: Decimal,
  isIsolationMode: boolean,
): { owedWei: Integer, heldWei: Integer, isVaporizable: boolean } {
  if (isIsolationMode) {
    dolomiteFeeRake = INTEGERS.ZERO;
  }

  const maxHeldWei = heldProtocolBalance.lt(heldWei) ? heldProtocolBalance : heldWei;
  if (owedWei.times(owedPriceAdj).gt(maxHeldWei.times(heldPrice))) {
    const owedWeiAdj = heldWeiToOwedWei(maxHeldWei, heldPrice, owedPriceAdj);
    const heldWeiWithoutReward = owedWeiToHeldWei(owedWeiAdj, owedPrice, heldPrice);
    const reward = maxHeldWei.minus(heldWeiWithoutReward);
    return {
      owedWei: owedWeiAdj,
      heldWei: maxHeldWei.minus(reward.times(dolomiteFeeRake).integerValue()),
      isVaporizable: true,
    };
  } else {
    const heldWeiWithReward = owedWeiToHeldWei(owedWei, owedPriceAdj, heldPrice);
    const reward = heldWeiWithReward.minus(owedWeiToHeldWei(owedWei, owedPrice, heldPrice))
    return {
      owedWei,
      heldWei: heldWeiWithReward.minus(reward.times(dolomiteFeeRake).integerValue()),
      isVaporizable: false,
    };
  }
}

export function chunkArray<T>(inputArray: T[], chunkSize: number): T[][] {
  const arrayLength = inputArray.length;
  const chunks: T[][] = [];

  for (let index = 0; index < arrayLength; index += chunkSize) {
    const chunk = inputArray.slice(index, index + chunkSize);
    chunks.push(chunk);
  }

  return chunks;
}
