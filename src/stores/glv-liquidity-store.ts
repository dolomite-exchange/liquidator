import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import * as axios from 'axios';

import { ethers } from 'ethers';
import GlvRegistryAbi from '../abis/glv-registry.json';
import {
  updateGlvTokenToGmMarketForDeposit,
  updateGlvTokenToGmMarketForWithdrawal,
} from '../helpers/glv-registry-helpers';
import { dolomite } from '../helpers/web3';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';

/**
 * Keeps track of the GLV tokens to update most liquid GM market
 */
export default class GlvLiquidityStore {
  constructor(private readonly networkId: number) {
  }

  static async getGlvTokenLiquidity(): Promise<any> {
    return axios.default.get('https://arbitrum-api.gmxinfra2.io/glvs/info')
      .then(res => res.data);
  }

  start = () => {
    Logger.info({
      at: 'GlvLiquidityStore#start',
      message: 'Starting GLV liquidity store',
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
    const glvTokenToLiquidGmMarket: Record<string, string> = {};
    const glvLiquidity = await GlvLiquidityStore.getGlvTokenLiquidity();
    const glvRegistry = new dolomite.web3.eth.Contract(
      GlvRegistryAbi,
      ModuleDeployments.GlvRegistryProxy[this.networkId].address,
    );

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
      const currentGmMarket = await dolomite.contracts.callConstantContractFunction<string>(
        glvRegistry.methods.glvTokenToGmMarketForWithdrawal(glvToken),
      );
      if (currentGmMarket !== highestBalanceMarket.address) {
        glvTokenToLiquidGmMarket[glvToken] = highestBalanceMarket.address;
      }
    }

    for (const [glvToken, gmMarket] of Object.entries(glvTokenToLiquidGmMarket)) {
      // Update deposit market
      try {
        const result = await updateGlvTokenToGmMarketForDeposit(glvRegistry, glvToken, gmMarket);
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
        if (result) {
          Logger.info({
            message: 'GLV token to GM market deposit update transaction hash:',
            transactionHash: result?.transactionHash,
          });
        }
      } catch (error: any) {
        Logger.error({
          at: 'GlvLiquidityStore#_update',
          message: 'Failed to process GLV token to GM market deposit update',
          glvToken,
          gmMarket,
          error,
        });
      }

      // Update withdrawal market
      try {
        const result = await updateGlvTokenToGmMarketForWithdrawal(glvRegistry, glvToken, gmMarket);
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
        if (result) {
          Logger.info({
            message: 'GLV token to GM market withdrawal update transaction hash:',
            transactionHash: result?.transactionHash,
          });
        }
      } catch (error: any) {
        Logger.error({
          at: 'GlvLiquidityStore#_update',
          message: 'Failed to process GLV token to GM market withdrawal update',
          glvToken,
          gmMarket,
          error,
        });
      }
    }

    Logger.info({
      at: 'GlvLiquidityStore#_update',
      message: 'Finished updating glv liquidity',
    });
  };
}
