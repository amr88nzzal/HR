import { createApp } from './app.js';
import { createDb, pingDb } from './db/index.js';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logging.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const db = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;

const app = createApp({
  logger,
  checkDb: db ? () => pingDb(db) : undefined,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db?.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
