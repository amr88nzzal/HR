import { PgBoss } from 'pg-boss';
import { createDb } from './db/index.js';
import { BOSS_SCHEMA } from './jobs/install.js';
import { PERIODIC_JOBS } from './jobs/definitions.js';
import { buildRegistry } from './jobs/registry.js';
import { createSmtpTransport } from './notifications/mail.js';
import { startWorkers } from './jobs/runtime.js';
import { loadConfig, mailSettings } from './shared/config.js';
import { createLogger } from './shared/logging.js';

/** عملية العمّال المستقلة: تنفّذ الطوابير وتجدول المهام الدورية. */
const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

if (!config.DATABASE_URL || !config.DATABASE_ADMIN_URL) {
  throw new Error('DATABASE_URL و DATABASE_ADMIN_URL مطلوبان لعملية العمّال');
}

const mailConf = mailSettings(config);
const mail = mailConf ? createSmtpTransport(mailConf) : undefined;
if (!mail) logger.warn('إعدادات SMTP غير مضبوطة: لن يُرسل البريد (تُعلَّم الرسائل skipped)');
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
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

await boss.start();
await startWorkers({
  boss,
  db,
  adminDb,
  registry: buildRegistry(mail),
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
