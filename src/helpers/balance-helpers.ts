import { DateTime } from 'luxon';
import { ApiBalance, ApiMarket } from '../lib/api-types';

import { isExpired } from './time-helpers';

export function _getLargestBalanceUSD(
  balances: ApiBalance[],
  isOwed: boolean,
  marketMap: { [marketId: string]: ApiMarket },
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
    .sort((a, b) => _balanceUSDSorterDesc(a, b, marketMap))[0]
}

function _balanceUSDSorterDesc(
  balance1: ApiBalance,
  balance2: ApiBalance,
  marketMap: { [marketId: string]: ApiMarket },
): number {
  const market1 = marketMap[balance1.marketId];
  const market2 = marketMap[balance2.marketId];
  const balanceUSD1 = balance1.wei.abs().times(market1.oraclePrice);
  const balanceUSD2 = balance2.wei.abs().times(market2.oraclePrice);
  return balanceUSD1.gt(balanceUSD2) ? -1 : 1;
}
