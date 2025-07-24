import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import * as axios from 'axios';

import { BigNumber, ethers } from 'ethers';
import GlvRegistryAbi from '../abis/glv-registry.json';
import GmxReaderAbi from '../abis/gmx-reader.json';
import GmxDataStoreAbi from '../abis/gmx-datastore.json';
import OracleAggregatorAbi from '../abis/oracle-aggregator.json';
import {
  updateGlvTokenToGmMarketForDeposit,
  updateGlvTokenToGmMarketForWithdrawal,
} from '../helpers/glv-registry-helpers';
import { dolomite } from '../helpers/web3';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';

const GMX_READER_ADDRESS = '0x0537C767cDAC0726c76Bb89e92904fe28fd02fE1';
const GMX_DATA_STORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

const POOL_AMOUNT_KEY = '0x8d6d2afbc2bb1e17cb89b72f19b266a410f6ee8f890812b98b609d4bbf135960';
const MAX_POOL_AMOUNT_KEY = '0xe88b5773e3873a6265fa6e9e8dc016218fbded41751726542157f40b640a2083';
const GLV_MAX_MARKET_TOKEN_BALANCE_USD_KEY = '0x210e65e389535740c6f5f16309d04a8f11dd78de7a459ea229cf71a615dcfcd9';

const FIVE_HUNDRED_THOUSAND_USD = ethers.BigNumber.from('500000000000000000000000000000000000'); // gmx uses 30 decimals

interface GlvTokenUpdate {
  withdrawalMarket: string | undefined;
  depositMarket: string | undefined;
}

export interface SignedPriceData {
  tokenAddress: string;
  minPrice: string;
  maxPrice: string;
}

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

  static async getTokenPrices(): Promise<Record<string, SignedPriceData>> {
    return axios.default.get('https://arbitrum-api.gmxinfra2.io/prices/tickers')
      .then(res => res.data)
      .then(data => (data as any[]).reduce((memo, priceData) => {
        const tokenAddress = ethers.utils.getAddress(priceData.tokenAddress);
        memo[tokenAddress] = {
          ...priceData,
          tokenAddress,
        };
        return memo;
      }, {}));
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

    const glvTokenToLiquidGmMarket: Record<string, GlvTokenUpdate> = {};
    const glvLiquidity = await GlvLiquidityStore.getGlvTokenLiquidity();
    const gmxTokenPrices = await GlvLiquidityStore.getTokenPrices();

    const gmxDataStore = new dolomite.web3.eth.Contract(
      GmxDataStoreAbi,
      GMX_DATA_STORE_ADDRESS,
    );
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
      glvTokenToLiquidGmMarket[glv.glvToken.toLowerCase()] = { withdrawalMarket: undefined, depositMarket: undefined };
      const glvToken = glv.glvToken.toLowerCase();

      // Set initial highest balance market and balance
      let withdrawalMarket: string | undefined;
      let withdrawalMarketHighestUsd = ethers.BigNumber.from('0');

      let depositMarket: string | undefined;
      let depositMarketHighestCap = ethers.BigNumber.from('0');

      for (let i = 0; i < glv.markets.length; i++) {
        const market = glv.markets[i];
        const balanceUsd = ethers.BigNumber.from(market.balanceUsd);

        const marketInfo = await dolomite.contracts.callConstantContractFunction<any>(
          gmxReader.methods.getMarket(GMX_DATA_STORE_ADDRESS, market.address)
        );

        try {
          await dolomite.contracts.callConstantContractFunction<any>(
            oracleAggregator.methods.getPrice(marketInfo.indexToken)
          );
        } catch (error: any) {
          continue;
        }

        // Withdraws: We pick the gm market with the highest liquidity and both tokens are below GM market max (so we can swap after the withdrawal)
        if (balanceUsd.gt(withdrawalMarketHighestUsd) && (await this._shortAndLongTokensBelowMax(market, marketInfo.shortToken, marketInfo.longToken, gmxDataStore))) {
          withdrawalMarket = market.address;
          withdrawalMarketHighestUsd = balanceUsd;
        }

        // Deposits: We pick the GM market with the highest deposit cap that also has liquidity > 500k USD
        if (balanceUsd.gt(FIVE_HUNDRED_THOUSAND_USD)) {
          const depositCap = await this._getGmMarketUsdDepositCap(glv, market, marketInfo.shortToken, marketInfo.longToken, gmxDataStore, gmxTokenPrices);

          if (depositCap.gt(depositMarketHighestCap)) {
            depositMarket = market.address;
            depositMarketHighestCap = depositCap;
          }
        }
      }

      // Check if we need to update the gm market
      const currentWithdrawalGmMarket = await dolomite.contracts.callConstantContractFunction<string>(
        glvRegistry.methods.glvTokenToGmMarketForWithdrawal(glvToken),
      );
      const currentDepositGmMarket = await dolomite.contracts.callConstantContractFunction<string>(
        glvRegistry.methods.glvTokenToGmMarketForDeposit(glvToken),
      );

      if (currentWithdrawalGmMarket !== withdrawalMarket) {
        glvTokenToLiquidGmMarket[glvToken].withdrawalMarket = withdrawalMarket;
      }
      if (currentDepositGmMarket !== depositMarket) {
        glvTokenToLiquidGmMarket[glvToken].depositMarket = depositMarket;
      }
    }

    for (const [glvTokenAddress, glvToken] of Object.entries(glvTokenToLiquidGmMarket)) {
      // Update deposit market
      if (glvToken.depositMarket) {
        try {
          const result = await updateGlvTokenToGmMarketForDeposit(glvRegistry, glvTokenAddress, glvToken.depositMarket);
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
            glvTokenAddress,
            gmMarket: glvToken.depositMarket,
            error,
          });
        }
      }

      // Update withdrawal market
      if (glvToken.withdrawalMarket) {
        try {
          const result = await updateGlvTokenToGmMarketForWithdrawal(glvRegistry, glvTokenAddress, glvToken.withdrawalMarket);
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
            glvTokenAddress,
            gmMarket: glvToken.withdrawalMarket,
            error,
          });
        }
      }
    }

    Logger.info({
      at: 'GlvLiquidityStore#_update',
      message: 'Finished updating glv liquidity',
    });
  };

  _getGmMarketUsdDepositCap = async (
    glv: any,
    market: any,
    shortToken: string,
    longToken: string,
    gmxDataStore: any,
    gmxTokenPrices: any
  ) => {
    const maxUsd = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [GLV_MAX_MARKET_TOKEN_BALANCE_USD_KEY, glv.glvToken, market.address]
        ))
      )
    );
    const glvAvailableUsd = BigNumber.from(maxUsd).sub(BigNumber.from(market.balanceUsd));

    const shortTokenPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [POOL_AMOUNT_KEY, market.address, shortToken]
        ))
      )
    );
    const shortTokenMaxPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [MAX_POOL_AMOUNT_KEY, market.address, shortToken]
        ))
      )
    );
    const shortTokenAvailableUsd = BigNumber.from(shortTokenMaxPoolAmount).sub(BigNumber.from(shortTokenPoolAmount)).mul(gmxTokenPrices[shortToken].maxPrice);

    const longTokenPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [POOL_AMOUNT_KEY, market.address, longToken]
        ))
      )
    );
    const longTokenMaxPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [MAX_POOL_AMOUNT_KEY, market.address, longToken]
        ))
      )
    );
    const longTokenAvailableUsd = BigNumber.from(longTokenMaxPoolAmount).sub(BigNumber.from(longTokenPoolAmount)).mul(gmxTokenPrices[longToken].maxPrice);

    return [glvAvailableUsd, shortTokenAvailableUsd, longTokenAvailableUsd].reduce((min, current) => current.lt(min) ? current : min);
  }

  _shortAndLongTokensBelowMax = async (market: any, shortToken: string, longToken: string, gmxDataStore: any) => {
    const shortTokenPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [POOL_AMOUNT_KEY, market.address, shortToken]
        ))
      )
    );
    const shortTokenMaxPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [MAX_POOL_AMOUNT_KEY, market.address, shortToken]
        ))
      )
    );
    const shortAmount = ethers.BigNumber.from(shortTokenPoolAmount);
    const shortMax = ethers.BigNumber.from(shortTokenMaxPoolAmount)

    const longTokenPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [POOL_AMOUNT_KEY, market.address, longToken]
        ))
      )
    );
    const longTokenMaxPoolAmount = await dolomite.contracts.callConstantContractFunction<any>(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [MAX_POOL_AMOUNT_KEY, market.address, longToken]
        ))
      )
    );
    const longAmount = ethers.BigNumber.from(longTokenPoolAmount);
    const longMax = ethers.BigNumber.from(longTokenMaxPoolAmount);
    return shortAmount.lt(shortMax) && longAmount.lt(longMax);
  }
}
