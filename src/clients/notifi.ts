import axios from 'axios';
import '../lib/env';

/**
 * Notifi is reached over plain HTTP rather than through `@notifi-network/notifi-node`: the SDK publishes through its
 * data plane client, which relies on the global `fetch` API that the Node version this service runs on (see `.nvmrc`)
 * does not provide. The endpoints, documents and payloads below mirror `@notifi-network/notifi-node@8.0.0`.
 */

export const NOTIFI_ENVIRONMENTS = ['Production', 'Staging', 'Development'] as const;

export type NotifiEnvironment = typeof NOTIFI_ENVIRONMENTS[number];

interface NotifiUrls {
  /** GraphQL API, used to authenticate the service and to list alerts */
  gqlUrl: string;
  /** Data plane API, used to publish events */
  dpapiUrl: string;
}

const NOTIFI_ENVIRONMENT_TO_URLS_MAP: Record<NotifiEnvironment, NotifiUrls> = {
  Production: {
    gqlUrl: 'https://api.notifi.network/gql',
    dpapiUrl: 'https://dpapi.prd.notifi.network',
  },
  Staging: {
    gqlUrl: 'https://api.stg.notifi.network/gql',
    dpapiUrl: 'https://dpapi.stg.notifi.network',
  },
  Development: {
    gqlUrl: 'https://api.dev.notifi.network/gql',
    dpapiUrl: 'https://dpapi.dev.notifi.network',
  },
};

const REQUEST_TIMEOUT_MS = 30_000;

/** Alerts per page when listing a topic's active alerts */
const ACTIVE_ALERTS_PAGE_SIZE = 100;

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
  timeout: REQUEST_TIMEOUT_MS,
};

export interface NotifiAuthorization {
  /** JWT that authenticates every other request */
  token: string;
  /** ISO-8601 timestamp after which `token` is rejected */
  expiry: string;
}

/**
 * One event for a Fusion topic. `variablesJson` carries the template variables for the notification's message and, for
 * topics with alert filters, a `filterVariables` object that Notifi matches against each subscriber's alert.
 */
export interface NotifiFusionMessage {
  eventTypeId: string;
  variablesJson: object;
}

export interface NotifiPublishFusionMessageResponse {
  /** Maps each message's index in the request to the ID Notifi assigned it */
  indexToResultIdMap: Record<string, string>;
}

/** An alert a user created for a topic */
export interface NotifiActiveAlert {
  id: string;
  /** The value the alert was subscribed with; the position ID for the Position Health topic */
  subscriptionValue: string | null;
}

/**
 * Authenticates as the tenant's service with the SID and secret pair from the Notifi Admin Console (Account Settings).
 */
export async function logInToNotifi(sid: string, secret: string): Promise<NotifiAuthorization> {
  const query = `
    mutation logInFromService($input: ServiceLogInInput!) {
      logInFromService(serviceLogInInput: $input) {
        token
        expiry
      }
    }
  `;
  const result: any = await axios.post(
    _getNotifiUrls().gqlUrl,
    {
      query,
      variables: {
        input: { sid, secret },
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }
  if (!result.data?.logInFromService?.token) {
    return Promise.reject(new Error('Notifi log in did not return a token'));
  }

  return result.data.logInFromService;
}

/**
 * Lists every alert users have created for a topic across the tenant, so a publisher can limit itself to the values
 * someone is actually subscribed to. Pages through Notifi's connection until it is exhausted.
 */
export async function getNotifiActiveAlerts(token: string, fusionEventId: string): Promise<NotifiActiveAlert[]> {
  const query = `
    query getActiveAlerts($first: Int, $after: String, $fusionEventId: String!) {
      activeAlerts(after: $after, first: $first, activeAlertsInput: { fusionEventId: $fusionEventId }) {
        nodes {
          id
          subscriptionValue
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
  const alerts: NotifiActiveAlert[] = [];
  let after: string | null = null;
  do {
    const result: any = await axios.post(
      _getNotifiUrls().gqlUrl,
      {
        query,
        variables: {
          first: ACTIVE_ALERTS_PAGE_SIZE,
          after,
          fusionEventId,
        },
      },
      _getAuthorizedAxiosConfig(token),
    )
      .then(response => response.data);

    if (result.errors && typeof result.errors === 'object') {
      return Promise.reject(result.errors[0]);
    }
    const connection = result.data?.activeAlerts;
    if (!connection) {
      return Promise.reject(new Error('Notifi did not return active alerts'));
    }

    alerts.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return alerts;
}

/**
 * Publishes events to Notifi's data plane. Notifi fans each event out to the subscribers of its topic whose alert
 * filters match the event's `filterVariables`.
 */
export async function publishNotifiFusionMessages(
  token: string,
  messages: NotifiFusionMessage[],
): Promise<NotifiPublishFusionMessageResponse> {
  return axios.post(
    `${_getNotifiUrls().dpapiUrl}/FusionIngest/`,
    { data: messages },
    _getAuthorizedAxiosConfig(token),
  )
    .then(response => response.data as NotifiPublishFusionMessageResponse);
}

// =================================================
// =============== Private Functions ===============
// =================================================

function _getNotifiUrls(): NotifiUrls {
  return NOTIFI_ENVIRONMENT_TO_URLS_MAP[process.env.NOTIFI_ENVIRONMENT as NotifiEnvironment];
}

function _getAuthorizedAxiosConfig(token: string) {
  return {
    ...defaultAxiosConfig,
    headers: {
      ...defaultAxiosConfig.headers,
      Authorization: `Bearer ${token}`,
    },
  };
}
