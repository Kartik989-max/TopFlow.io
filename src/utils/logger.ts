import pino from 'pino';
import { env } from '../config/env.js';

const isDev = env.isDev && !env.isTest;

const logger = pino(
  {
    level: isDev ? 'debug' : 'info',
    // Never leak secrets if any structured log accidentally includes env keys.
    redact: [
      'MONGODB_URI',
      'MONDODB_URI',
      'GROWW_API_KEY',
      'GROWW_API_SECRET',
      'GROWW_ACCESS_TOKEN',
      'req.headers.authorization',
    ],
  },
  isDev ? pino.transport({ target: 'pino-pretty', options: { colorize: true } }) : undefined,
);

export default logger;
