export enum LiquidationMode {
  Simple = 'Simple',
  SellWithInternalLiquidity = 'SellWithInternalLiquidity',
  SellWithExternalLiquidity = 'SellWithExternalLiquidity',
}

export function getLiquidationMode(): LiquidationMode {
  return LiquidationMode[process.env.LIQUIDATION_MODE as keyof typeof LiquidationMode];
}
