import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import { ethers } from 'ethers';
import { dolomite } from '../helpers/web3';
import { ApiMarket } from '../lib/api-types';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import { chunkArray } from '../lib/utils';
import MarketStore from './market-store';

const CHUNK_SIZE = 25;

interface MarketWithCalldata {
  market: ApiMarket;
  target: string;
  callData: string;
}

/**
 * Keeps track of the protocol balances for available ERC20 liquidity.
 */
export default class BalanceStore {
  private marketBalancesMap: { [marketId: string]: Integer };

  constructor(private readonly marketStore: MarketStore) {
    this.marketBalancesMap = {};
  }

  public getMarketBalancesMap(): { [marketId: string]: Integer } {
    return this.marketBalancesMap;
  }

  start = () => {
    Logger.info({
      at: 'BalanceStore#start',
      message: 'Starting market store',
    });
    this._poll();
  };

  _poll = async () => {
    await delay(Number(process.env.MARKET_POLL_INTERVAL_MS));

    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (error: any) {
        Logger.error({
          at: 'BalanceStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.BALANCE_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'BalanceStore#_update',
      message: 'Updating market balances...',
    });

    const marketMap = this.marketStore.getMarketMap();
    if (Object.keys(marketMap).length === 0) {
      Logger.warn({
        at: 'BalanceStore#_update',
        message: 'Market map from BalanceStore is not initialized yet, returning...',
      });
      return;
    }

    const chunkedMarkets = chunkArray(Object.values(marketMap), CHUNK_SIZE);

    const nextBalanceMap:{ [marketId: string]: Integer } = {};
    for (let i = 0; i < chunkedMarkets.length; i += 1) {
      const chunkedMarket = chunkedMarkets[i];
      const calls = chunkedMarket.reduce((acc, market) => {
        if (market.isBorrowingDisabled) {
          nextBalanceMap[market.marketId] = INTEGERS.MAX_UINT;
        } else {
          acc.push({
            market,
            target: market.tokenAddress,
            callData: dolomite.contracts.weth.methods.balanceOf(dolomite.address).encodeABI(),
          })
        }
        return acc;
      }, [] as MarketWithCalldata[]);

      const { results } = await dolomite.multiCall.aggregate(calls);
      results.forEach((result, j) => {
        nextBalanceMap[calls[j].market.marketId] = new BigNumber(
          ethers.utils.defaultAbiCoder.decode(['uint256'], result)[0].toString(),
        );
      });
    }

    this.marketBalancesMap = nextBalanceMap;

    Logger.info({
      at: 'BalanceStore#_update',
      message: 'Finished updating market balances',
    });
  };
}
