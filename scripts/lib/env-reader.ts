import Logger from '../../src/lib/logger';

const ENV_FILENAME = process.env.ENV_FILENAME ? process.env.ENV_FILENAME : undefined;

if (ENV_FILENAME) {
  require('dotenv').config({ path: ENV_FILENAME });
} else {
  Logger.warn({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv').config();
}
