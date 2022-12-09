import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { LiquidationMode } from './liquidation-mode';

export function checkDuration(key: string, minValue: number, isMillis: boolean = true) {
  if (Number.isNaN(Number(process.env[key])) || Number(process.env[key]) < minValue) {
    throw new Error(`${key} is invalid. Must be >= ${minValue} ${isMillis ? 'milliseconds' : 'seconds'}`);
  }
}

export function checkEthereumAddress(key: string) {
  if (!process.env[key] || !process.env[key]?.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error(`${key} is not provided or invalid`);
  }
}

export function checkPrivateKey(key: string) {
  if (!process.env[key] || !process.env[key]!.match(/^0x[a-fA-F0-9]{64}$/)) {
    throw new Error(`${key} is not provided or invalid`);
  }
}

export function checkBooleanValue(key: string) {
  if (process.env[key] !== 'true' && process.env[key] !== 'false') {
    throw new Error(`${key} is not provided or does not equal "true" or "false"`);
  }
}

export function checkPreferences(key: string) {
  if (!process.env[key]) {
    throw new Error(`${key} is not provided`);
  }
  const preferences = process.env[key]!.split(',');
  if (preferences.length === 0) {
    throw new Error(`${key} length is 0`);
  }
  preferences.forEach((preference, i) => {
    if (new BigNumber(preference.trim()).isNaN()) {
      throw new Error(`${key} at index=${i} is invalid`);
    }
  });
}

export function checkBigNumber(key: string) {
  if (!process.env[key] || new BigNumber(process.env[key]!).isNaN()) {
    throw new Error(`${key} is not provided or invalid`);
  }
}

export function checkJsNumber(key: string) {
  if (!process.env[key] || Number.isNaN(Number(process.env[key]))) {
    throw new Error(`${key} is not provided or invalid`);
  }
}

export function checkExists(key: string) {
  if (!process.env[key]) {
    throw new Error(`${key} is not provided`);
  }
}

export function checkLiquidationModeIsSet(enumKey: string = 'LIQUIDATION_MODE') {
  checkExists(enumKey);
  if (!Object.values(LiquidationMode).includes(process.env[enumKey]! as LiquidationMode)) {
    throw new Error(`${enumKey} is not provided or invalid`);
  }
}

export function checkLiquidationModeConditionally(value: LiquidationMode, checker: () => void) {
  const enumKey = 'LIQUIDATION_MODE';
  checkLiquidationModeIsSet(enumKey);
  if (process.env[enumKey] === value) {
    checker();
  }
}
