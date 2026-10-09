import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { JOB_QUEUES } from '@hrms/shared';
import { QUEUE_OPTIONS } from './queues.js';

export const BOSS_SCHEMA = 'pgboss';

/**
 * يثبّت/يرقّي مخطط pg-boss بحساب المالك، وينشئ الطوابير الأربعة، ثم يمنح دور التطبيق
 * ما يلزم لإدراج المهام ضمن معاملاته (الـ API) وتنفيذها. آمن لإعادة التشغيل مع كل نشر.
 */
export const installJobSchema = async (adminUrl: string, appRole = 'hrms_app'): Promise<void> => {
  const boss = new PgBoss({
    connectionString: adminUrl,
    schema: BOSS_SCHEMA,
    schedule: false,
    supervise: false,
  });
  boss.on('error', (e) => console.error('pg-boss:', e.message));
  await boss.start();
  try {
    for (const q of JOB_QUEUES) {
      const existing = (await boss.getQueues([q])).length > 0;
      if (existing) await boss.updateQueue(q, QUEUE_OPTIONS[q]);
      else await boss.createQueue(q, QUEUE_OPTIONS[q]);
    }
  } finally {
    await boss.stop({ graceful: false });
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const role = `"${appRole.replace(/"/g, '""')}"`;
    await client.query(`
      grant usage on schema ${BOSS_SCHEMA} to ${role};
      grant select, insert, update, delete on all tables in schema ${BOSS_SCHEMA} to ${role};
      grant usage, select on all sequences in schema ${BOSS_SCHEMA} to ${role};
      grant execute on all functions in schema ${BOSS_SCHEMA} to ${role};
      alter default privileges in schema ${BOSS_SCHEMA}
        grant select, insert, update, delete on tables to ${role};
      alter default privileges in schema ${BOSS_SCHEMA} grant execute on functions to ${role};`);
  } finally {
    await client.end();
  }
};
