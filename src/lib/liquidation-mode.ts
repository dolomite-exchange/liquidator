export enum LiquidationMode {
  Simple = 'Simple',
  Generic = 'Generic',
}

export function getLiquidationMode(): LiquidationMode {
  return LiquidationMode[process.env.LIQUIDATION_MODE as keyof typeof LiquidationMode];
}
