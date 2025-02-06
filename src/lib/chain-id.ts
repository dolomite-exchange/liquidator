export enum ChainId {
  ArbitrumOne = 42161,
  Base = 8453,
  Berachain = 80094,
  Mantle = 5000,
  PolygonZkEvm = 1101,
  XLayer = 196,
}

export function isArbitrum(chainId: ChainId): boolean {
  return chainId === ChainId.ArbitrumOne;
}

export function isBase(chainId: ChainId): boolean {
  return chainId === ChainId.Base;
}

export function isBerachain(chainId: ChainId): boolean {
  return chainId === ChainId.Berachain;
}

export function isMantle(chainId: ChainId): boolean {
  return chainId === ChainId.Mantle;
}

export function isPolygon(chainId: ChainId): boolean {
  return chainId === ChainId.PolygonZkEvm;
}

export function isXLayer(chainId: ChainId): boolean {
  return chainId === ChainId.XLayer;
}
