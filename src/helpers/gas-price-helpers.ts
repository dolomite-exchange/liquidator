import { BigNumber, Decimal, DolomiteMargin, Integer } from '@dolomite-exchange/dolomite-margin';
import axios from 'axios';
import { ethers } from 'ethers';
import {
  ChainId,
  isArbitrum,
  isBase,
  isBerachain,
  isBotanix,
  isBsc,
  isEthereum,
  isInk,
  isMantle,
} from '../lib/chain-id';
import logger from '../lib/logger';

export enum GasPriceType {
  STANDARD = 'STANDARD',
  EIP_1559 = 'EIP_1559',
}

export interface GasPriceStandard {
  type: GasPriceType.STANDARD;

  gasPriceWei: Integer;
  gasLimit: Integer;
}

export interface GasPriceEip1559 {
  type: GasPriceType.EIP_1559;

  baseFeeWei: Integer;
  priorityFeeWei: Integer;
  gasLimit: Integer;
}

export interface GasPriceForEthers {
  type: number
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export type GasPriceResult = GasPriceStandard | GasPriceEip1559;

const ONE_GWEI_IN_WEI_UNITS = new BigNumber('1000000000');
const MULTIPLIER = new BigNumber(process.env.GAS_PRICE_MULTIPLIER as string);
const ADDITION_WEI = new BigNumber(process.env.GAS_PRICE_ADDITION_WEI as string);
const STANDARD_BLOCK_GAS_LIMIT = new BigNumber(15_000_000);

let gasResult: GasPriceResult;
resetGasPriceWei()

export function resetGasPriceWei(): GasPriceResult {
  gasResult = {
    type: GasPriceType.STANDARD,
    gasPriceWei: new BigNumber(process.env.INITIAL_GAS_PRICE_WEI as string),
    gasLimit: STANDARD_BLOCK_GAS_LIMIT,
  }
  return gasResult;
}

export async function updateGasPrice(_dolomite: DolomiteMargin) {
  let response: GasPriceResult;
  try {
    response = await getGasPrices(_dolomite);
  } catch (error: any) {
    logger.error({
      at: 'updateGasPrice',
      message: 'Failed to retrieve gas prices',
      error,
    });
    return;
  }

  logger.info({
    at: 'updateGasPrice',
    message: 'Updating gas price',
    gasPrice: response,
  });

  gasResult = response;
}

export function getGasPriceWeiWithModifications(): Integer {
  const gas = getGasPriceWei();
  return gas.multipliedBy(MULTIPLIER).plus(ADDITION_WEI).integerValue();
}

export function getTypedGasPriceWeiWithModifications(): GasPriceForEthers {
  if (gasResult.type === GasPriceType.STANDARD) {
    return {
      type: 0,
      gasPrice: gasResult.gasPriceWei.multipliedBy(MULTIPLIER).plus(ADDITION_WEI).toFixed(0),
    };
  }

  if (gasResult.type === GasPriceType.EIP_1559) {
    const baseFee = gasResult.baseFeeWei.multipliedBy(MULTIPLIER).plus(ADDITION_WEI).toFixed(0);
    const priorityFee = ethers.BigNumber.from(gasResult.priorityFeeWei.plus(ADDITION_WEI).toFixed(0));
    return {
      type: 2,
      maxFeePerGas: ethers.BigNumber.from(baseFee).add(priorityFee).toHexString(),
      maxPriorityFeePerGas: priorityFee.toHexString(),
    };
  }

  throw new Error(`Invalid gas price result, found: ${gasResult}`);
}

export function getDefaultGasLimit(): Integer {
  return gasResult.gasLimit;
}

/**
 * @return The gas price without any additions or multiplications to the original number
 */
export function getGasPriceWei(): Integer {
  if (gasResult.type === GasPriceType.STANDARD) {
    return gasResult.gasPriceWei;
  }
  if (gasResult.type === GasPriceType.EIP_1559) {
    return gasResult.baseFeeWei.plus(gasResult.priorityFeeWei);
  }

  throw new Error(`Invalid gas price result, found: ${gasResult}`);
}

export function isGasSpikeProtectionEnabled(): boolean {
  return process.env.GAS_SPIKE_PROTECTION === 'true';
}

async function getGasPrices(_dolomite: DolomiteMargin): Promise<GasPriceResult> {
  logger.info({
    message: '#getGasPrices: Fetching gas prices',
  });

  const networkId = Number(process.env.NETWORK_ID);
  if (networkId === ChainId.PolygonZkEvm) {
    const response = await axios.get('https://gasstation.polygon.technology/zkevm');
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: new BigNumber(response.data.fast).times(ONE_GWEI_IN_WEI_UNITS),
      gasLimit: STANDARD_BLOCK_GAS_LIMIT,
    };
  } else if (networkId === ChainId.XLayer) {
    const response = await axios.get('https://rpc.xlayer.tech/gasstation');
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: new BigNumber(response.data.fast).times(ONE_GWEI_IN_WEI_UNITS),
      gasLimit: STANDARD_BLOCK_GAS_LIMIT,
    };
  } else if (isArbitrum(networkId)) {
    const result = await _dolomite.arbitrumGasInfo!.getPricesInWei();
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: result.perArbGasTotal,
      gasLimit: STANDARD_BLOCK_GAS_LIMIT,
    };
  } else if (isBase(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isBerachain(networkId)) {
    return getBerachainGasPrice(_dolomite);
  } else if (isBotanix(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isBsc(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isEthereum(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isInk(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isEthereum(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isMantle(networkId)) {
    return {
      ...(await getStandardOrEip1559GasPrice()),
      gasLimit: new BigNumber('180000000000'),
    };
  } else {
    const errorMessage = `Could not find network ID ${networkId}`;
    logger.error({
      at: 'getGasPrices',
      message: errorMessage,
    });
    process.exit(-1);
    return Promise.reject(new Error(errorMessage));
  }
}

async function getStandardOrEip1559GasPrice(): Promise<GasPriceResult> {
  const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
  const feeData = await provider.getFeeData();
  if (feeData.maxPriorityFeePerGas === null || feeData.lastBaseFeePerGas === null) {
    if (!feeData.gasPrice) {
      return Promise.reject(new Error('No gas data found!'));
    }

    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: new BigNumber(feeData.gasPrice.toString()),
      gasLimit: STANDARD_BLOCK_GAS_LIMIT,
    };
  }

  return {
    type: GasPriceType.EIP_1559,
    baseFeeWei: new BigNumber(feeData.lastBaseFeePerGas.toString()),
    priorityFeeWei: new BigNumber(feeData.maxPriorityFeePerGas.toString()),
    gasLimit: STANDARD_BLOCK_GAS_LIMIT,
  };
}

const TEN = new BigNumber(10);

async function getBerachainGasPrice(_dolomite: DolomiteMargin): Promise<GasPriceResult> {
  const provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
  const feeData = await provider.getFeeData();
  if (feeData.maxPriorityFeePerGas === null || feeData.lastBaseFeePerGas === null) {
    return Promise.reject(new Error('No gas data found!'));
  }

  let priorityFeeWei: BigNumber;
  try {
    priorityFeeWei = await getPriorityFeeForBerachain(_dolomite);
  } catch (e) {
    logger.error({
      message: 'Could not get priority fee for Berachain due to error',
      error: e,
    });
    priorityFeeWei = new BigNumber(feeData.maxPriorityFeePerGas.toString());
  }

  return {
    type: GasPriceType.EIP_1559,
    baseFeeWei: new BigNumber(feeData.lastBaseFeePerGas.toString()),
    priorityFeeWei,
    gasLimit: STANDARD_BLOCK_GAS_LIMIT,
  };
}

async function getPriorityFeeForBerachain(_dolomite: DolomiteMargin): Promise<BigNumber> {
  let wbtcPrice: Decimal;
  let beraPrice: Decimal;
  try {
    const data = await fetch('https://api.dolomite.io/tokens/80094/prices').then(res => res.json());
    wbtcPrice = new BigNumber(data.prices['0x0555e30da8f98308edb960aa94c0db47230d2b9c'])
    beraPrice = new BigNumber(data.prices['0x6969696969696969696969696969696969696969'])
  } catch (e) {
    wbtcPrice = (await _dolomite.getters.getMarketPrice(new BigNumber(4))).div(TEN.pow(28));
    beraPrice = (await _dolomite.getters.getMarketPrice(new BigNumber(1))).div(TEN.pow(18));
  }
  const gasLimit = new BigNumber(125_000);

  return wbtcPrice
    .div(TEN.pow(8))
    .div(beraPrice)
    .div(gasLimit)
    .times(TEN.pow(18))
    .times(1.05) // Add a 5% buffer
    .integerValue();
}
