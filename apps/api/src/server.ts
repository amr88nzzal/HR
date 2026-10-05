import { createApp } from './app.js';
import { createDb, pingDb } from './db/index.js';
import { createFieldCrypto } from './shared/crypto.js';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logging.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const db = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;

if (db && !config.JWT_SECRET) {
  throw new Error('JWT_SECRET (32 حرفاً على الأقل) مطلوب عند تفعيل قاعدة البيانات');
}

if (db && !(config.ENCRYPTION_KEYS && config.ENCRYPTION_KEY_ID && config.ENCRYPTION_DIGEST_KEY)) {
  throw new Error(
    'ENCRYPTION_KEYS و ENCRYPTION_KEY_ID و ENCRYPTION_DIGEST_KEY مطلوبة عند تفعيل قاعدة البيانات',
  );
}
const crypto =
  config.ENCRYPTION_KEYS && config.ENCRYPTION_KEY_ID && config.ENCRYPTION_DIGEST_KEY
    ? createFieldCrypto({
        keysSpec: config.ENCRYPTION_KEYS,
        currentKeyId: config.ENCRYPTION_KEY_ID,
        digestKey: config.ENCRYPTION_DIGEST_KEY,
      })
    : undefined;

const app = createApp({
  logger,
  checkDb: db ? () => pingDb(db) : undefined,
  auth:
    db && config.JWT_SECRET
      ? {
          db,
          cookieSecure: config.COOKIE_SECURE,
          crypto,
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
