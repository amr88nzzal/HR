import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, pingDb, type Db } from './index.js';
import { sql } from 'kysely';

// يتطلب Docker (يعمل في CI). يختبر على PostgreSQL 18 الحقيقي.
describe('migrations على PostgreSQL 18', () => {
  let container: StartedPostgreSqlContainer;
  let db: Db;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env['TEST_PG_IMAGE'] ?? 'postgres:18',
    ).start();
    const url = container.getConnectionUri();
    execFileSync('pnpm', ['migrate', 'up'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });
    db = createDb(url);
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('الاتصال يعمل', async () => {
    await expect(pingDb(db)).resolves.toBeUndefined();
  });

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
