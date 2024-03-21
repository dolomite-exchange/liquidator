import { Network } from '@dolomite-exchange/zap-sdk';
import fs from 'fs';
import path from 'path';
import Logger from './logger';

const NETWORK_TO_ENV_FILE_MAP = {
  [Network.ARBITRUM_ONE]: path.resolve(process.cwd(), 'liquidator.arbitrum-one.production.env'),
  [Network.BASE]: path.resolve(process.cwd(), 'liquidator.base.production.env'),
  [Network.POLYGON_ZKEVM]: path.resolve(process.cwd(), 'liquidator.polygon-zkevm.production.env'),
}

const ENV_FILENAME = process.env.ENV_FILENAME ? process.env.ENV_FILENAME : undefined;
const NETWORK = process.env.NETWORK_ID ?? '';

console.log('subgraph', NETWORK_TO_ENV_FILE_MAP[NETWORK], ENV_FILENAME);
if (ENV_FILENAME || (NETWORK_TO_ENV_FILE_MAP[NETWORK] && fs.existsSync(NETWORK_TO_ENV_FILE_MAP[NETWORK]))) {
  console.log('ENV_FILENAME ?? NETWORK_TO_ENV_FILE_MAP[NETWORK]', ENV_FILENAME ?? NETWORK_TO_ENV_FILE_MAP[NETWORK]);
  // eslint-disable-next-line
  require('dotenv-flow').config({ path: [ENV_FILENAME ?? NETWORK_TO_ENV_FILE_MAP[NETWORK], '.env'] });
} else {
  Logger.warn({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv-flow').config();
}
