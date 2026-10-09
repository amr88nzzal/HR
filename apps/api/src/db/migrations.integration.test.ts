import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { startTestPg, type TestPg } from '../test/pg.js';
import { createDb, pingDb, type Db } from './index.js';

// يهيّئ القاعدة (تهجير كامل) عبر startTestPg: خادم خارجي (TEST_PG_ADMIN_URL) أو حاوية postgres:18.
// في CI يُثبَّت PostgreSQL 18 على المشغّل ويُشترط ذلك صراحةً بـ TEST_REQUIRE_PG18.
describe('migrations', () => {
  let pgx: TestPg;
  let db: Db;

  beforeAll(async () => {
    pgx = await startTestPg();
    db = createDb(pgx.adminUrl);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    await pgx?.stop();
  });

  it('الاتصال يعمل', async () => {
    await expect(pingDb(db)).resolves.toBeUndefined();
  });

  it.runIf(process.env['TEST_REQUIRE_PG18'] === 'true')(
    'الخادم PostgreSQL 18 أو أحدث',
    async () => {
      const { rows } = await sql<{ v: number }>`
      select current_setting('server_version_num')::int as v`.execute(db);
      expect(rows[0]?.v).toBeGreaterThanOrEqual(180000);
    },
  );

  it('uuidv7() متاحة ويُنتج معرّفاً من الإصدار 7', async () => {
    const { rows } = await sql<{ id: string }>`select uuidv7()::text as id`.execute(db);
    expect(rows[0]?.id.charAt(14)).toBe('7');
  });

  it('دالة set_updated_at موجودة بعد التهجير', async () => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_proc where proname = 'set_updated_at'`.execute(db);
    expect(rows[0]?.n).toBe(1);
  });
});
