export enum ChainId {
  Ethereum = 1,
  PolygonMatic = 137,
  PolygonMumbai = 80001,
  ArbitrumOne = 42161,
  ArbitrumRinkeby = 421611,
  ArbitrumGoerli = 421613,
}

export function isArbitrum(chainId: ChainId): boolean {
  return chainId === ChainId.ArbitrumOne || chainId === ChainId.ArbitrumRinkeby || chainId === ChainId.ArbitrumGoerli
}

export function isPolygon(chainId: ChainId): boolean {
  return chainId === ChainId.PolygonMatic || chainId === ChainId.PolygonMumbai
}
