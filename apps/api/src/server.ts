import pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logging.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const pool = config.DATABASE_URL
  ? new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 })
  : undefined;

const app = createApp({
  logger,
  checkDb: pool
    ? async () => {
        await pool.query('select 1');
        return true;
      }
    : undefined,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
