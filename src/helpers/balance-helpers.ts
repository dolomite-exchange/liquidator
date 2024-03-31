import { Integer } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { DateTime } from 'luxon';
import { ApiBalance, ApiMarket } from '../lib/api-types';

import { isExpired } from './time-helpers';

export function getLargestBalanceUSD(
  balances: ApiBalance[],
  isOwed: boolean,
  marketMap: { [marketId: string]: ApiMarket },
  balanceMap: { [marketId: string]: Integer },
  lastBlockTimestamp: DateTime,
  isExpiring: boolean,
): ApiBalance {
  return balances
    .filter(balance => {
      if (isOwed) {
        if (isExpiring) {
          // Return any market that has expired and is borrowed (negative)
          return isExpired(balance.expiresAt, lastBlockTimestamp) && balance.wei.lt('0');
        } else {
          return balance.wei.lt('0');
        }
      } else {
        return balance.wei.gte('0');
      }
    })
    .sort((a, b) => _balanceUSDSorterDesc(a, b, marketMap, balanceMap))[0]
}

function _balanceUSDSorterDesc(
  balance1: ApiBalance,
  balance2: ApiBalance,
  marketMap: { [marketId: string]: ApiMarket },
  balanceMap: { [marketId: string]: Integer },
): number {
  const market1 = marketMap[balance1.marketId];
  const market2 = marketMap[balance2.marketId];
  const balanceUSD1 = _getEffectiveBalance(balance1, balanceMap).times(market1.oraclePrice);
  const balanceUSD2 = _getEffectiveBalance(balance2, balanceMap).times(market2.oraclePrice);
  return balanceUSD1.gt(balanceUSD2) ? -1 : 1;
}

function _getEffectiveBalance(balance: ApiBalance, balanceMap: { [marketId: string]: Integer }): Integer {
  const userBalance = balance.wei.abs();
  if (balance.wei.isNegative()) {
    // We don't need to worry about ERC20 liquidity if the user's balance is owed
    return userBalance;
  }

  const protocolBalance = balanceMap[balance.marketId] ?? INTEGERS.MAX_UINT
  if (userBalance.lt(protocolBalance)) {
    return userBalance
  } else {
    return protocolBalance;
  }
}
