import * as axios from 'axios';

import { ethers } from 'ethers';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import { glvRegistry } from '../helpers/web3';


/**
 * Keeps track of the GLV tokens to update most liquid GM market
 */
export default class GlvLiquidityStore {
  private glvTokenToLiquidGmMarket: Record<string, string>;

  constructor() {
    this.glvTokenToLiquidGmMarket = {};
  }

  static async getGlvTokenLiquidity(): Promise<any> {
    return axios.default.get('https://arbitrum-api.gmxinfra2.io/glvs/info')
      .then(res => res.data);
  }

  public getGlvTokenToLiquidGmMarket(): Record<string, string> {
    return this.glvTokenToLiquidGmMarket;
  }

  start = () => {
    Logger.info({
      at: 'GlvLiquidityStore#start',
      message: 'Starting glv liquidity store',
    });
    this._poll();
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (error: any) {
        Logger.error({
          at: 'GlvLiquidityStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.GLV_LIQUIDITY_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'GlvLiquidityStore#_update',
      message: 'Updating glv liquidity...',
    });
    const newGlvTokenToLiquidGmMarket = {};
    const glvLiquidity = await GlvLiquidityStore.getGlvTokenLiquidity();

    // Loop through each GLV token
    for (const glv of glvLiquidity.glvs) {
      const glvToken = glv.glvToken.toLowerCase();
      
      // Find market with highest balanceUsd
      let highestBalanceMarket = glv.markets[0];
      let highestBalance = ethers.BigNumber.from(highestBalanceMarket.balanceUsd);

      for (let i = 1; i < glv.markets.length; i++) {
        const market = glv.markets[i];
        const balance = ethers.BigNumber.from(market.balanceUsd);
        if (balance.gt(highestBalance)) {
          highestBalanceMarket = market;
          highestBalance = balance;
        }
      }

      // Check if the most liquid market matches market on registry
      const currentGmMarket = await glvRegistry.methods.glvTokenToGmMarketForWithdrawal(glvToken).call();
      if (currentGmMarket !== highestBalanceMarket.address.toLowerCase()) {
        newGlvTokenToLiquidGmMarket[glvToken] = highestBalanceMarket.address.toLowerCase();
      }
    }

    this.glvTokenToLiquidGmMarket = newGlvTokenToLiquidGmMarket;

    Logger.info({
      at: 'GlvLiquidityStore#_update',
      message: 'Finished updating glv liquidity',
    });
  };
}
