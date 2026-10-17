import { PgBoss } from 'pg-boss';
import { createDb } from './db/index.js';
import { BOSS_SCHEMA } from './jobs/install.js';
import { PERIODIC_JOBS } from './jobs/definitions.js';
import { buildRegistry } from './jobs/registry.js';
import {
  createMailProvider,
  createTelegramApi,
  createTelegramProvider,
} from './notifications/index.js';
import { createFieldCrypto } from './shared/crypto.js';
import { createLocalStorage } from './shared/storage.js';
import { startWorkers } from './jobs/runtime.js';
import { createErrorReporter } from './shared/error-reporter.js';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logging.js';

/** عملية العمّال المستقلة: تنفّذ الطوابير وتجدول المهام الدورية. */
const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const reporter = createErrorReporter({
  dsn: config.SENTRY_DSN,
  release: config.APP_RELEASE,
  environment: config.NODE_ENV,
  service: 'worker',
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  reporter.capture(err);
  setTimeout(() => process.exit(1), 500).unref();
});
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled rejection');
  reporter.capture(err);
});

if (!config.DATABASE_URL || !config.DATABASE_ADMIN_URL) {
  throw new Error('DATABASE_URL و DATABASE_ADMIN_URL مطلوبان لعملية العمّال');
}

const crypto =
  config.ENCRYPTION_KEYS && config.ENCRYPTION_KEY_ID && config.ENCRYPTION_DIGEST_KEY
    ? createFieldCrypto({
        keysSpec: config.ENCRYPTION_KEYS,
        currentKeyId: config.ENCRYPTION_KEY_ID,
        digestKey: config.ENCRYPTION_DIGEST_KEY,
      })
    : undefined;
// بريد الشركة من إعدادات القاعدة، ويرجع إلى SMTP_URL إن لم يُضبط
const mail = createMailProvider({
  crypto,
  envSmtpUrl: config.SMTP_URL,
  envFrom: config.MAIL_FROM,
});
const db = createDb(config.DATABASE_URL);
const adminDb = createDb(config.DATABASE_ADMIN_URL);
// pg-boss يحتاج صلاحيات صيانة مخططه (أقسام الإحصاءات ...) فيتصل بحساب المالك؛ مهام الأعمال تعمل عبر db الخاضع لـ RLS
const boss = new PgBoss({
  connectionString: config.DATABASE_ADMIN_URL,
  schema: BOSS_SCHEMA,
  migrate: false,
  createSchema: false,
  supervise: true,
  schedule: true,
});
boss.on('error', (err) => {
  logger.error({ err }, 'pg-boss error');
  reporter.capture(err);
});

await boss.start();
await startWorkers({
  boss,
  db,
  adminDb,
  registry: buildRegistry(
    mail,
    createTelegramProvider({ crypto, api: createTelegramApi() }),
    { storage: createLocalStorage(config.STORAGE_DIR), crypto },
    config.PUBLIC_URL,
  ),
  periodic: PERIODIC_JOBS,
  logger,
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  await boss.stop({ graceful: true, timeout: 20_000 });
  await Promise.all([db.destroy(), adminDb.destroy()]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
