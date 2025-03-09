import { ISOLATION_MODE_CONVERSION_MARKET_ID_MAP } from '@dolomite-exchange/zap-sdk/dist/src/lib/MarketIds';
import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import v8 from 'v8';
// eslint-disable-next-line
import '../src/lib/env';

import { getDolomiteRiskParams } from './clients/dolomite';
import { getSubgraphBlockNumber } from './helpers/block-helper';
import { dolomite, initializeDolomiteLiquidations, loadAccounts } from './helpers/web3';
import DolomiteLiquidator from './lib/dolomite-liquidator';
import GasPriceUpdater from './lib/gas-price-updater';
import {
  checkBigNumber,
  checkBigNumberAndGreaterThan,
  checkBooleanValue,
  checkConditionally,
  checkDuration,
  checkEthereumAddress,
  checkExists,
  checkJsNumber,
  checkLiquidationModeConditionally,
  checkMarketIdList,
  checkPrivateKey,
} from './lib/invariants';
import { getLiquidationMode, LiquidationMode } from './lib/liquidation-mode';
import Logger from './lib/logger';
import AccountStore from './stores/account-store';
import AsyncActionRetryStore from './stores/async-action-retry-store';
import AsyncActionStore from './stores/async-action-store';
import BalanceStore from './stores/balance-store';
import BlockStore from './stores/block-store';
import LiquidationStore from './stores/liquidation-store';
import MarketStore from './stores/market-store';
import RiskParamsStore from './stores/risk-params-store';
import { liquidatorProxyV5 } from './helpers/liquidator-proxy-v5-helper';

checkDuration('ACCOUNT_POLL_INTERVAL_MS', 1000);
checkEthereumAddress('ACCOUNT_WALLET_ADDRESS');
checkPrivateKey('ACCOUNT_WALLET_PRIVATE_KEY');
checkBooleanValue('ASYNC_ACTIONS_ENABLED');
checkDuration('ASYNC_ACTIONS_KEY_EXPIRATION_SECONDS', 1, /* isMillis = */ false);
checkDuration('ASYNC_ACTIONS_POLL_INTERVAL_MS', 1000);
checkDuration('BALANCE_POLL_INTERVAL_MS', 1000);
checkDuration('BLOCK_POLL_INTERVAL_MS', 1000);
checkLiquidationModeConditionally(
  LiquidationMode.Simple,
  () => checkMarketIdList('COLLATERAL_PREFERENCES', 1),
);
checkBigNumber('DOLOMITE_ACCOUNT_NUMBER');
checkExists('ETHEREUM_NODE_URL');
checkBooleanValue('EXPIRATIONS_ENABLED');
checkDuration('EXPIRED_ACCOUNT_DELAY_SECONDS', 0, /* isMillis = */ false);
checkBigNumber('GAS_PRICE_ADDITION');
checkBigNumber('GAS_PRICE_MULTIPLIER');
checkBigNumber('GAS_PRICE_POLL_INTERVAL_MS');
checkBooleanValue('GAS_SPIKE_PROTECTION');
checkConditionally(!!process.env.IGNORED_MARKETS, () => checkMarketIdList('IGNORED_MARKETS', 0));
checkBigNumber('INITIAL_GAS_PRICE_WEI');
checkDuration('LIQUIDATE_POLL_INTERVAL_MS', 1000);
checkDuration('LIQUIDATION_KEY_EXPIRATION_SECONDS', 1, /* isMillis = */ false);
checkBooleanValue('LIQUIDATIONS_ENABLED');
checkDuration('MARKET_POLL_INTERVAL_MS', 1000);
checkBigNumber('MIN_ACCOUNT_COLLATERALIZATION');
checkBigNumberAndGreaterThan('MIN_VALUE_LIQUIDATED', '1000000000000000000000000'); // 1e24
checkBigNumberAndGreaterThan('MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL', process.env.MIN_VALUE_LIQUIDATED!);
checkJsNumber('NETWORK_ID');
checkLiquidationModeConditionally(LiquidationMode.Simple, () => checkMarketIdList('OWED_PREFERENCES', 1));
checkDuration('RISK_PARAMS_POLL_INTERVAL_MS', 1000);
checkDuration('SEQUENTIAL_TRANSACTION_DELAY_MS', 10);
checkExists('SUBGRAPH_URL');

if (!Number.isNaN(Number(process.env.AUTO_DOWN_FREQUENCY_SECONDS))) {
  Logger.info(`Setting auto kill in ${process.env.AUTO_DOWN_FREQUENCY_SECONDS} seconds...`);
  setTimeout(() => {
    Logger.info('Killing bot now!');
    process.exit(0);
  }, Number(process.env.AUTO_DOWN_FREQUENCY_SECONDS) * 1000);
}

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore);
  const accountStore = new AccountStore(blockStore, marketStore);
  const asyncActionStore = new AsyncActionStore(blockStore);
  const asyncActionRetryStore = new AsyncActionRetryStore();
  const balanceStore = new BalanceStore(marketStore);
  const liquidationStore = new LiquidationStore();
  const riskParamsStore = new RiskParamsStore(blockStore);
  const dolomiteLiquidator = new DolomiteLiquidator(
    accountStore,
    asyncActionStore,
    asyncActionRetryStore,
    blockStore,
    marketStore,
    balanceStore,
    liquidationStore,
    riskParamsStore,
  );
  const gasPriceUpdater = new GasPriceUpdater();
  const liquidationMode = getLiquidationMode();

  await loadAccounts();

  const { blockNumber: subgraphBlockNumber } = await getSubgraphBlockNumber();
  const { riskParams } = await getDolomiteRiskParams(subgraphBlockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address
  if (riskParams.dolomiteMargin !== libraryDolomiteMargin) {
    const message = `Invalid dolomite margin address found!\n
    { network: ${riskParams.dolomiteMargin} library: ${libraryDolomiteMargin} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
    accountWalletAddress: process.env.ACCOUNT_WALLET_ADDRESS,
    asyncActionsEnabled: process.env.ASYNC_ACTIONS_ENABLED,
    asyncActionsKeyExpirationSeconds: process.env.ASYNC_ACTIONS_KEY_EXPIRATION_SECONDS,
    dolomiteAccountNumber: process.env.DOLOMITE_ACCOUNT_NUMBER,
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    expirationsEnabled: process.env.EXPIRATIONS_ENABLED,
    expiredAccountDelaySeconds: process.env.EXPIRED_ACCOUNT_DELAY_SECONDS,
    expiry: dolomite.contracts.expiry.options.address,
    gasPriceMultiplier: process.env.GAS_PRICE_MULTIPLIER,
    gasPriceAddition: process.env.GAS_PRICE_ADDITION,
    gasSpikeProtection: process.env.GAS_SPIKE_PROTECTION,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignoredMarkets: process.env.IGNORED_MARKETS?.split(',').map(m => parseInt(m, 10)) ?? [],
    initialGasPriceWei: process.env.INITIAL_GAS_PRICE_WEI,
    liquidationKeyExpirationSeconds: process.env.LIQUIDATION_KEY_EXPIRATION_SECONDS,
    liquidationMode,
    liquidationsEnabled: process.env.LIQUIDATIONS_ENABLED,
    minValueLiquidated: process.env.MIN_VALUE_LIQUIDATED,
    minValueLiquidatedForExternalSell: process.env.MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL,
    networkId,
    sequentialTransactionDelayMillis: process.env.SEQUENTIAL_TRANSACTION_DELAY_MS,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  Logger.info({
    message: 'Polling intervals',
    accountPollIntervalMillis: process.env.ACCOUNT_POLL_INTERVAL_MS,
    asyncActionPollIntervalMillis: process.env.ASYNC_ACTIONS_POLL_INTERVAL_MS,
    blockPollIntervalMillis: process.env.BLOCK_POLL_INTERVAL_MS,
    gasPricePollInterval: process.env.GAS_PRICE_POLL_INTERVAL_MS,
    liquidatePollIntervalMillis: process.env.LIQUIDATE_POLL_INTERVAL_MS,
    marketPollIntervalMillis: process.env.MARKET_POLL_INTERVAL_MS,
    riskParamsPollIntervalMillis: process.env.RISK_PARAMS_POLL_INTERVAL_MS,
  });

  Logger.info({
    message: 'Isolation mode assets',
    data: Object.keys(ISOLATION_MODE_CONVERSION_MARKET_ID_MAP[networkId]),
  });

  if (liquidationMode === LiquidationMode.Simple) {
    Logger.info({
      liquidationMode,
      message: 'Simple liquidation variables',
      collateralPreferences: process.env.COLLATERAL_PREFERENCES,
      liquidatorProxyV1: dolomite.liquidatorProxyV1.address,
      minAccountCollateralization: process.env.MIN_ACCOUNT_COLLATERALIZATION,
      owedPreferences: process.env.OWED_PREFERENCES,
    });
  } else if (liquidationMode === LiquidationMode.Generic) {
    const liquidatorProxyV5Address = liquidatorProxyV5.options.address;
    const isGlobalOperator = await dolomite.getters.getIsGlobalOperator(liquidatorProxyV5Address);
    Logger.info({
      liquidationMode,
      message: 'Generic liquidation mode variables:',
      liquidatorProxyV5: liquidatorProxyV5Address,
      liquidatorProxyV5IsGlobalOperator: isGlobalOperator,
    });
    if (!isGlobalOperator) {
      throw new Error(`Liquidator proxy v5 is not global operator: ${liquidatorProxyV5Address}`);
    }
  } else {
    throw new Error(`Invalid liquidation mode: ${liquidationMode}`);
  }

  if (process.env.LIQUIDATIONS_ENABLED === 'true') {
    await initializeDolomiteLiquidations();
  }

  // Star the block store and wait to finish the first round of polling
  blockStore.start();
  await sleep(Number(process.env.BLOCK_POLL_INTERVAL_MS));

  marketStore.start();
  balanceStore.start();
  accountStore.start();
  riskParamsStore.start();
  gasPriceUpdater.start();

  if (process.env.ASYNC_ACTIONS_ENABLED === 'true') {
    asyncActionStore.start();
  }

  if (
    process.env.LIQUIDATIONS_ENABLED === 'true'
    || process.env.EXPIRATIONS_ENABLED === 'true'
    || process.env.ASYNC_ACTIONS_ENABLED === 'true'
  ) {
    dolomiteLiquidator.start();
  }
  return true
}

start().catch(error => {
  Logger.error({
    message: `Found error while starting: ${error.toString()}`,
    error: JSON.stringify(error),
  })
  process.exit(1)
});
