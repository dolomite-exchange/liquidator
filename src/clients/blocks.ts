/* eslint-disable max-len */
import axios from 'axios';
import { GraphqlDepositsResult } from '../lib/graphql-types';
import '../lib/env';

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
};

const subgraphUrl = process.env.BLOCKS_SUBGRAPH_URL ?? '';
if (!subgraphUrl) {
  throw new Error('BLOCKS_SUBGRAPH_URL is not set')
}
console.log('subgraphUrl', subgraphUrl);

interface LatestBlockNumberAndTimestamp {
  blockNumber: number;
  timestamp: number;
}

export async function getLatestBlockNumberByTimestamp(
  timestamp: number,
): Promise<LatestBlockNumberAndTimestamp> {
  const query = `
  query getLatestBlockNumberByTimestamp($timestamp: BigInt) {
    blocks(first: 1, orderBy: number orderDirection: desc where: { timestamp_lte: $timestamp }) {
      timestamp
      number
    }
  }
  `;
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        timestamp,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlDepositsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }
  if (result.data.blocks.length === 0) {
    return Promise.reject(new Error('No blocks found'));
  }

  return {
    blockNumber: parseInt(result.data.blocks[0].number, 10),
    timestamp: parseInt(result.data.blocks[0].timestamp, 10),
  };
}
