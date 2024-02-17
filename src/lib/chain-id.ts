export enum ChainId {
  PolygonZkEvm = 1101,
  Base = 8453,
  ArbitrumOne = 42161,
}

export function isArbitrum(chainId: ChainId): boolean {
  return chainId === ChainId.ArbitrumOne;
}

export function isBase(chainId: ChainId): boolean {
  return chainId === ChainId.Base;
}

export function isPolygon(chainId: ChainId): boolean {
  return chainId === ChainId.PolygonZkEvm;
}
