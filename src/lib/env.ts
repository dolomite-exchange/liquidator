import { Network } from '@dolomite-exchange/zap-sdk';
import Logger from './logger';

const NETWORK_TO_ENV_FILE_MAP = {
  [Network.ARBITRUM_ONE]: 'liquidator.arbitrum-one.production.env',
  [Network.BASE]: 'liquidator.arbitrum-one.production.env',
  [Network.POLYGON_ZKEVM]: 'liquidator.polygon-zkevm.production.env',
}

const ENV_FILENAME = process.env.ENV_FILENAME ? process.env.ENV_FILENAME : undefined;
const NETWORK = process.env.NETWORK_ID ?? '';

if (ENV_FILENAME || (NETWORK && NETWORK_TO_ENV_FILE_MAP[NETWORK])) {
  // eslint-disable-next-line
  require('dotenv').config({ path: ENV_FILENAME ?? NETWORK_TO_ENV_FILE_MAP[NETWORK] });
} else {
  Logger.warn({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv').config();
}
