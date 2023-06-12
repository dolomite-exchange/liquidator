// declare global env variable to define types
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      ACCOUNT_POLL_INTERVAL_MS
      ACCOUNT_WALLET_ADDRESS
      ACCOUNT_WALLET_PRIVATE_KEY
      AUTO_SELL_COLLATERAL
      BRIDGE_TOKEN_ADDRESS
      COLLATERAL_PREFERENCES
      DOLOMITE_ACCOUNT_NUMBER
      ETHEREUM_NODE_URL
      EXPIRATIONS_ENABLED
      EXPIRED_ACCOUNT_DELAY_SECONDS
      GAS_PRICE_ADDITION
      GAS_PRICE_MULTIPLIER
      GAS_PRICE_POLL_INTERVAL_MS
      INITIAL_GAS_PRICE_WEI
      LIQUIDATE_POLL_INTERVAL_MS
      LIQUIDATION_KEY_EXPIRATION_SECONDS
      LIQUIDATION_MODE
      LIQUIDATIONS_ENABLED
      MARKET_POLL_INTERVAL_MS
      MIN_ACCOUNT_COLLATERALIZATION
      MIN_VALUE_LIQUIDATED
      MIN_VALUE_LIQUIDATED_FOR_EXTERNAL_SELL
      MIN_OWED_OUTPUT_AMOUNT_DISCOUNT
      NETWORK_ID
      OWED_PREFERENCES
      REVERT_ON_FAIL_TO_SELL_COLLATERAL
      RISK_PARAMS_POLL_INTERVAL_MS
      SEQUENTIAL_TRANSACTION_DELAY_MS
      SUBGRAPH_URL
    }
  }
}

export { };
