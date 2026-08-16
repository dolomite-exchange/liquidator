export enum ChainId {
  ArbitrumOne = 42161,
  Base = 8453,
  Berachain = 80094,
  Bsc = 56,
  Ethereum = 1,
  Ink = 57073,
  Mantle = 5000,
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

export function isBsc(chainId: ChainId): boolean {
  return chainId === ChainId.Bsc;
}

export function isEthereum(chainId: ChainId): boolean {
  return chainId === ChainId.Ethereum;
}

export function isInk(chainId: ChainId): boolean {
  return chainId === ChainId.Ink;
}

export function isMantle(chainId: ChainId): boolean {
  return chainId === ChainId.Mantle;
}

export function isXLayer(chainId: ChainId): boolean {
  return chainId === ChainId.XLayer;
}
