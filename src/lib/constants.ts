import { GraphqlToken } from './graphql-types';

export const NETWORK_ID = Number(process.env.NETWORK_ID);

// ==================== Isolation Mode Getters ====================

export function isIsolationModeToken(token: GraphqlToken): boolean {
  return token.name.includes('Dolomite Isolation:') || token.symbol === 'dfsGLP';
}
