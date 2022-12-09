import axios from 'axios';
import { DateTime } from 'luxon';
import { dolomite } from './web3';
import Logger from '../lib/logger';

const subgraphUrl = process.env.SUBGRAPH_URL ?? '';
if (!subgraphUrl) {
  throw new Error('SUBGRAPH_URL is not defined');
}

let lastBlockTimestamp: DateTime = DateTime.fromSeconds(0);
let lastBlockNumber: number = 0;

export async function getSubgraphBlockNumber(): Promise<{blockNumber: number, blockTimestamp: DateTime}> {
  const gqlBlockNumber = await axios.post(subgraphUrl, {
    query: '{ _meta { block { number } } }',
  })
    .then(response => response.data)
    .then((json: any) => Number(json.data._meta.block.number))
    .catch(() => lastBlockNumber);

  let web3BlockNumber: number;
  try {
    const block = await dolomite.web3.eth.getBlock('latest');
    web3BlockNumber = block.number;
    lastBlockTimestamp = DateTime.fromMillis(Number(block.timestamp) * 1000);
  } catch (error: any) {
    web3BlockNumber = gqlBlockNumber;
    Logger.error({
      at: 'block-helper#getBlockNumber',
      message: error.message,
      error,
    });
  }

  if (gqlBlockNumber > web3BlockNumber) {
    lastBlockNumber = web3BlockNumber;
  } else {
    lastBlockNumber = gqlBlockNumber;
  }
  return { blockNumber: lastBlockNumber, blockTimestamp: lastBlockTimestamp };
}
