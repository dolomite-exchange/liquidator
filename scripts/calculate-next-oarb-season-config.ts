import fs from 'fs';
import { getLatestBlockNumberByTimestamp } from '../src/clients/blocks';
import './lib/env-reader';

interface OutputFile {
  epochs: {
    [epoch: string]: {
      epoch: number;
      startTimestamp: number;
      endTimestamp: number;
      startBlockNumber: number;
      endBlockNumber: number;
      oArbAmount: string;
      rewardWeights: Record<string, string>;
      isFinalized: boolean;
    }
  };
}

const FOLDER_NAME = `${__dirname}/config`;
const FILE_NAME = `${FOLDER_NAME}/oarb-season-0.json`;

async function start() {
  const outputFile = readOutputFile(FILE_NAME);
  const maxKey = Object.keys(outputFile.epochs).reduce((max, key) => Math.max(max, parseInt(key, 10)), 0);

  const oldEpoch = outputFile.epochs[maxKey];
  const { startTimestamp, startBlockNumber, endBlockNumber, endTimestamp, oArbAmount, rewardWeights } = oldEpoch;

  const newEpoch = oldEpoch.isFinalized ? maxKey + 1 : maxKey;
  const newStartTimestamp = oldEpoch.isFinalized ? endTimestamp : startTimestamp;
  const newStartBlockNumber = oldEpoch.isFinalized ? endBlockNumber : startBlockNumber;
  const newEndTimestamp = endTimestamp + (86400 * 7);
  const blockResult = await getLatestBlockNumberByTimestamp(newEndTimestamp);
  const isFinalized = newEndTimestamp === blockResult.timestamp;

  writeOutputFile(FILE_NAME, {
    epochs: {
      ...outputFile.epochs,
      [newEpoch]: {
        epoch: newEpoch,
        startBlockNumber: newStartBlockNumber,
        startTimestamp: newStartTimestamp,
        endBlockNumber: blockResult.blockNumber,
        endTimestamp: blockResult.timestamp,
        oArbAmount,
        rewardWeights,
        isFinalized,
      },
    },
  });

  return true;
}

function readOutputFile(fileName: string): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8')) as OutputFile;
  } catch (e) {
    return {
      epochs: {},
    };
  }
}

function writeOutputFile(
  fileName: string,
  fileContent: OutputFile,
): void {
  if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
  }

  fs.writeFileSync(
    fileName,
    JSON.stringify(fileContent, null, 2),
    { encoding: 'utf8', flag: 'w' },
  );
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
