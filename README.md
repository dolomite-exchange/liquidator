<p style="text-align: center"><img src="https://github.com/dolomite-exchange/dolomite-margin/raw/master/docs/dolomite-logo.png" width="256" alt="Dolomite Logo" /></p>

<div style="text-align: center">
  <a href='https://hub.docker.com/r/dolomiteprotocol/liquidator' style="text-decoration:none;">
    <img src='https://img.shields.io/badge/docker-container-blue.svg?longCache=true' alt='Docker' />
  </a>
  <a href='https://coveralls.io/github/dolomite-exchange/liquidator' style="text-decoration:none;">
    <img src='https://coveralls.io/repos/github/dolomite-exchange/liquidator/badge.svg?t=toKMwT' alt='Coverage Status' />
  </a>
  <a href='https://github.com/dolomite-exchange/liquidator/blob/master/LICENSE' style="text-decoration:none;">
    <img src='https://img.shields.io/github/license/dolomite-exchange/liquidator.svg?longCache=true' alt='License' />
  </a>
  <a href='https://t.me/official' style="text-decoration:none;">
    <img src='https://img.shields.io/badge/chat-on%20telegram-9cf.svg?longCache=true' alt='Telegram' />
  </a>
</div>

# Dolomite Margin Liquidator

Bot to automatically liquidate undercollateralized and expired Dolomite accounts.

## Usage

### Docker

Requires a running [docker](https://docker.com) engine.

```
docker run \
  -e ACCOUNT_WALLET_ADDRESS=0x2c7536E3605D9C16a7a3D7b1898e529396a65c23 \
  -e ACCOUNT_WALLET_PRIVATE_KEY=0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318 \
  -e BRIDGE_TOKEN_ADDRESS=<WETH_ADDRESS> \
  -e COLLATERAL_PREFERENCES=<SET IF LIQUIDATION_MODE IS `Simple`; IE "COLLATERAL_PREFERENCES=0,1,2"> \
  -e DOLOMITE_ACCOUNT_NUMBER=0 \
  -e ETHEREUM_NODE_URL=https://matic-mumbai.chainstacklabs.com \
  -e LIQUIDATION_MODE=Simple|SellWithInternalLiquidity|SellWithExternalLiquidity \
  -e NETWORK_ID=80001 \
  -e OWED_PREFERENCES=<SET IF LIQUIDATION_MODE IS `Simple`; IE "OWED_PREFERENCES=2,1,0"> \
  -e REVERT_ON_FAIL_TO_SELL_COLLATERAL=<SET IF LIQUIDATION_MODE IS `SellWithInternalLiquidity`; IE "REVERT_ON_FAIL_TO_SELL_COLLATERAL=true|false"> \
  -e SEQUENTIAL_TRANSACTION_DELAY_MS=1000 \
  -e SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/dolomite-exchange/dolomite-v2-liquidator-mumbai \
  dolomiteprotocol/liquidator
```

## Overview

This service will automatically liquidate undercollateralized and/or expired accounts on Dolomite.

This bot works for Dolomite (Margin-Trading) accounts. Use the envvars `LIQUIDATIONS_ENABLED`, 
`EXPIRATIONS_ENABLED` to control what kind of liquidations to perform.

**Liquidations on Dolomite happen internally between Accounts, so you will need an already-funded Dolomite Account to 
use this liquidator bot. If you use the default of `DOLOMITE_ACCOUNT_NUMBER=0`, you can fund your Dolomite Margin
Account on [app.dolomite.io](https://app.dolomite.io).**

Successfully liquidating Accounts will modify your Dolomite Account balances. You can liquidate assets you do not have 
in your Account provided you have another asset as collateral, which will just cause your Dolomite Account Balance to 
go negative in that asset.

### Dolomite Liquidations
Liquidations on Dolomite reward a 5% spread on top of the current oracle prices for the assets being liquidated and 
used as collateral. Example:

Undercollateralized Account:
```
+2 ETH
-350 DAI
```

Liquidator Account:
```
+100 ETH
-1000 DAI
```

Oracle Prices:
```
ETH Oracle Price: $200
DAI Oracle Price: $1
```

Fully liquidating this account would cause 350 DAI to be paid to zero out its balance, and would reward 
`350 DAI * ($1/DAI / $200/ETH) * 1.05 = 1.8375 ETH` as payout. After the liquidation the account balances would be:


Undercollateralized Account:
```
+0.1625 ETH
0 DAI
```

Liquidator Account:
```
+101.8375 ETH
-1350 DAI
```

## Configuration

### Environment Variables

| ENV Variable                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
|----------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ACCOUNT_POLL_INTERVAL_MS               | How frequently to poll for liquidatable accounts. Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ACCOUNT_WALLET_ADDRESS                 | **REQUIRED** Ethereum address of the Dolomite account owner that will do the liquidations.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ACCOUNT_WALLET_PRIVATE_KEY             | **REQUIRED** Ethereum private key the Dolomite account owner that will do the liquidations. Make sure that "0x" is at the start of it (MetaMask exports private keys without it).                                                                                                                                                                                                                                                                                                                                         |
| AUTO_DOWN_FREQUENCY_SECONDS            | The duration in seconds after the bot starts that it should be automatically killed, so AWS (or whichever cloud provider being used) can restart the docker container. Useful in case the bot ever gets stuck. Defaults none `undefined`.                                                                                                                                                                                                                                                                                 |
| BRIDGE_TOKEN_ADDRESS                   | **REQUIRED** The address of the bridge currency used as connecting asset to sell collateral for the debt token. On most Ethereum-based networks, this will be the WETH address. Meaning, Trades from LRC --> USDC are instead routed as such LRC --> WETH --> USDC.                                                                                                                                                                                                                                                       |
| COLLATERAL_PREFERENCES                 | **CONDITIONALLY REQUIRED** A list of preferences for which collateral markets to receive first when liquidating. This variable is only required if `LIQUIDATION_MODE` is set to `Simple`.                                                                                                                                                                                                                                                                                                                                 |
| DOLOMITE_ACCOUNT_NUMBER                | **REQUIRED** The Dolomite account number to use for the liquidating account. If you're not sure what this is, use 0. This will show up on [app.dolomite.io](https://app.dolomite.io) if you connect with the same wallet.                                                                                                                                                                                                                                                                                                 |
| ETHEREUM_NODE_URL                      | **REQUIRED** The URL of the Ethereum node to use (e.g. an [Alchemy](https://alchemy.com) or [Infura](https://infura.io/) endpoint).                                                                                                                                                                                                                                                                                                                                                                                       |
| EXPIRATIONS_ENABLED                    | Whether to liquidate expired accounts. Defaults to `true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| EXPIRED_ACCOUNT_DELAY_SECONDS          | How long to wait before liquidating expired accounts. The spread for liquidating expired accounts ramps up linearly from 0% to 5% over 5 minutes on Arbitrum One. Defaults to `300` seconds.                                                                                                                                                                                                                                                                                                                              |
| GAS_PRICE_MULTIPLIER                   | How much to multiply the `fast` gas price by when sending transactions. Defaults to `1` but it is recommended users set this variable to something higher.                                                                                                                                                                                                                                                                                                                                                                |
| GAS_PRICE_POLL_INTERVAL_MS             | How frequently to update the gas price. Defaults to `15000` milliseconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| INITIAL_GAS_PRICE_WEI                  | The initial gas price used by the bot until the first successful poll occurs. Defaults to `10000000000` wei (10 gwei).                                                                                                                                                                                                                                                                                                                                                                                                    |
| LIQUIDATE_POLL_INTERVAL_MS             | How frequently the bot should use current account, price, and market index data to check for liquidatable accounts and, if necessary, commit any liquidations on-chain. Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                                                                  |
| LIQUIDATION_KEY_EXPIRATION_SECONDS     | Amount of time in seconds to wait before trying to liquidate the same account again. Defaults to `120` seconds.                                                                                                                                                                                                                                                                                                                                                                                                           |
| LIQUIDATION_MODE                       | **REQUIRED** Must be one of `Simple`, `SellWithInternalLiquidity`, or `SellWithExternalLiquidity`. `Simple` performs liquidations from the solid account and leaves the debt in there. `SellWithInternalLiquidity` attempts the liquidation using Dolomite's internal liquidity. `SellWithExternalLiquidity` uses external liquidity (Paraswap) to perform the liquidations.                                                                                                                                              |
| LIQUIDATIONS_ENABLED                   | Whether to liquidate Dolomite accounts or not. Defaults to `true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| MARKET_POLL_INTERVAL_MS                | How frequently to market information (including which markets exist, oracle prices, and margin premium information). Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                                                                                                                     |
| MIN_ACCOUNT_COLLATERALIZATION          | The desired minimum collateralization of the liquidator account after completing a *simple* liquidation. Prevents the liquidator account from being at risk of being liquidated itself if the price of assets continues to move in some direction. Higher values are safer. e.g. 0.5 = 150% collateralization. This value is only used if `LIQUIDATION_MODE` is set to `Simple`. Defaults to `0.50` (150% collateralization).                                                                                             |
| MIN_VALUE_LIQUIDATED                   | If you can liquidate less than this amount of value before hitting `MIN_ACCOUNT_COLLATERALIZATION`, then don't liquidate. This value is only used if `LIQUIDATION_MODE` is set to `Simple`. Defaults to `100000000000000000000000000000000000000` (100e36; 100 USD).                                                                                                                                                                                                                                                      |
| MIN_VALUE_LIQUIDATED_FOR_EXTERNAL_SELL | If the amount to be liquidated for `LIQUIDATION_MODE=SellWithExternalLiquidity` is less than this amount, fallback to `LIQUIDATION_MODE=Simple`. Defaults to `1000000000000000000000000000000000000` (0.01e36; 0.01 USD).                                                                                                                                                                                                                                                                                                 |
| MIN_OWED_OUTPUT_AMOUNT_DISCOUNT        | This parameter is only used if `REVERT_ON_FAIL_TO_SELL_COLLATERAL` is set to `false`. A discount to apply on the required output of the trade (from held collateral to owed balance), or else the transaction reverts. Must be less than `1.00` and greater than or equal to `0`. This value is applied to the `minOutputAmount` of the trade from held amount to owed amount such that the outputted trade amount must be greater than or equal to `owedBalance * (1.00 - discount)`. Defaults to `0.10` (10% discount). |
| NETWORK_ID                             | **REQUIRED** Ethereum Network ID. This must match the chain ID sent back from `ETHEREUM_NODE_URL`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| OWED_PREFERENCES                       | **CONDITIONALLY REQUIRED** A list of preferences for which markets to liquidate first on an account when liquidating.  This variable is only required if `LIQUIDATION_MODE` is set to `Simple`.                                                                                                                                                                                                                                                                                                                           |
| REVERT_ON_FAIL_TO_SELL_COLLATERAL      | **CONDITIONALLY REQUIRED** Whether to revert the liquidation if the collateral cannot be sold to pay off the debt. If set to false and collateral cannot be liquidated to recover debt, the user will need to maintain sufficient collateralization to prevent being liquidated. This value is only used if `LIQUIDATION_MODE` is set to `SellWithInternalLiquidity`.                                                                                                                                                     |
| RISK_PARAMS_POLL_INTERVAL_MS           | How frequently to poll for risk params updates in milliseconds. Defaults to `30000` milliseconds.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| SEQUENTIAL_TRANSACTION_DELAY_MS        | **REQUIRED** How long to wait between sending liquidation/expiration transactions. Useful for ensuring the liquidator's nonce is always correct and the Dolomite market price has time to reach equilibrium between many sequential liquidations, in case these sequential liquidations push the price far away from the Chainlink oracle price.                                                                                                                                                                          |
| SUBGRAPH_URL                           | **REQUIRED** The URL of the subgraph instance that contains margin account information. For Arbitrum One, the default URL is `https://api.thegraph.com/subgraphs/name/dolomite-exchange/dolomite-v2-arbitrum`                                                                                                                                                                                                                                                                                                             |
