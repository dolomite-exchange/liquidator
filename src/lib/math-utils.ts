import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { ApiMarket, ApiRiskParam } from './api-types';

const BASE = new BigNumber(10).pow(18);

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

export function getOwedPriceForLiquidation(
  owedMarket: ApiMarket,
  heldMarket: ApiMarket,
  riskParams: ApiRiskParam,
): Integer {
  let reward = riskParams.liquidationReward.minus(BASE);
  reward = reward.plus(getPartial(reward, heldMarket.liquidationRewardPremium, BASE));
  reward = reward.plus(getPartial(reward, owedMarket.liquidationRewardPremium, BASE));
  return owedMarket.oraclePrice.plus(getPartial(owedMarket.oraclePrice, reward, BASE));
}

export function getAmountsForLiquidation(
  owedWei: Integer,
  owedPriceAdj: Integer,
  maxHeldWei: Integer,
  heldPrice: Integer,
): { owedWei: Integer, heldWei: Integer } {
  if (owedWei.times(owedPriceAdj).gt(maxHeldWei.times(heldPrice))) {
    return { owedWei: heldWeiToOwedWei(maxHeldWei, heldPrice, owedPriceAdj), heldWei: maxHeldWei };
  } else {
    return { owedWei, heldWei: owedWeiToHeldWei(owedWei, owedPriceAdj, heldPrice) };
  }
}
