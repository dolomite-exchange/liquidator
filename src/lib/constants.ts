import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { GraphqlToken } from './graphql-types';

export const NETWORK_ID = Number(process.env.NETWORK_ID);

export const TEN_BI = new BigNumber(10);

export const ONE_ETH_WEI = TEN_BI.pow(18);

// ==================== Isolation Mode Getters ====================

export function isIsolationModeToken(token: GraphqlToken): boolean {
  return token.name.includes('Dolomite Isolation:') || token.symbol === 'dfsGLP';
}
