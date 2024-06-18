import { AmountDenomination, AmountReference, BigNumber, ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import { INTEGERS } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Constants';
import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import v8 from 'v8';
import { getDolomiteRiskParams } from '../src/clients/dolomite';
import { getGasPriceWei, updateGasPrice } from '../src/helpers/gas-price-helpers';
import { dolomite, loadAccounts } from '../src/helpers/web3';
import { ApiAccount, ApiBalance } from '../src/lib/api-types';
import '../src/lib/env';
import Logger from '../src/lib/logger';
import AccountStore from '../src/stores/account-store';
import BlockStore from '../src/stores/block-store';
import MarketStore from '../src/stores/market-store';

const SMALL_BORROW_THRESHOLD = new BigNumber('0.01');

const TEN = new BigNumber('10');

const TICKERS_TO_IGNORE = ['djUSDC'];

const MARGIN_PREMIUM_BASE = new BigNumber('1000000000000000000');
const MARGIN_PREMIUM_SPECULATIVE = undefined;
// const MARGIN_PREMIUM_SPECULATIVE = new BigNumber('86956521739130434'); // 125% collateralization
// const MARGIN_PREMIUM_SPECULATIVE = new BigNumber('156521739130434782'); // 133% collateralization
// const MARGIN_PREMIUM_SPECULATIVE = new BigNumber('304347826086956521'); // 150% collateralization

const ONE_DOLLAR = new BigNumber(10).pow(36);

function formatApiBalance(balance: ApiBalance): string {
  return `${balance.wei.div(TEN.pow(balance.tokenDecimals)).toFixed(6)} ${balance.tokenSymbol}`;
}

function shouldIgnoreAccount(account: ApiAccount): boolean {
  return Object.values(account.balances).some(b => TICKERS_TO_IGNORE.includes(b.tokenSymbol));
}

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore);
  const accountStore = new AccountStore(blockStore, marketStore);

  await blockStore._update();

  const blockNumber = blockStore.getBlockNumber()!;
  const { riskParams } = await getDolomiteRiskParams(blockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
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
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignoredMarkets: process.env.IGNORED_MARKETS?.split(',').map(m => parseInt(m, 10)) ?? [],
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();
  await accountStore._update();
  await updateGasPrice(dolomite);

  Logger.info({
    message: 'Finished updating accounts and markets',
  });

  const marketMap = marketStore.getMarketMap();

  // These accounts are not actually liquidatable, but rather accounts that have ANY debt.
  const accounts = accountStore.getLiquidatableDolomiteAccounts();

  let smallLiquidBorrowCount = 0;
  let smallAlmostLiquidBorrowCount = 0;
  const liquidAccounts: any[] = [];
  const totalAccountsWithBadDebt = [] as (ApiAccount & { borrow: BigNumber; supply: BigNumber; })[];
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const initial = {
      borrow: INTEGERS.ZERO,
      supply: INTEGERS.ZERO,
      borrowAdj: INTEGERS.ZERO,
      supplyAdj: INTEGERS.ZERO,
    };
    const {
      supply,
      borrow,
      supplyAdj,
      borrowAdj,
    } = Object.values(account.balances)
      .reduce((acc, balance) => {
        const market = marketMap[balance.marketId.toString()];
        const value = balance.wei.times(market.oraclePrice).div(ONE_DOLLAR);
        const adjust = MARGIN_PREMIUM_BASE.plus(
          (market.marketId === 30 && MARGIN_PREMIUM_SPECULATIVE) ? MARGIN_PREMIUM_SPECULATIVE : market.marginPremium,
        );
        if (balance.wei.lt(INTEGERS.ZERO)) {
          // increase the borrow size by the premium
          acc.borrow = acc.borrow.plus(value.abs());
          acc.borrowAdj = acc.borrowAdj.plus(value.abs().times(adjust).div(MARGIN_PREMIUM_BASE));
        } else {
          // decrease the supply size by the premium
          acc.supply = acc.supply.plus(value);
          acc.supplyAdj = acc.supplyAdj.plus(value.times(MARGIN_PREMIUM_BASE).div(adjust));
        }
        return acc;
      }, initial);

    if (borrow.gt(supply)) {
      if (borrow.gt(SMALL_BORROW_THRESHOLD)) {
        Logger.warn({
          message: 'Found bad debt for more than $0.01',
          account: account.id,
          markets: Object.values(account.balances).map(b => [b.marketId.toFixed(), b.wei.toFixed()]),
          supplyUSD: supply.toFixed(6),
          borrowUSD: borrow.toFixed(6),
        });

        if (process.env.VAPORIZE_EXCESS === 'true') {
          await loadAccounts();
          const vaporMarket = Object.values(account.balances).find(b => b.wei.lt(INTEGERS.ZERO));
          const txResult = await dolomite.operation.initiate()
            .vaporize({
              primaryAccountOwner: dolomite.getDefaultAccount(),
              primaryAccountId: INTEGERS.ZERO,
              vaporAccountOwner: account.owner,
              vaporAccountId: account.number,
              vaporMarketId: new BigNumber(vaporMarket!.marketId),
              payoutMarketId: new BigNumber(vaporMarket!.marketId !== 0 ? 0 : 2),
              amount: {
                value: INTEGERS.ZERO,
                denomination: AmountDenomination.Principal,
                reference: AmountReference.Target,
              },
            })
            .commit({
              gasPrice: getGasPriceWei().toFixed(),
              confirmationType: ConfirmationType.Hash,
            });

          Logger.info({
            message: 'Vaporization transaction hash:',
            transactionHash: txResult.transactionHash,
          });

          await sleep(3_000);
        }
      }

      totalAccountsWithBadDebt.push({
        ...account,
        borrow,
        supply,
      });
    } else if (borrowAdj.times('1.15').gt(supplyAdj) && !shouldIgnoreAccount(account)) {
      if (borrowAdj.lt(SMALL_BORROW_THRESHOLD)) {
        smallLiquidBorrowCount += 1;
      } else {
        liquidAccounts.push({
          ...account,
          supplyUSD: supply,
          borrowUSD: borrow,
        });
      }
    } else if (borrowAdj.times('1.155').gt(supplyAdj) && !shouldIgnoreAccount(account)) {
      if (borrowAdj.lt(SMALL_BORROW_THRESHOLD)) {
        smallAlmostLiquidBorrowCount += 1;
      } else {
        Logger.info({
          message: 'Found almost liquid account!',
          account: account.id,
          markets: Object.values(account.balances).map(formatApiBalance),
          supplyUSD: supply.toFixed(6),
          borrowUSD: borrow.toFixed(6),
        });
      }
    }
  }

  liquidAccounts.sort((a, b) => (a.borrowUSD.lt(b.borrowUSD) ? 1 : -1)).forEach(account => {
    Logger.warn({
      message: 'Found liquid account!',
      account: account.id,
      markets: Object.values(account.balances as any[]).map(formatApiBalance),
      supplyUSD: account.supplyUSD.toFixed(6),
      borrowUSD: account.borrowUSD.toFixed(6),
    });
  });
  Logger.info({
    message: `Found ${liquidAccounts.length} regular liquidatable accounts`,
  });

  Logger.info({
    message: `Found ${smallLiquidBorrowCount} small liquidatable accounts`,
    smallBorrowThreshold: `$${SMALL_BORROW_THRESHOLD.toFixed(4)}`,
  });

  Logger.info({
    message: `Found ${smallAlmostLiquidBorrowCount} almost liquidatable accounts with small borrow positions`,
    smallBorrowThreshold: `$${SMALL_BORROW_THRESHOLD.toFixed(4)}`,
  });

  if (totalAccountsWithBadDebt.length === 0) {
    Logger.info({
      message: `No bad debt found across ${accounts.length} active margin accounts!`,
    });
  } else {
    Logger.info({
      accountsWithBadDebtLength: totalAccountsWithBadDebt.length,
      totalBadDebt: totalAccountsWithBadDebt.reduce(
        (memo, account) => memo.plus(account.supply.minus(account.borrow)),
        INTEGERS.ZERO,
      ).toFixed(),
    });
  }

  return true;
}

start().catch(error => {
  console.error(`Found error while starting: ${error.toString()}`, error);
  process.exit(1);
});
