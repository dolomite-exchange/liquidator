import { address, Integer, Networks } from '@dolomite-exchange/dolomite-margin';
import { GraphqlToken } from './graphql-types';

export const NETWORK_ID = Number(process.env.NETWORK_ID);

const GLP_MARKET_ID_MAP: Record<number, number | undefined> = {
  [Networks.ARBITRUM_ONE]: 6,
  [Networks.ARBITRUM_GOERLI]: undefined,
};

const MAGIC_GLP_MARKET_ID_MAP: Record<number, number | undefined> = {
  [Networks.ARBITRUM_ONE]: 8,
  [Networks.ARBITRUM_GOERLI]: undefined,
};

const PLV_GLP_MARKET_ID_MAP: Record<number, number | undefined> = {
  [Networks.ARBITRUM_ONE]: 9,
  [Networks.ARBITRUM_GOERLI]: undefined,
};

const ATLAS_PTSI_MARKET_ID_MAP: Record<number, number | undefined> = {
  [Networks.ARBITRUM_ONE]: 9,
  [Networks.ARBITRUM_GOERLI]: undefined,
};

const USDC_MARKET_ID_MAP: Record<number, number> = {
  [Networks.ARBITRUM_ONE]: 2,
  [Networks.ARBITRUM_GOERLI]: 2,
};

interface Converter {
  unwrapper: address;
  wrapper: address;
  unwrapperMarketId: number;
  wrapperMarketId: number;
}

const ISOLATION_MODE_CONVERSION_MARKET_ID_MAP: Record<number, Record<number, Converter>> = {
  [Networks.ARBITRUM_ONE]: {
    [GLP_MARKET_ID_MAP[Networks.ARBITRUM_ONE]!]: {
      unwrapper: '0xe2E26241E8572912d0fA3c213b935D10a4Fe2268',
      wrapper: '0xFa60E0fC3da354d68F9d3ec5AC638d36bbB13bFe',
      unwrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_ONE],
      wrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_ONE],
    },
    [PLV_GLP_MARKET_ID_MAP[Networks.ARBITRUM_ONE]!]: {
      unwrapper: '0xB5010ba20fD127aF143cCFd9d77fd4c6923f6d37',
      wrapper: '0xc2fA9F48b166BCa8706Ab53A60dcA28979010b92',
      unwrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_ONE],
      wrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_ONE],
    },
  },
  [Networks.ARBITRUM_GOERLI]: {
    [ATLAS_PTSI_MARKET_ID_MAP[Networks.ARBITRUM_GOERLI]!]: {
      unwrapper: '',
      wrapper: '',
      unwrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_GOERLI],
      wrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_GOERLI],
    },
  },
};

const LIQUIDITY_TOKEN_CONVERSION_MARKET_ID_MAP: Record<number, Record<number, Converter>> = {
  [Networks.ARBITRUM_ONE]: {
    [MAGIC_GLP_MARKET_ID_MAP[Networks.ARBITRUM_ONE]!]: {
      unwrapper: '0x9e8d909C340A7Af5d6623C6d7C7ACA436Eae345D',
      wrapper: '0x36Ab95Afa0648598C3C5329b2c26B5179Ebb14a1',
      unwrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_ONE],
      wrapperMarketId: USDC_MARKET_ID_MAP[Networks.ARBITRUM_ONE],
    },
  },
};

// ==================== Isolation Mode Getters ====================

export function isIsolationModeToken(token: GraphqlToken): boolean {
  return token.name.includes('Dolomite Isolation:') || token.symbol === 'dfsGLP';
}

export function getIsolationModeUnwrapperMarketIdByMarketId(isolationModeMarketId: Integer): number {
  return ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[NETWORK_ID][isolationModeMarketId.toFixed()].unwrapperMarketId;
}

export function getIsolationModeWrapperMarketIdByMarketId(isolationModeMarketId: Integer): number {
  return ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[NETWORK_ID][isolationModeMarketId.toFixed()].wrapperMarketId;
}

export function getIsolationModeUnwrapperByMarketId(isolationModeMarketId: Integer): string {
  return ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[NETWORK_ID][isolationModeMarketId.toFixed()].unwrapper;
}

export function getIsolationModeWrapperByMarketId(isolationModeMarketId: Integer): string {
  return ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[NETWORK_ID][isolationModeMarketId.toFixed()].wrapper;
}

// ==================== Liquidity Token Getters ====================

export function isLiquidityToken(token: GraphqlToken): boolean {
  return LIQUIDITY_TOKEN_CONVERSION_MARKET_ID_MAP[NETWORK_ID][token.marketId] !== undefined;
}

export function getLiquidityTokenUnwrapperMarketIdByMarketId(liquidityTokenMarketId: Integer): number {
  return LIQUIDITY_TOKEN_CONVERSION_MARKET_ID_MAP[NETWORK_ID][liquidityTokenMarketId.toFixed()].unwrapperMarketId;
}

export function getLiquidityTokenWrapperMarketIdByMarketId(liquidityTokenMarketId: Integer): number {
  return LIQUIDITY_TOKEN_CONVERSION_MARKET_ID_MAP[NETWORK_ID][liquidityTokenMarketId.toFixed()].wrapperMarketId;
}

export function getLiquidityTokenUnwrapperByMarketId(liquidityTokenMarketId: Integer): string {
  return LIQUIDITY_TOKEN_CONVERSION_MARKET_ID_MAP[NETWORK_ID][liquidityTokenMarketId.toFixed()].unwrapper;
}

export function getLiquidityTokenWrapperByMarketId(liquidityTokenMarketId: Integer): string {
  return LIQUIDITY_TOKEN_CONVERSION_MARKET_ID_MAP[NETWORK_ID][liquidityTokenMarketId.toFixed()].wrapper;
}
