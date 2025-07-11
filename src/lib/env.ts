import fs from 'fs';
import path from 'path';
import { ChainId } from './chain-id';
import Logger from './logger';

const NETWORK_TO_ENV_FILE_MAP = {
  [ChainId.ArbitrumOne]: path.resolve(process.cwd(), 'liquidator.arbitrum-one.production.env'),
  [ChainId.Base]: path.resolve(process.cwd(), 'liquidator.base.production.env'),
  [ChainId.Berachain]: path.resolve(process.cwd(), 'liquidator.berachain.production.env'),
  [ChainId.Botanix]: path.resolve(process.cwd(), 'liquidator.botanix.production.env'),
  [ChainId.Ethereum]: path.resolve(process.cwd(), 'liquidator.ethereum.production.env'),
  [ChainId.Mantle]: path.resolve(process.cwd(), 'liquidator.mantle.production.env'),
  [ChainId.PolygonZkEvm]: path.resolve(process.cwd(), 'liquidator.polygon-zkevm.production.env'),
  [ChainId.XLayer]: path.resolve(process.cwd(), 'liquidator.x-layer.production.env'),
}

const NETWORK_TO_STATS_ENV_FILE_MAP = {
  [ChainId.ArbitrumOne]: path.resolve(process.cwd(), 'stats.arbitrum-one.production.env'),
  [ChainId.Base]: path.resolve(process.cwd(), 'stats.base.production.env'),
  [ChainId.Berachain]: path.resolve(process.cwd(), 'stats.berachain.production.env'),
  [ChainId.Botanix]: path.resolve(process.cwd(), 'stats.botanix.production.env'),
  [ChainId.Ethereum]: path.resolve(process.cwd(), 'stats.ethereum.production.env'),
  [ChainId.Mantle]: path.resolve(process.cwd(), 'stats.mantle.production.env'),
  [ChainId.PolygonZkEvm]: path.resolve(process.cwd(), 'stats.polygon-zkevm.production.env'),
  [ChainId.XLayer]: path.resolve(process.cwd(), 'stats.x-layer.production.env'),
}

const { ENV_FILENAME } = process.env;
const NETWORK = process.env.NETWORK_ID ?? '';
const FILE_MAP = process.env.STATS === 'true' ? NETWORK_TO_STATS_ENV_FILE_MAP : NETWORK_TO_ENV_FILE_MAP;

if (ENV_FILENAME || (FILE_MAP[NETWORK] && fs.existsSync(FILE_MAP[NETWORK]))) {
  // eslint-disable-next-line
  require('dotenv').config({ path: [ENV_FILENAME ?? FILE_MAP[NETWORK], '.env'] });
} else {
  Logger.info({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv').config();
}
