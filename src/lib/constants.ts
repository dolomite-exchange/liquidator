import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { GraphqlToken } from './graphql-types';

export const NETWORK_ID = Number(process.env.NETWORK_ID);

export const TEN_BI = new BigNumber(10);

export const ONE_ETH_WEI = TEN_BI.pow(18);

export const ACCOUNT_RISK_OVERRIDE_SETTER_ADDRESS = '0x7BCaF5253C417c84bBD1b7DfE4Ca4F0A4c4cA435';

// ==================== Isolation Mode Getters ====================

export function isIsolationModeToken(token: GraphqlToken): boolean {
  return token.name.includes('Dolomite Isolation:') || token.symbol === 'dfsGLP';
}
