import { BigNumber, DolomiteMargin, Integer } from '@dolomite-exchange/dolomite-margin';
import axios from 'axios';
import { ChainId, isArbitrum, isBase, isBerachain, isBotanix, isEthereum, isInk, isMantle } from '../lib/chain-id';
import Logger from '../lib/logger';
import { ethers } from 'ethers';

export enum GasPriceType {
  STANDARD = 'STANDARD',
  EIP_1559 = 'EIP_1559',
}

export interface GasPriceStandard {
  type: GasPriceType.STANDARD;

  gasPriceWei: Integer;
}

export interface GasPriceEip1559 {
  type: GasPriceType.EIP_1559;

  baseFeeWei: Integer;
  priorityFeeWei: Integer;
}

export type GasPriceResult = GasPriceStandard | GasPriceEip1559;

const ONE_GWEI_IN_WEI_UNITS = new BigNumber('1000000000');

let gasPriceResult: GasPriceResult;
resetGasPriceWei();

export function resetGasPriceWei() {
  gasPriceResult = {
    type: GasPriceType.STANDARD,
    gasPriceWei: new BigNumber(process.env.INITIAL_GAS_PRICE_WEI as string),
  }
}

export async function updateGasPrice(dolomite: DolomiteMargin) {
  let response: GasPriceResult;
  try {
    response = await getGasPrices(dolomite);
  } catch (error: any) {
    Logger.error({
      message: '#updateGasPrice: Failed to retrieve gas prices',
      error,
    });
    return;
  }

  // const multiplier = new BigNumber(process.env.GAS_PRICE_MULTIPLIER as string);
  // const addition = new BigNumber(process.env.GAS_PRICE_ADDITION as string);
  // const totalWei = response
  //   .times(1_000_000_000)
  //   .times(multiplier)
  //   .plus(addition)
  //   .toFixed(0);

  Logger.info({
    at: 'updateGasPrice',
    message: 'Updating gas price',
    gasPrice: response,
  });
}

export function getGasPriceWei(): Integer {
  if (gasPriceResult.type === GasPriceType.STANDARD) {
    return gasPriceResult.gasPriceWei;
  }

  if (gasPriceResult.type === GasPriceType.EIP_1559) {
    // TODO: fix
    return gasPriceResult.baseFeeWei.plus(gasPriceResult.priorityFeeWei);
  }

  throw new Error(`Invalid gas price result, found: ${gasPriceResult}`);
}

/**
 * @return The gas price without any additions or multiplications to the original number
 */
export function getRawGasPriceWei(): Integer {
  // TODO: fix
  // const multiplier = new BigNumber(process.env.GAS_PRICE_MULTIPLIER as string);
  // const addition = new BigNumber(process.env.GAS_PRICE_ADDITION as string);
  // return new BigNumber(lastPriceWei).minus(addition).div(multiplier);

  return getGasPriceWei();
}

export function isGasSpikeProtectionEnabled(): boolean {
  return process.env.GAS_SPIKE_PROTECTION === 'true';
}

async function getGasPrices(dolomite: DolomiteMargin): Promise<GasPriceResult> {
  Logger.info({
    message: '#getGasPrices: Fetching gas prices',
  });

  const networkId = Number(process.env.NETWORK_ID);
  if (networkId === ChainId.PolygonZkEvm) {
    const response = await axios.get('https://gasstation.polygon.technology/zkevm');
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: new BigNumber(response.data.fast).times(ONE_GWEI_IN_WEI_UNITS),
    };
  } else if (networkId === ChainId.XLayer) {
    const response = await axios.get('https://rpc.xlayer.tech/gasstation');
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: new BigNumber(response.data.fast).times(ONE_GWEI_IN_WEI_UNITS),
    };
  } else if (isArbitrum(networkId)) {
    const result = await dolomite.arbitrumGasInfo!.getPricesInWei();
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: result.perArbGasTotal,
    };
  } else if (isBase(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isBerachain(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isBotanix(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isEthereum(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isInk(networkId)) {
    return getStandardOrEip1559GasPrice();
  } else if (isEthereum(networkId)) {
    const response = await dolomite.web3.eth.getGasPrice();
    const gasPrice = new BigNumber(response).div(ONE_GWEI_IN_WEI_UNITS).toFixed();
    return { fast: gasPrice };
  } else if (isMantle(networkId)) {
    return {
      type: GasPriceType.STANDARD,
      gasPriceWei: new BigNumber(await dolomite.mantleGasInfo!.getPriceInWei()),
    };
  } else {
    const errorMessage = `Could not find network ID ${networkId}`;
    Logger.error({
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
    };
  }

  return {
    type: GasPriceType.EIP_1559,
    baseFeeWei: new BigNumber(feeData.lastBaseFeePerGas.toString()),
    priorityFeeWei: new BigNumber(feeData.maxPriorityFeePerGas.toString()),
  };
}
