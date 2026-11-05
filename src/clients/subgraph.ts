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
// The bot only goes back to a preferred subgraph once it's this close to the active one. Otherwise a subgraph hovering
// around the limit above would be switched to and from on every poll, moving the block number back each time.
const MAX_SUBGRAPH_LAG_TO_SWITCH_BACK_SECONDS = 15;
const SUBGRAPH_META_TIMEOUT_MS = 5_000;
// Without a timeout, a subgraph that never answers would stop the request from reaching the next one
const SUBGRAPH_REQUEST_TIMEOUT_MS = 30_000;

interface SubgraphBlock {
  number: number;
  timestamp: number;
}

let activeSubgraphUrl = SUBGRAPH_URLS[0];
const activeSubgraphUrlListeners: ((subgraphUrl: string) => void)[] = [];

export function getActiveSubgraphUrl(): string {
  return activeSubgraphUrl;
}

export function onActiveSubgraphUrlChange(listener: (subgraphUrl: string) => void) {
  activeSubgraphUrlListeners.push(listener);
}

/**
 * Checks each subgraph's latest block and makes the first one in `SUBGRAPH_URLS` that isn't lagging the furthest-along
 * one active, going back to a preferred one only once it has caught up. Returns the active subgraph's block number, or
 * undefined (leaving it unchanged) if none of them answered.
 */
export async function updateActiveSubgraph(): Promise<number | undefined> {
  const subgraphBlocks = await Promise.all(SUBGRAPH_URLS.map(subgraphUrl => getSubgraphBlock(subgraphUrl)));
  const latestTimestamp = Math.max(...subgraphBlocks.map(block => block?.timestamp ?? 0));
  const isUpToDate = (block: SubgraphBlock | undefined): block is SubgraphBlock => {
    return !!block && latestTimestamp - block.timestamp <= MAX_SUBGRAPH_LAG_SECONDS;
  };

  const currentIndex = SUBGRAPH_URLS.indexOf(activeSubgraphUrl);
  const currentBlock = subgraphBlocks[currentIndex];
  const activeIndex = subgraphBlocks.findIndex((block, i) => {
    if (i < currentIndex && isUpToDate(block) && isUpToDate(currentBlock)) {
      return currentBlock.timestamp - block.timestamp <= MAX_SUBGRAPH_LAG_TO_SWITCH_BACK_SECONDS;
    }
    return isUpToDate(block);
  });
  if (activeIndex === -1) {
    Logger.error({
      at: 'subgraph#updateActiveSubgraph',
      message: 'No subgraph answered, so the block number was not updated',
      subgraphUrls: SUBGRAPH_URLS,
    });
    return undefined;
  }

  if (activeIndex !== currentIndex) {
    Logger.warn({
      at: 'subgraph#updateActiveSubgraph',
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
 * Posts a GraphQL request to the active subgraph, then to the others in order if it fails or doesn't answer with data.
 * If every subgraph fails, the active one's result is returned (or thrown), the same as with a single subgraph.
 */
export async function postToSubgraph(data: object, config: AxiosRequestConfig = {}): Promise<AxiosResponse> {
  const subgraphUrls = [activeSubgraphUrl, ...SUBGRAPH_URLS.filter(subgraphUrl => subgraphUrl !== activeSubgraphUrl)];
  let firstFailure: { response?: AxiosResponse, error?: any } | undefined;
  for (const subgraphUrl of subgraphUrls) {
    try {
      const response = await axios.post(subgraphUrl, data, { timeout: SUBGRAPH_REQUEST_TIMEOUT_MS, ...config });
      // Besides GraphQL `errors`, Ormi answers a missing subgraph with HTTP 200 and `{ "error": "..." }`
      if (response.data?.data && !response.data.errors) {
        return response;
      }
      firstFailure = firstFailure ?? { response };
      logSubgraphFailure(subgraphUrl, response.data?.errors?.[0]?.message ?? response.data?.error ?? 'No data');
    } catch (error: any) {
      firstFailure = firstFailure ?? { error };
      logSubgraphFailure(subgraphUrl, error.message);
    }
  }

  if (firstFailure?.response) {
    return firstFailure.response;
  }
  throw firstFailure!.error;
}

async function getSubgraphBlock(subgraphUrl: string): Promise<SubgraphBlock | undefined> {
  return axios.post(
    subgraphUrl,
    { query: '{ _meta { block { number timestamp } } }' },
    { timeout: SUBGRAPH_META_TIMEOUT_MS },
  )
    .then(response => {
      // Without a timestamp, a subgraph is only used when no subgraph that has one answers
      const { block } = response.data.data._meta;
      return { number: Number(block.number), timestamp: Number(block.timestamp) || 0 };
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
