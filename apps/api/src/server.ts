import { createApp } from './app.js';
import { createDb, pingDb } from './db/index.js';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logging.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const db = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;

if (db && !config.JWT_SECRET) {
  throw new Error('JWT_SECRET (32 حرفاً على الأقل) مطلوب عند تفعيل قاعدة البيانات');
}

const app = createApp({
  logger,
  checkDb: db ? () => pingDb(db) : undefined,
  auth:
    db && config.JWT_SECRET
      ? {
          db,
          cookieSecure: config.COOKIE_SECURE,
          settings: {
            jwtSecret: config.JWT_SECRET,
            accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
            refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
            defaultCompanySlug: config.DEFAULT_COMPANY_SLUG,
          },
        }
      : undefined,
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
