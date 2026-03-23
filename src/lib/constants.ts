import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import './env';

export const MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL = new BigNumber(process.env.MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL!);

export const MIN_VALUE_LIQUIDATED_FOR_SIMPLE = new BigNumber(process.env.MIN_VALUE_LIQUIDATED!);

export const GAS_SPIKE_THRESHOLD_USD = new BigNumber(process.env.GAS_SPIKE_THRESHOLD_USD as string);

export const NETWORK_ID = Number(process.env.NETWORK_ID);

export const TEN_BI = new BigNumber(10);

export const ONE_ETH_WEI = TEN_BI.pow(18);

export const GAS_ESTIMATION_MULTIPLIER = new BigNumber(1.25);

export const ACCOUNT_RISK_OVERRIDE_SETTER_ADDRESS = '0x7BCaF5253C417c84bBD1b7DfE4Ca4F0A4c4cA435';
