import '../lib/env';
import { checkConditionally, checkMarketIdList } from '../lib/invariants';

checkConditionally(!!process.env.IGNORED_MARKETS, () => checkMarketIdList('IGNORED_MARKETS', 0));

const ignoredMarketIds: Record<string, true | undefined> = (process.env.IGNORED_MARKETS ?? '').split(',')
  .reduce((memo, market) => {
    memo[market] = true;
    return memo;
  }, {} as Record<string, true | undefined>);

export function isMarketIgnored(marketId: number): boolean {
  return ignoredMarketIds[marketId] === true;
}
