import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { DateTime } from 'luxon';
import {
  getNotifiActiveAlerts,
  logInToNotifi,
  NotifiAuthorization,
  NotifiFusionMessage,
  NotifiPublishFusionMessageResponse,
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

/** Pause between requests within a round, so a large round trickles in rather than bursts */
const PUBLISH_BATCH_DELAY_MS = 1_000;

/** Log in again this long before the current token expires, so no request is sent with a token about to lapse */
const TOKEN_EXPIRY_BUFFER_MINUTES = 5;

/** Health factors are published rounded down to this many places, matching how the Dolomite interface shows them */
const HEALTH_FACTOR_DECIMAL_PLACES = 2;

interface PositionHealth {
  /** `<owner>-<accountNumber>`, the same key the Dolomite interface subscribes with */
  positionId: string;
  healthFactor: Decimal;
}

interface SendResult {
  response?: NotifiPublishFusionMessageResponse;
  error?: any;
  /** The failure happened while logging in, before anything was sent */
  isLoginError?: boolean;
}

enum BatchResult {
  Published = 'Published',
  /** This batch failed but the next one may succeed */
  Failed = 'Failed',
  /** Notifi asked us to stop, or we cannot log in; the rest of the round would fail the same way */
  Stop = 'Stop',
}

/**
 * Publishes the health factor of subscribed positions to Notifi's "Position Health" topic. Users subscribe to a
 * position in the Dolomite interface with a threshold of their choosing, and Notifi compares each published value
 * against those subscriptions, notifying whoever's threshold the position fell below.
 *
 * Notifi counts every published event against the tenant's monthly notification quota, so each round first asks Notifi
 * which positions have active alerts and publishes only those. The volume of events therefore scales with
 * subscriptions rather than with open positions.
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
      eventTypeId: process.env.NOTIFI_POSITION_HEALTH_EVENT_TYPE_ID!,
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

    const subscribedPositionIds = await this._getSubscribedPositionIds();
    if (!subscribedPositionIds) {
      return true; // the failure was logged; try again next interval
    }
    if (subscribedPositionIds.size === 0) {
      Logger.info({
        at: 'NotifiPositionHealthPublisher#_publish',
        message: 'No positions are subscribed to health alerts on Notifi; nothing to publish',
      });
      return true;
    }

    const positionHealths = accounts.reduce<PositionHealth[]>((memo, account) => {
      // Account number 0 is the user's Dolomite Balance, which the interface does not treat as a position
      if (account.number.isZero() || !subscribedPositionIds.has(account.id)) {
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
      message: `Publishing the health factor of ${positionHealths.length} subscribed positions to Notifi...`,
      // Subscriptions without a matching position belong to positions that were closed or have no debt
      subscriptions: subscribedPositionIds.size,
    });

    const batches = chunkArray(positionHealths, PUBLISH_BATCH_SIZE);
    let publishedCount = 0;
    for (let i = 0; i < batches.length; i += 1) {
      if (i > 0) {
        await delay(PUBLISH_BATCH_DELAY_MS);
      }

      const result = await this._publishBatch(batches[i], i + 1, batches.length);
      if (result === BatchResult.Published) {
        publishedCount += batches[i].length;
      } else if (result === BatchResult.Stop) {
        Logger.warn({
          at: 'NotifiPositionHealthPublisher#_publish',
          message: 'Stopped publishing to Notifi; the remaining positions will be retried next interval',
          unpublished: positionHealths.length - publishedCount,
        });
        break;
      }
    }

    Logger.info({
      at: 'NotifiPositionHealthPublisher#_publish',
      message: 'Finished publishing position health to Notifi',
      published: `${publishedCount} of ${positionHealths.length}`,
    });
    return true;
  };

  /**
   * The IDs of the positions users have alerts for on the Position Health topic, lower-cased to match `ApiAccount.id`.
   *
   * @return `undefined` if Notifi could not be asked, in which case the failure has been logged
   */
  _getSubscribedPositionIds = async (): Promise<Set<string> | undefined> => {
    let token: string;
    try {
      token = await this._getToken();
    } catch (error: any) {
      Logger.error({
        at: 'NotifiPositionHealthPublisher#_getSubscribedPositionIds',
        message: 'Failed to log in to Notifi',
        error,
      });
      return undefined;
    }

    try {
      const alerts = await getNotifiActiveAlerts(token, process.env.NOTIFI_POSITION_HEALTH_EVENT_TYPE_ID!);
      return new Set(
        alerts
          .map(alert => alert.subscriptionValue?.toLowerCase())
          .filter((positionId): positionId is string => !!positionId),
      );
    } catch (error: any) {
      if (_isUnauthorized(error)) {
        // Notifi rejected the token; the next round logs in again
        this.authorization = undefined;
      }
      Logger.error({
        at: 'NotifiPositionHealthPublisher#_getSubscribedPositionIds',
        message: 'Failed to list the active alerts on Notifi',
        status: _getStatus(error),
        error,
      });
      return undefined;
    }
  };

  _publishBatch = async (batch: PositionHealth[], batchNumber: number, batchCount: number): Promise<BatchResult> => {
    const label = `batch ${batchNumber} of ${batchCount}`;
    const messages = batch.map(NotifiPositionHealthPublisher.toFusionMessage);

    let result = await this._send(messages);
    if (_isUnauthorized(result.error)) {
      // Notifi rejected the token; log in again and retry this batch once
      this.authorization = undefined;
      result = await this._send(messages);
    }

    if (result.response) {
      Logger.info({
        at: 'NotifiPositionHealthPublisher#_publishBatch',
        message: `Published ${label} to Notifi`,
        accepted: `${Object.keys(result.response.indexToResultIdMap).length} of ${batch.length}`,
        positions: batch.map(p => `${p.positionId}: ${p.healthFactor.toFixed(HEALTH_FACTOR_DECIMAL_PLACES)}`),
      });
      return BatchResult.Published;
    }

    Logger.error({
      at: 'NotifiPositionHealthPublisher#_publishBatch',
      message: `Failed to publish ${label} to Notifi`,
      status: _getStatus(result.error),
      positionCount: batch.length,
      error: result.error,
    });
    return result.isLoginError || _isRateLimited(result.error) ? BatchResult.Stop : BatchResult.Failed;
  };

  _send = async (messages: NotifiFusionMessage[]): Promise<SendResult> => {
    let token: string;
    try {
      token = await this._getToken();
    } catch (error: any) {
      return { error, isLoginError: true };
    }

    try {
      return { response: await publishNotifiFusionMessages(token, messages) };
    } catch (error: any) {
      return { error };
    }
  };

  _getToken = async (): Promise<string> => {
    const expiryThresholdMillis = DateTime.utc().plus({ minutes: TOKEN_EXPIRY_BUFFER_MINUTES }).toMillis();
    if (!this.authorization || DateTime.fromISO(this.authorization.expiry).toMillis() <= expiryThresholdMillis) {
      this.authorization = await logInToNotifi(process.env.NOTIFI_SID!, process.env.NOTIFI_SECRET!);
      Logger.info({
        at: 'NotifiPositionHealthPublisher#_getToken',
        message: 'Logged in to Notifi',
        expiry: this.authorization.expiry,
      });
    }

    return this.authorization.token;
  };
}

// =================================================
// =============== Private Functions ===============
// =================================================

function _getStatus(error: any): number | undefined {
  return error?.response?.status;
}

function _isUnauthorized(error: any): boolean {
  const status = _getStatus(error);
  return status === 401 || status === 403;
}

function _isRateLimited(error: any): boolean {
  return _getStatus(error) === 429;
}
