import { PgBoss } from 'pg-boss';
import { createApp } from './app.js';
import { BOSS_SCHEMA, buildRegistry, createJobQueue, type JobQueue } from './jobs/index.js';
import { createDb, pingDb } from './db/index.js';
import { createFieldCrypto } from './shared/crypto.js';
import { createMailProvider } from './notifications/index.js';
import { createHttpRenderer } from './modules/letters/index.js';
import { createLocalStorage } from './shared/storage.js';
import { access, constants } from 'node:fs/promises';
import { sql } from 'kysely';
import { createErrorReporter } from './shared/error-reporter.js';
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

const reporter = createErrorReporter({
  dsn: config.SENTRY_DSN,
  release: config.APP_RELEASE,
  environment: config.NODE_ENV,
  service: 'api',
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  reporter.capture(err);
  // مهلة قصيرة ليخرج البلاغ ثم الإنهاء (الحاوية تُعاد تشغيلها)
  setTimeout(() => process.exit(1), 500).unref();
});
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled rejection');
  reporter.capture(err);
});

const app = createApp({
  logger,
  reporter,
  checkDb: db ? () => pingDb(db) : undefined,
  checks: [
    // التخزين حرج: بلا كتابة فيه لا رفع ولا تصدير ولا وثائق
    {
      name: 'storage',
      critical: true,
      run: () => access(config.STORAGE_DIR, constants.R_OK | constants.W_OK),
    },
    ...(config.RENDER_URL
      ? [
          {
            name: 'render',
            critical: false,
            run: async () => {
              const r = await fetch(`${config.RENDER_URL!.replace(/\/$/, '')}/health`, {
                signal: AbortSignal.timeout(2500),
              });
              if (!r.ok) throw new Error(`render ${r.status}`);
            },
          },
        ]
      : []),
    ...(db && jobs
      ? [
          {
            name: 'worker',
            critical: false,
            // مهام متراكمة بلا تنفيذ منذ 10 دقائق = العامل متوقف
            run: async () => {
              const { rows } = await sql<{ n: number }>`
                select count(*)::int as n from ${sql.id(BOSS_SCHEMA, 'job')}
                 where state = 'created' and start_after < now() - interval '10 minutes'`.execute(
                db,
              );
              if ((rows[0]?.n ?? 0) > 0) throw new Error('queue backlog');
            },
          },
        ]
      : []),
  ],
  auth:
    db && config.JWT_SECRET
      ? {
          db,
          cookieSecure: config.COOKIE_SECURE,
          crypto,
          storage: createLocalStorage(config.STORAGE_DIR),
          jobs,
          publicUrl: config.PUBLIC_URL,
          platformAdminKey: config.PLATFORM_ADMIN_KEY,
          render: config.RENDER_URL ? createHttpRenderer(config.RENDER_URL) : undefined,
          mail: {
            provider: createMailProvider({
              crypto,
              envSmtpUrl: config.SMTP_URL,
              envFrom: config.MAIL_FROM,
            }),
            envConfigured: !!config.SMTP_URL,
          },
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
