import { DateTime } from 'luxon';
import { updateActiveSubgraph } from '../clients/subgraph';
import Logger from '../lib/logger';
import { dolomite } from './web3';

let lastBlockTimestamp: DateTime = DateTime.fromSeconds(0);
let lastBlockNumber: number = 0;

export async function getSubgraphBlockNumber(
  defaultBlockNumber: number = lastBlockNumber,
): Promise<{ blockNumber: number, blockTimestamp: DateTime }> {
  if (!Number.isNaN(Number(process.env.BLOCK_NUMBER))) {
    return Promise.resolve({ blockNumber: Number(process.env.BLOCK_NUMBER), blockTimestamp: lastBlockTimestamp });
  }

  const gqlBlockNumber = (await updateActiveSubgraph()) ?? defaultBlockNumber;

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
