import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import * as axios from 'axios';

import { BigNumber, ethers } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import GlvRegistryAbi from '../abis/glv-registry.json';
import GmxDataStoreAbi from '../abis/gmx-datastore.json';
import GmxReaderAbi from '../abis/gmx-reader.json';
import OracleAggregatorAbi from '../abis/oracle-aggregator.json';
import {
  updateGlvTokenToGmMarketForDeposit,
  updateGlvTokenToGmMarketForWithdrawal,
} from '../helpers/glv-registry-helpers';
import { dolomite } from '../helpers/web3';
import { delay } from '../lib/delay';
import Logger from '../lib/logger';

const GMX_READER_ADDRESS = '0x0537C767cDAC0726c76Bb89e92904fe28fd02fE1';
const GMX_DATA_STORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

const GLV_MAX_MARKET_TOKEN_BALANCE_USD_KEY = '0x210e65e389535740c6f5f16309d04a8f11dd78de7a459ea229cf71a615dcfcd9';

const GMX_PRECISION = ethers.BigNumber.from('1000000000000000000000000000000'); // 30 decimals

// const FIVE_HUNDRED_THOUSAND_USD = ethers.BigNumber.from('500000000000000000000000000000000000'); // gmx uses 30 decimals

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

  static async getGmMarketInfo(marketAddress: string): Promise<any> {
    return axios.default.post('https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql', {
      query: `
        query MyQuery {
          marketInfos(where: { marketTokenAddress_eq: "${marketAddress}" }) {
            marketTokenAddress
            longOpenInterestInTokens
            longPoolAmount
            maxLongPoolAmount
            reserveFactorLong
            reserveFactorShort
            shortOpenInterestUsd
            shortPoolAmount
            maxShortPoolAmount
            maxLongPoolUsdForDeposit
            maxShortPoolUsdForDeposit
          }
        }
      `,
      variables: null,
      operationName: 'MyQuery',
    })
      .then(res => res.data)
      .then(data => data.data.marketInfos[0]);
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
    const [glvLiquidity, gmxTokenPrices] = await Promise.all([
      GlvLiquidityStore.getGlvTokenLiquidity(),
      GlvLiquidityStore.getTokenPrices(),
    ]);

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

    Logger.info({
      at: 'GlvLiquidityStore#_update',
      message: `Found ${glvLiquidity.glvs.length} GLV assets to loop through...`,
    });

    // Loop through each GLV token
    for (let i = 0; i < glvLiquidity.glvs.length; i++) {
      const glv = glvLiquidity.glvs[i];
      glvTokenToLiquidGmMarket[glv.glvToken.toLowerCase()] = { withdrawalMarket: undefined, depositMarket: undefined };

      const { longToken, shortToken } = glv;
      const glvToken = glv.glvToken.toLowerCase();

      // Set initial highest balance market and balance
      let withdrawalMarketAddress: string | undefined;
      let withdrawalMarketHighestUsd = ethers.BigNumber.from('0');

      let depositMarket: string | undefined = undefined;
      let depositMarketHighestCap = ethers.BigNumber.from('0');

      const invalidMarkets: string[] = [];

      Logger.info({
        at: 'GlvLiquidityStore#_update',
        message: `Found ${glv.markets.length} markets for the ${glv.name} token`,
      });
      for (let i = 0; i < glv.markets.length; i++) {
        const market = glv.markets[i];
        if (market.isDisabled === true) {
          // eslint-disable-next-line no-continue
          continue;
        }

        const balanceUsd = ethers.BigNumber.from(market.balanceUsd);

        const marketInfo = await dolomite.contracts.callConstantContractFunction<any>(
          gmxReader.methods.getMarket(GMX_DATA_STORE_ADDRESS, market.address),
        );

        try {
          await dolomite.contracts.callConstantContractFunction<any>(
            oracleAggregator.methods.getPrice(marketInfo.indexToken),
          );
        } catch (error: any) {
          invalidMarkets.push(market.address);
          // eslint-disable-next-line no-continue
          continue;
        }

        const marketSubgraphInfo = await GlvLiquidityStore.getGmMarketInfo(market.address);

        // Withdraws: We pick the gm market with the highest liquidity (min of GLV usd and sellable usd in GM market)
        //            and both tokens are below GM market max (so we can swap after the withdrawal)
        const sellableUsd = this._getGmSellableAmount(
          marketSubgraphInfo,
          marketInfo.shortToken,
          marketInfo.longToken,
          marketInfo.indexToken,
          gmxTokenPrices,
        );
        const availableToWithdraw = sellableUsd.lt(balanceUsd) ? sellableUsd : balanceUsd;
        if (
          availableToWithdraw.gt(withdrawalMarketHighestUsd)
          && this._shortAndLongTokensBelowMax(marketSubgraphInfo)
        ) {
          withdrawalMarketAddress = market.address;
          withdrawalMarketHighestUsd = availableToWithdraw;
        }

        const availableToDeposit = await this._getGmMarketAvailableToDeposit(
          glv,
          market,
          longToken,
          shortToken,
          marketSubgraphInfo,
          gmxDataStore,
          gmxTokenPrices,
        );
        if (availableToDeposit.gt(depositMarketHighestCap)) {
          depositMarket = market.address;
          depositMarketHighestCap = availableToDeposit;
        }
      }

      if (invalidMarkets.length > 0) {
        Logger.warn({
          at: __filename,
          message: `Could not get prices for ${invalidMarkets.length} markets`,
          markets: invalidMarkets,
        });
      }

      // Check if we need to update the gm market
      const { results } = await dolomite.multiCall.aggregate([
        {
          target: glvRegistry.options.address,
          callData: glvRegistry.methods.glvTokenToGmMarketForWithdrawal(glvToken).encodeABI(),
        },
        {
          target: glvRegistry.options.address,
          callData: glvRegistry.methods.glvTokenToGmMarketForDeposit(glvToken).encodeABI(),
        },
      ])
      const currentWithdrawalGmMarket = ethers.utils.defaultAbiCoder.decode(['address'], results[0])[0];
      const currentDepositGmMarket = ethers.utils.defaultAbiCoder.decode(['address'], results[1])[0];

      if (withdrawalMarketAddress && currentWithdrawalGmMarket !== withdrawalMarketAddress) {
        glvTokenToLiquidGmMarket[glvToken].withdrawalMarket = withdrawalMarketAddress;
      }
      if (depositMarket && currentDepositGmMarket !== depositMarket) {
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
          const result = await updateGlvTokenToGmMarketForWithdrawal(
            glvRegistry,
            glvTokenAddress,
            glvToken.withdrawalMarket,
          );
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

  _getGmMarketAvailableToDeposit = async (
    glv: any,
    glvMarket: any,
    longToken: string,
    shortToken: string,
    marketSubgraphInfo: any,
    gmxDataStore: any,
    gmxTokenPrices: any,
  ) => {
    const maxUsd = await dolomite.contracts.callConstantContractFunction(
      gmxDataStore.methods.getUint(
        keccak256(defaultAbiCoder.encode(
          ['bytes32', 'address', 'address'],
          [GLV_MAX_MARKET_TOKEN_BALANCE_USD_KEY, glv.glvToken, marketSubgraphInfo.marketTokenAddress],
        )),
      ),
    );
    const shortTokenPoolAmount = ethers.BigNumber.from(marketSubgraphInfo.shortPoolAmount);
    const shortTokenMaxPoolAmountUsd = ethers.BigNumber.from(marketSubgraphInfo.maxShortPoolUsdForDeposit);
    const longTokenPoolAmount = ethers.BigNumber.from(marketSubgraphInfo.longPoolAmount);
    const longTokenMaxPoolAmountUsd = ethers.BigNumber.from(marketSubgraphInfo.maxLongPoolUsdForDeposit);

    const glvAvailableUsd = BigNumber.from(maxUsd).sub(BigNumber.from(glvMarket.balanceUsd));
    const shortTokenAvailableUsd = shortTokenMaxPoolAmountUsd
      .sub(shortTokenPoolAmount.mul(gmxTokenPrices[shortToken].maxPrice))
    const longTokenAvailableUsd = BigNumber.from(longTokenMaxPoolAmountUsd)
      .sub(longTokenPoolAmount.mul(gmxTokenPrices[longToken].maxPrice))

    return [glvAvailableUsd, shortTokenAvailableUsd, longTokenAvailableUsd]
      .reduce((min, current) => (current.lt(min) ? current : min));
  }

  _shortAndLongTokensBelowMax = (marketSubgraphInfo: any) => {
    const shortAmount = ethers.BigNumber.from(marketSubgraphInfo.shortPoolAmount);
    const shortMax = ethers.BigNumber.from(marketSubgraphInfo.maxShortPoolAmount)
    const longAmount = ethers.BigNumber.from(marketSubgraphInfo.longPoolAmount);
    const longMax = ethers.BigNumber.from(marketSubgraphInfo.maxLongPoolAmount);
    return shortAmount.lt(shortMax) && longAmount.lt(longMax);
  }

  _getGmSellableAmount = (
    marketSubgraphInfo: any,
    shortToken: string,
    longToken: string,
    indexToken: string,
    gmxTokenPrices: any,
  ) => {
    /**
     poolUsd = longPoolAmount * longToken.prices.minPrice
     reservedUsd = longInterestInTokens * indexToken.prices.maxPrice
     minPoolUsd = (reservedUsd * PRECISION) / reserveFactorLong
     liquidity = poolUsd - minPoolUsd
     */
    const longTokenPoolAmount = ethers.BigNumber.from(marketSubgraphInfo.longPoolAmount);
    const longPoolUsd = longTokenPoolAmount.mul(gmxTokenPrices[longToken].minPrice);
    const longReservedUsd = ethers.BigNumber.from(marketSubgraphInfo.longOpenInterestInTokens)
      .mul(gmxTokenPrices[indexToken].maxPrice);
    const longMinPoolUsd = longReservedUsd.mul(GMX_PRECISION)
      .div(ethers.BigNumber.from(marketSubgraphInfo.reserveFactorLong));
    const longLiquidity = longPoolUsd.sub(longMinPoolUsd);

    /**
     *
     poolUsd = shortPoolAmount × shortPrice
     reservedUsd = shortOpenInterestUsd
     minPoolUsd = (reservedUsd × PRECISION) ÷ reserveFactorShort
     liquidity = poolUsd - minPoolUsd
     */
    const shortPoolUsd = ethers.BigNumber.from(marketSubgraphInfo.shortPoolAmount)
      .mul(gmxTokenPrices[shortToken].minPrice);
    const shortReservedUsd = ethers.BigNumber.from(marketSubgraphInfo.shortOpenInterestUsd);
    const shortMinPoolUsd = shortReservedUsd.mul(GMX_PRECISION)
      .div(ethers.BigNumber.from(marketSubgraphInfo.reserveFactorShort));
    const shortLiquidity = shortPoolUsd.sub(shortMinPoolUsd);

    return longLiquidity.lt(shortLiquidity) ? longLiquidity : shortLiquidity;
  }
}
