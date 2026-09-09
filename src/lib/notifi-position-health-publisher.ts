import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';
import {
  logInToNotifi,
  NotifiAuthorization,
  NotifiFusionMessage,
  publishNotifiFusionMessages,
} from '../clients/notifi';
import AccountStore from '../stores/account-store';
import MarketStore from '../stores/market-store';
import RiskParamsStore from '../stores/risk-params-store';
import { NETWORK_ID } from './constants';
import { delay } from './delay';
import Logger from './logger';
import { chunkArray, getAccountHealthFactor } from './utils';

/** Number of events sent to Notifi per request */
const PUBLISH_BATCH_SIZE = 100;

/** Log in again this long before the current token expires, so no batch is sent with a token about to lapse */
const TOKEN_EXPIRY_BUFFER_MINUTES = 5;

/** Health factors are published rounded down to this many places, matching how the Dolomite interface shows them */
const HEALTH_FACTOR_DECIMAL_PLACES = 2;

interface PositionHealth {
  /** `<owner>-<accountNumber>`, the same key the Dolomite interface subscribes with */
  positionId: string;
  healthFactor: Decimal;
}

/**
 * Publishes the health factor of every open position to Notifi's "Position Health" topic. Users subscribe to a
 * position in the Dolomite interface with a threshold of their choosing, and Notifi compares each published value
 * against those subscriptions, notifying whoever's threshold the position fell below. The publisher is stateless as a
 * result: it knows neither who subscribed nor at what level.
 *
 * The topic is not throttled on Notifi's side, so `NOTIFI_PUBLISH_INTERVAL_MS` is also how often a user whose position
 * stays below their threshold is notified. Publishes are aligned to the wall clock (see `_poll`) so that restarting the
 * bot, including the `AUTO_DOWN_FREQUENCY_SECONDS` self-restart, never adds a round.
 */
export default class NotifiPositionHealthPublisher {
  private authorization: NotifiAuthorization | undefined;

  constructor(
    private readonly accountStore: AccountStore,
    private readonly marketStore: MarketStore,
    private readonly riskParamsStore: RiskParamsStore,
  ) {
  }

  static toFusionMessage({ positionId, healthFactor }: PositionHealth): NotifiFusionMessage {
    return {
      eventTypeId: process.env.NOTIFI_POSITION_HEALTH_EVENT_TYPE_ID,
      variablesJson: {
        // Available to the topic's message template
        chainId: NETWORK_ID,
        positionId,
        healthFactor: healthFactor.toFixed(HEALTH_FACTOR_DECIMAL_PLACES),
        // Matched against each subscriber's alert. The threshold is typed as a decimal on the topic and Notifi drops
        // events whose value type does not match, so this must stay a number
        filterVariables: {
          subscription: {
            value: positionId,
            isCaseSensitive: false,
          },
          belowThreshold: {
            thresholdComparisonValue: healthFactor.toNumber(),
          },
        },
      },
    };
  }

  start = () => {
    Logger.info({
      at: 'NotifiPositionHealthPublisher#start',
      message: 'Starting Notifi position health publisher',
    });
    this._poll();
  };

  /**
   * Publishes at wall-clock multiples of `NOTIFI_PUBLISH_INTERVAL_MS` (on the hour with the default) rather than on a
   * timer started at boot. Whichever process is alive at a boundary publishes once, and a process that starts
   * mid-interval waits for the next boundary, so a restart never alerts everyone under their threshold a second time.
   */
  _poll = async () => {
    const intervalMillis = Number(process.env.NOTIFI_PUBLISH_INTERVAL_MS);
    // The interval the bot started in counts as already published
    let lastPublishedInterval = Math.floor(Date.now() / intervalMillis);

    // noinspection InfiniteLoopJS
    for (; ;) {
      await delay(Math.max((lastPublishedInterval + 1) * intervalMillis - Date.now(), 0));

      const currentInterval = Math.floor(Date.now() / intervalMillis);
      if (currentInterval !== lastPublishedInterval) {
        try {
          // Right after a restart the stores may still be loading; keep trying until they are
          while (!(await this._publish())) {
            await delay(Number(process.env.ACCOUNT_POLL_INTERVAL_MS));
          }
        } catch (error: any) {
          Logger.error({
            at: 'NotifiPositionHealthPublisher#_poll',
            message: error.message,
            error,
          });
        }
        lastPublishedInterval = currentInterval;
      }
    }
  };

  /**
   * @return `true` once the stores are initialized and publishing was attempted, `false` if there was nothing to do yet
   */
  _publish = async (): Promise<boolean> => {
    const riskParams = this.riskParamsStore.getDolomiteRiskParams();
    if (!riskParams) {
      Logger.warn({
        at: 'NotifiPositionHealthPublisher#_publish',
        message: 'Risk params from RiskParamsStore are not initialized yet, returning...',
      });
      return false;
    }

    const marketMap = this.marketStore.getMarketMap();
    if (Object.keys(marketMap).length === 0) {
      Logger.warn({
        at: 'NotifiPositionHealthPublisher#_publish',
        message: 'Markets from MarketStore are not initialized yet, returning...',
      });
      return false;
    }

    const accounts = this.accountStore.getLiquidatableDolomiteAccounts();
    if (accounts.length === 0) {
      Logger.warn({
        at: 'NotifiPositionHealthPublisher#_publish',
        message: 'Accounts from AccountStore are not initialized yet, returning...',
      });
      return false;
    }

    const positionHealths = accounts.reduce<PositionHealth[]>((memo, account) => {
      // Account number 0 is the user's Dolomite Balance, which the interface does not treat as a position
      if (account.number.isZero()) {
        return memo;
      }

      const healthFactor = getAccountHealthFactor(account, marketMap, riskParams);
      if (healthFactor) {
        memo.push({
          positionId: account.id,
          healthFactor: healthFactor.decimalPlaces(HEALTH_FACTOR_DECIMAL_PLACES, BigNumber.ROUND_DOWN),
        });
      }
      return memo;
    }, []);

    Logger.info({
      at: 'NotifiPositionHealthPublisher#_publish',
      message: `Publishing the health factor of ${positionHealths.length} positions to Notifi...`,
    });

    const batches = chunkArray(positionHealths, PUBLISH_BATCH_SIZE);
    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      const positions = batch.map(p => `${p.positionId}: ${p.healthFactor.toFixed(HEALTH_FACTOR_DECIMAL_PLACES)}`);
      try {
        const token = await this._getToken();
        const { indexToResultIdMap } = await publishNotifiFusionMessages(
          token,
          batch.map(NotifiPositionHealthPublisher.toFusionMessage),
        );
        Logger.info({
          at: 'NotifiPositionHealthPublisher#_publish',
          message: `Published batch ${i + 1} of ${batches.length} to Notifi`,
          accepted: `${Object.keys(indexToResultIdMap).length} of ${batch.length}`,
          positions,
        });
      } catch (error: any) {
        // Drop the token too: if Notifi rejected it, the next attempt logs in again rather than failing the same way
        this.authorization = undefined;
        Logger.error({
          at: 'NotifiPositionHealthPublisher#_publish',
          message: `Failed to publish batch ${i + 1} of ${batches.length} to Notifi`,
          error,
          positions,
        });
      }
    }

    Logger.info({
      at: 'NotifiPositionHealthPublisher#_publish',
      message: 'Finished publishing position health to Notifi',
    });
    return true;
  };

  _getToken = async (): Promise<string> => {
    const expiryThresholdMillis = DateTime.utc().plus({ minutes: TOKEN_EXPIRY_BUFFER_MINUTES }).toMillis();
    if (!this.authorization || DateTime.fromISO(this.authorization.expiry).toMillis() <= expiryThresholdMillis) {
      this.authorization = await logInToNotifi(process.env.NOTIFI_SID, process.env.NOTIFI_SECRET);
      Logger.info({
        at: 'NotifiPositionHealthPublisher#_getToken',
        message: 'Logged in to Notifi',
        expiry: this.authorization.expiry,
      });
    }

    return this.authorization.token;
  };
}
