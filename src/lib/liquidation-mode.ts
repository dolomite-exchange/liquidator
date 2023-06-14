export enum LiquidationMode {
  Simple = 'Simple',
  SellWithInternalLiquidity = 'SellWithInternalLiquidity',
  SellWithExternalLiquidity = 'SellWithExternalLiquidity',
  Generic = 'Generic',
}

export function getLiquidationMode(): LiquidationMode {
  return LiquidationMode[process.env.LIQUIDATION_MODE as keyof typeof LiquidationMode];
}
