import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import * as axios from 'axios';

import { ethers } from 'ethers';
import GlvRegistryAbi from '../abis/glv-registry.json';
import GmxReaderAbi from '../abis/gmx-reader.json';
import OracleAggregatorAbi from '../abis/oracle-aggregator.json';
import {
  updateGlvTokenToGmMarketForDeposit,
  updateGlvTokenToGmMarketForWithdrawal,
} from '../helpers/glv-registry-helpers';
import { dolomite } from '../helpers/web3';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import { ADDRESS_ZERO } from '@dolomite-exchange/zap-sdk/dist/src/lib/Constants';

const GMX_READER_ADDRESS = '0x0537C767cDAC0726c76Bb89e92904fe28fd02fE1';
const GMX_DATA_STORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

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
    const gmxReader = new dolomite.web3.eth.Contract(
      GmxReaderAbi,
      GMX_READER_ADDRESS,
    );
    const oracleAggregator = new dolomite.web3.eth.Contract(
      OracleAggregatorAbi,
      ModuleDeployments.OracleAggregatorV2[this.networkId].address,
    );

    // Loop through each GLV token
    for (const glv of glvLiquidity.glvs) {
      const glvToken = glv.glvToken.toLowerCase();

      // Set initial highest balance market and balance
      let highestBalanceMarket = { address: ADDRESS_ZERO };
      let highestBalanceUsd = ethers.BigNumber.from('0');

      for (let i = 0; i < glv.markets.length; i++) {
        const market = glv.markets[i];
        const balanceUsd = ethers.BigNumber.from(market.balanceUsd);

        if (balanceUsd.gt(highestBalanceUsd)) {
          const marketInfo = await dolomite.contracts.callConstantContractFunction<any>(
            gmxReader.methods.getMarket(GMX_DATA_STORE_ADDRESS, market.address)
          );

          // Check if we have oracle for index token
          try {
            await dolomite.contracts.callConstantContractFunction<any>(
              oracleAggregator.methods.getPrice(marketInfo.indexToken)
            );
          } catch (error: any) {
            continue;
          }

          highestBalanceMarket = market;
          highestBalanceUsd = balanceUsd;
        }
      }

      // Check if the most liquid market matches market on registry
      const currentGmMarket = await dolomite.contracts.callConstantContractFunction<string>(
        glvRegistry.methods.glvTokenToGmMarketForWithdrawal(glvToken),
      );
      if (highestBalanceMarket.address !== ADDRESS_ZERO && currentGmMarket !== highestBalanceMarket.address) {
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
