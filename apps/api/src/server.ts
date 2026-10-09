import { PgBoss } from 'pg-boss';
import { createApp } from './app.js';
import { BOSS_SCHEMA, buildRegistry, createJobQueue, type JobQueue } from './jobs/index.js';
import { createDb, pingDb } from './db/index.js';
import { createFieldCrypto } from './shared/crypto.js';
import { createLocalStorage } from './shared/storage.js';
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

// الـ API يدرج المهام فقط (ضمن معاملات الأعمال)؛ التنفيذ والجدولة والصيانة في عملية worker
let boss: PgBoss | undefined;
let jobs: JobQueue | undefined;
if (db && config.DATABASE_URL) {
  try {
    boss = new PgBoss({
      connectionString: config.DATABASE_URL,
      schema: BOSS_SCHEMA,
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
    await boss.start();
    jobs = createJobQueue(boss, buildRegistry(undefined));
  } catch (err) {
    logger.warn({ err }, 'job queue unavailable (run post-migrate); continuing without it');
    boss = undefined;
  }
}

const app = createApp({
  logger,
  checkDb: db ? () => pingDb(db) : undefined,
  auth:
    db && config.JWT_SECRET
      ? {
          db,
          cookieSecure: config.COOKIE_SECURE,
          crypto,
          storage: createLocalStorage(config.STORAGE_DIR),
          jobs,
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
    await boss?.stop({ graceful: true, timeout: 10_000 });
    await db?.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
