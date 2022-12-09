import { address, Integer } from '@dolomite-exchange/dolomite-margin';
import axios from 'axios';
import { ApiMarket } from '../lib/api-types';
import Logger from '../lib/logger';

const API_URL = 'https://apiv5.paraswap.io';
const NETWORK_ID = process.env.NETWORK_ID?.toString();

export async function getParaswapSwapCalldataForLiquidation(
  heldMarket: ApiMarket,
  heldAmountWei: Integer,
  owedMarket: ApiMarket,
  owedAmountWei: Integer,
  solidAccount: address,
  liquidatorProxyAddress: address,
  networkId: string = NETWORK_ID,
): Promise<string> {
  const pricesQueryParams = new URLSearchParams({
    network: networkId,
    srcToken: heldMarket.tokenAddress,
    srcDecimals: heldMarket.decimals.toString(),
    destToken: owedMarket.tokenAddress,
    destDecimals: owedMarket.decimals.toString(),
    amount: heldAmountWei.toFixed(),
    includeContractMethods: 'simpleSwap,multiSwap,megaSwap',
  }).toString();
  const priceRouteResponse = await axios.get(`${API_URL}/prices?${pricesQueryParams}`)
    .then(response => response.data)
    .catch((error) => {
      Logger.error({
        message: 'Found error in paraswap#prices',
        error,
      });
      throw error;
    });

  const transactionsQueryParams = new URLSearchParams({
    ignoreChecks: 'true',
    ignoreGasEstimate: 'true',
    onlyParams: 'false',
  }).toString();
  const result = await axios.post(`${API_URL}/transactions/${networkId}?${transactionsQueryParams}`, {
    priceRoute: priceRouteResponse?.priceRoute,
    txOrigin: solidAccount,
    srcToken: heldMarket.tokenAddress,
    srcDecimals: heldMarket.decimals,
    destToken: owedMarket.tokenAddress,
    destDecimals: owedMarket.decimals,
    srcAmount: heldAmountWei.toFixed(),
    destAmount: owedAmountWei.toFixed(),
    userAddress: liquidatorProxyAddress,
    receiver: liquidatorProxyAddress,
  })
    .then(response => response.data)
    .catch(error => {
      Logger.error({
        message: 'Found error in paraswap#transactions',
        error,
      });

      throw error;
    });

  return result.data;
}
