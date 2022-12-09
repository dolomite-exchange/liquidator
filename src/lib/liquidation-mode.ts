export enum LiquidationMode {
  Simple = 'Simple',
  SellWithInternalLiquidity = 'SellWithInternalLiquidity',
  SellWithExternalLiquidity = 'SellWithExternalLiquidity',
}

export const LIQUIDATION_MODE = LiquidationMode[process.env.LIQUIDATION_MODE as keyof typeof LiquidationMode];
