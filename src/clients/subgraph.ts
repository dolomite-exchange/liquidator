import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import Logger from '../lib/logger';
import '../lib/env';

// In order of preference. SUBGRAPH_URL is still read so environments that set a single URL keep working.
export const SUBGRAPH_URLS: string[] = (process.env.SUBGRAPH_URLS || process.env.SUBGRAPH_URL || '')
  .split(',')
  .map(url => url.trim())
  .filter(url => url.length > 0);
if (SUBGRAPH_URLS.length === 0) {
  throw new Error('SUBGRAPH_URLS (or SUBGRAPH_URL) is not set');
}

// A subgraph further than this behind the furthest-along one is skipped, e.g. while it re-indexes after a redeploy
const MAX_SUBGRAPH_LAG_SECONDS = 60;
const SUBGRAPH_META_TIMEOUT_MS = 5_000;
// Without a timeout, a subgraph that never answers would stop the request from reaching the next one
const SUBGRAPH_REQUEST_TIMEOUT_MS = 30_000;

let activeSubgraphUrl = SUBGRAPH_URLS[0];
const activeSubgraphUrlListeners: ((subgraphUrl: string) => void)[] = [];

export function getActiveSubgraphUrl(): string {
  return activeSubgraphUrl;
}

export function onActiveSubgraphUrlChange(listener: (subgraphUrl: string) => void) {
  activeSubgraphUrlListeners.push(listener);
}

/**
 * Checks each subgraph's latest block, makes the first one in `SUBGRAPH_URLS` that isn't lagging the furthest-along
 * one active, and returns its block number. Returns undefined, leaving the active subgraph unchanged, if none answered.
 */
export async function getActiveSubgraphBlockNumber(): Promise<number | undefined> {
  const subgraphBlocks = await Promise.all(SUBGRAPH_URLS.map(subgraphUrl => getSubgraphBlock(subgraphUrl)));
  const latestTimestamp = Math.max(...subgraphBlocks.map(block => block?.timestamp ?? 0));
  const activeIndex = subgraphBlocks.findIndex(block => {
    return block && latestTimestamp - block.timestamp <= MAX_SUBGRAPH_LAG_SECONDS;
  });
  if (activeIndex === -1) {
    return undefined;
  }

  if (SUBGRAPH_URLS[activeIndex] !== activeSubgraphUrl) {
    Logger.warn({
      at: 'subgraph#getActiveSubgraphBlockNumber',
      message: 'Switching subgraphs',
      from: activeSubgraphUrl,
      to: SUBGRAPH_URLS[activeIndex],
      subgraphBlocks: SUBGRAPH_URLS.map((subgraphUrl, i) => ({ subgraphUrl, block: subgraphBlocks[i] ?? null })),
    });
    activeSubgraphUrl = SUBGRAPH_URLS[activeIndex];
    activeSubgraphUrlListeners.forEach(listener => listener(activeSubgraphUrl));
  }

  return subgraphBlocks[activeIndex]!.number;
}

/**
 * Posts a GraphQL request to the active subgraph, then to the others in order if it fails or answers with errors.
 * If every subgraph fails, the active one's result is returned (or thrown), the same as with a single subgraph.
 */
export async function postToSubgraph(data: object, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
  const subgraphUrls = [activeSubgraphUrl, ...SUBGRAPH_URLS.filter(subgraphUrl => subgraphUrl !== activeSubgraphUrl)];
  let firstFailure: { response: AxiosResponse } | { error: any } | undefined;
  for (const subgraphUrl of subgraphUrls) {
    try {
      const response = await axios.post(subgraphUrl, data, { timeout: SUBGRAPH_REQUEST_TIMEOUT_MS, ...config });
      if (!response.data?.errors) {
        return response;
      }
      firstFailure = firstFailure ?? { response };
      logSubgraphFailure(subgraphUrl, response.data.errors[0]?.message);
    } catch (error: any) {
      firstFailure = firstFailure ?? { error };
      logSubgraphFailure(subgraphUrl, error.message);
    }
  }

  if (firstFailure && 'response' in firstFailure) {
    return firstFailure.response;
  }
  throw firstFailure!.error;
}

async function getSubgraphBlock(subgraphUrl: string): Promise<{ number: number, timestamp: number } | undefined> {
  return axios.post(
    subgraphUrl,
    { query: '{ _meta { block { number timestamp } } }' },
    { timeout: SUBGRAPH_META_TIMEOUT_MS },
  )
    .then(response => {
      const { block } = response.data.data._meta;
      return { number: Number(block.number), timestamp: Number(block.timestamp) };
    })
    .catch(() => undefined);
}

function logSubgraphFailure(subgraphUrl: string, message: string | undefined) {
  // With a single subgraph, the caller handles the failure the same way it always has
  if (SUBGRAPH_URLS.length > 1) {
    Logger.warn({
      at: 'subgraph#postToSubgraph',
      message: 'Subgraph request failed',
      subgraphUrl,
      error: message,
    });
  }
}
