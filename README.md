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
  -e COLLATERAL_PREFERENCES=<SET IF LIQUIDATION_MODE IS `Simple`; IE "COLLATERAL_PREFERENCES=0,1,2"> \
  -e DOLOMITE_ACCOUNT_NUMBER=0 \
  -e ETHEREUM_NODE_URL=https://matic-mumbai.chainstacklabs.com \
  -e LIQUIDATION_MODE=Simple|Generic \
  -e NETWORK_ID=80001 \
  -e OWED_PREFERENCES=<SET IF LIQUIDATION_MODE IS `Simple`; IE "OWED_PREFERENCES=2,1,0"> \
  -e SEQUENTIAL_TRANSACTION_DELAY_MS=1000 \
  -e SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/dolomite-exchange/dolomite-v2-liquidator-mumbai \
  dolomiteprotocol/liquidator
```

## Overview

This service will automatically liquidate undercollateralized and/or expired accounts on Dolomite.

This bot works for Dolomite (Margin-Trading) accounts. Use the envvars `LIQUIDATIONS_ENABLED`, `ASYNC_ACTIONS_ENABLED`,
and `EXPIRATIONS_ENABLED` to control what kind of liquidations to perform.

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

| ENV Variable                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                   |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ACCOUNT_POLL_INTERVAL_MS              | How frequently to poll for liquidatable accounts. Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                                                                                            |
| ACCOUNT_WALLET_ADDRESS                | **REQUIRED** Ethereum address of the Dolomite account owner that will do the liquidations.                                                                                                                                                                                                                                                                                                                                    |
| ACCOUNT_WALLET_PRIVATE_KEY            | **REQUIRED** Ethereum private key the Dolomite account owner that will do the liquidations. Make sure that "0x" is at the start of it (MetaMask exports private keys without it).                                                                                                                                                                                                                                             |
| ASYNC_ACTIONS_ENABLED                 | Whether to perform async liquidations for protocols like GMX V2. Defaults to `false`.                                                                                                                                                                                                                                                                                                                                         |
| ASYNC_ACTIONS_KEY_EXPIRATION_SECONDS  | Amount of time in seconds to wait before trying to retry an async action again. Defaults to `60` seconds.                                                                                                                                                                                                                                                                                                                     |
| ASYNC_ACTIONS_POLL_INTERVAL_MS        | How frequently to poll for retryable async actions. Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                                                                                          |
| AUTO_DOWN_FREQUENCY_SECONDS           | The duration in seconds after the bot starts that it should be automatically killed, so AWS (or whichever cloud provider being used) can restart the docker container. Useful in case the bot ever gets stuck. Defaults none `undefined`.                                                                                                                                                                                     |
| BALANCE_POLL_INTERVAL_MS              | How frequently to poll for the latest balance data from the protocol for processing liquidations. Defaults to `60000` milliseconds.                                                                                                                                                                                                                                                                                           |
| BLOCK_POLL_INTERVAL_MS                | How frequently to poll for the latest block number. Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                                                                                          |
| COLLATERAL_PREFERENCES                | **CONDITIONALLY REQUIRED** A list of preferences for which collateral markets to receive first when liquidating. This variable is only required if `LIQUIDATION_MODE` is set to `Simple`. For example `1,2,4` (a string separated by commas)                                                                                                                                                                                  |
| DOLOMITE_ACCOUNT_NUMBER               | **REQUIRED** The Dolomite account number to use for the liquidating account. If you're not sure what this is, use 0. This will show up on [app.dolomite.io](https://app.dolomite.io) if you connect with the same wallet.                                                                                                                                                                                                     |
| ETHEREUM_NODE_URL                     | **REQUIRED** The URL of the Ethereum node to use (e.g. an [Alchemy](https://alchemy.com) or [Infura](https://infura.io/) endpoint).                                                                                                                                                                                                                                                                                           |
| EXPIRATIONS_ENABLED                   | Whether to liquidate expired accounts. Defaults to `true`.                                                                                                                                                                                                                                                                                                                                                                    |
| EXPIRED_ACCOUNT_DELAY_SECONDS         | How long to wait before liquidating expired accounts. The spread for liquidating expired accounts ramps up linearly from 0% to 5% over 5 minutes on Arbitrum One. Defaults to `300` seconds.                                                                                                                                                                                                                                  |
| GAS_PRICE_ADDITION_WEI                | How much to add to the gas price when sending transactions. This value is added after the `GAS_PRICE_MULTIPLIER` is applied. Defaults to `0` but it is recommended users set this variable to something higher.                                                                                                                                                                                                               |
| GAS_PRICE_MULTIPLIER                  | How much to multiply the `fast` gas price by when sending transactions. Defaults to `1` but it is recommended users set this variable to something higher.                                                                                                                                                                                                                                                                    |
| GAS_PRICE_POLL_INTERVAL_MS            | How frequently to update the gas price. Defaults to `15000` milliseconds.                                                                                                                                                                                                                                                                                                                                                     |
| GAS_SPIKE_PROTECTION                  | Whether to skip liquidations whose reward is less than the fee needed to submit the transaction. Defaults to `true`.                                                                                                                                                                                                                                                                                                          |
| GAS_SPIKE_THRESHOLD_USD               | The threshold that a gas spike check is no longer ignored. Defaults to `100000000000000000000000000000000000` ($0.10). Meaning, unprofitable liquidations will only be ignored when gas rises past $0.10                                                                                                                                                                                                                      |
| GLV_LIQUIDITY_POLL_ENABLED            | Whether to track each GLV asset's GM liquidity. Defaults to `false`. Must have permission to update them onchain.                                                                                                                                                                                                                                                                                                             |
| GLV_LIQUIDITY_POLL_INTERVAL_MS        | The time between pings for checking if GLV markets need to have their deposit/withdrawal GM market changed. Defaults to `15000` (15 seconds)                                                                                                                                                                                                                                                                                  |
| IGNORED_MARKETS                       | Any position containing these markets will be ignored. Defaults to nothing (an empty list).  An example list is `1,2,4` (a string of market IDs separated by commas)                                                                                                                                                                                                                                                          |
| INITIAL_GAS_PRICE_WEI                 | The initial gas price used by the bot until the first successful poll occurs. Defaults to `10000000000` wei (10 gwei).                                                                                                                                                                                                                                                                                                        |
| LIQUIDATE_POLL_INTERVAL_MS            | How frequently the bot should use current account, price, and market index data to check for liquidatable accounts and, if necessary, commit any liquidations on-chain. Defaults to `5000` milliseconds.                                                                                                                                                                                                                      |
| LIQUIDATION_KEY_EXPIRATION_SECONDS    | Amount of time in seconds to wait before trying to liquidate the same account again. Defaults to `60` seconds.                                                                                                                                                                                                                                                                                                                |
| LIQUIDATION_MODE                      | **REQUIRED** Must be one of `Simple`, `SellWithInternalLiquidity`, or `Generic`. `Simple` performs liquidations from the solid account and leaves the debt in there. `SellWithInternalLiquidity` attempts the liquidation using Dolomite's internal liquidity. `Generic` uses any combination of external or internal liquidity to perform the liquidations.                                                                  |
| LIQUIDATIONS_ENABLED                  | Whether to liquidate Dolomite accounts or not. Defaults to `true`.                                                                                                                                                                                                                                                                                                                                                            |
| MARKET_POLL_INTERVAL_MS               | How frequently to market information (including which markets exist, oracle prices, and margin premium information). Defaults to `5000` milliseconds.                                                                                                                                                                                                                                                                         |
| MIN_ACCOUNT_COLLATERALIZATION         | The desired minimum collateralization of the liquidator account after completing a *simple* liquidation. Prevents the liquidator account from being at risk of being liquidated itself if the price of assets continues to move in some direction. Higher values are safer. e.g. 0.5 = 150% collateralization. This value is only used if `LIQUIDATION_MODE` is set to `Simple`. Defaults to `0.50` (150% collateralization). |
| MIN_VALUE_LIQUIDATED                  | The minimum amount of debt required for a liquidation to be processed. Defaults to `1000000000000000000000000000000000` ($0.001 USD).                                                                                                                                                                                                                                                                                         |
| MIN_VALUE_LIQUIDATED_FOR_GENERIC_SELL | If the amount to be liquidated for `LIQUIDATION_MODE=SellWithInternalLiquidity\|Generic` is less than this amount, fallback to `LIQUIDATION_MODE=Simple`. Defaults to `1000000000000000000000000000000000000` (0.1e36; $0.1 USD).                                                                                                                                                                                             |
| NETWORK_ID                            | **REQUIRED** Ethereum Network ID. This must match the chain ID sent back from `ETHEREUM_NODE_URL`.                                                                                                                                                                                                                                                                                                                            |
| OWED_PREFERENCES                      | **CONDITIONALLY REQUIRED** A list of preferences for which markets to liquidate first on an account when liquidating.  This variable is only required if `LIQUIDATION_MODE` is set to `Simple`.                                                                                                                                                                                                                               |
| RISK_PARAMS_POLL_INTERVAL_MS          | How frequently to poll for risk params updates in milliseconds. Defaults to `30000` milliseconds.                                                                                                                                                                                                                                                                                                                             |
| SEQUENTIAL_TRANSACTION_DELAY_MS       | **REQUIRED** How long to wait between sending liquidation/expiration transactions. Useful for ensuring the liquidator's nonce is always correct and the Dolomite market price has time to reach equilibrium between many sequential liquidations, in case these sequential liquidations push the price far away from the Chainlink oracle price.                                                                              |
| SUBGRAPH_URL                          | **REQUIRED** The URL of the subgraph instance that contains margin account information. For Arbitrum One, the default URL is `https://api.thegraph.com/subgraphs/name/dolomite-exchange/dolomite-v2-arbitrum`                                                                                                                                                                                                                 |
