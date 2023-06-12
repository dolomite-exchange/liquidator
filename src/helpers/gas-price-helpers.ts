import { BigNumber, DolomiteMargin, Integer } from '@dolomite-exchange/dolomite-margin';
import request from 'request-promise-native';
import { ChainId, isArbitrum, isPolygon } from '../lib/chain-id';
import Logger from '../lib/logger';

let lastPriceWei: string = process.env.INITIAL_GAS_PRICE_WEI as string;

export async function updateGasPrice(dolomite: DolomiteMargin) {
  let response;
  try {
    response = await getGasPrices(dolomite);
  } catch (error: any) {
    Logger.error({
      at: 'getGasPrices',
      message: 'Failed to retrieve gas prices',
      error,
    });
    return;
  }

  const { fast } = response;
  if (!fast) {
    Logger.error({
      at: 'updateGasPrice',
      message: 'gas api did not return fast',
    });
    return;
  }

  const multiplier = new BigNumber(process.env.GAS_PRICE_MULTIPLIER as string);
  const addition = new BigNumber(process.env.GAS_PRICE_ADDITION as string);
  const networkId = Number(process.env.NETWORK_ID)
  const base = networkId === ChainId.Ethereum ? 100_000_000 : 1_000_000_000;
  const totalWei = new BigNumber(fast)
    .times(base)
    .times(multiplier)
    .plus(addition)
    .toFixed(0);

  Logger.info({
    at: 'updateGasPrice',
    message: 'Updating gas price',
    gasPrice: totalWei,
  });

  lastPriceWei = totalWei;
}

export function getGasPriceWei(): Integer {
  return new BigNumber(lastPriceWei);
}

async function getGasPrices(dolomite: DolomiteMargin): Promise<{ fast: string }> {
  Logger.info({
    at: 'getGasPrices',
    message: 'Fetching gas prices',
  });

  const networkId = Number(process.env.NETWORK_ID);
  if (isPolygon(networkId)) {
    const uri = networkId === ChainId.PolygonMatic
      ? 'https://gasstation-mainnet.matic.network/'
      : 'https://gasstation-mumbai.matic.today/';
    const response = await request({
      uri,
      method: 'GET',
      timeout: process.env.GAS_REQUEST_TIMEOUT_MS,
    });
    return JSON.parse(response);
  } else if (isArbitrum(networkId)) {
    const result = await dolomite.arbitrumGasInfo.getPricesInWei();
    return {
      fast: result.perArbGasTotal.dividedBy('1000000000').toFixed(), // convert to gwei
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
