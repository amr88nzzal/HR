import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import { startTestPg, type TestPg } from '../test/pg.js';
import { seedDefaultRoles, syncPermissionCatalog } from '../modules/identity/index.js';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { createFieldCrypto } from '../shared/crypto.js';
import { seedDemo } from './demo.js';
import { seedDemoExtras } from './demo-extras.js';

describe('البيانات التجريبية', () => {
  let pgx: TestPg;
  let admin: Db;
  let companyId: string;

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    const c = await admin
      .insertInto('companies')
      .values({ slug: 'demo', nameAr: 'تجريبية' })
      .returning('id')
      .executeTakeFirstOrThrow();
    companyId = c.id;
    await withTenant(admin, { companyId }, (ctx) => seedDefaultRoles(ctx));
  }, 120_000);

  afterAll(async () => {
    await admin?.destroy();
    await pgx?.stop();
  });

  it('يبذر الهيكل والموظفين والمستخدمين ثم يتجاهل التكرار', async () => {
    const first = await withTenant(admin, { companyId }, (ctx) => seedDemo(ctx, 'Demo-pass-12345'));
    expect(first.skipped).toBe(false);
    expect(first.employees).toBe(30);
    expect(first.users).toHaveLength(3);

    const counts = await withTenant(admin, { companyId }, async (ctx) => {
      const n = async (t: 'employees' | 'employments' | 'branches' | 'departments' | 'users') =>
        Number(
          (
            await ctx.trx
              .selectFrom(t)
              .select((eb) => eb.fn.countAll().as('c'))
              .where('companyId', '=', companyId)
              .executeTakeFirstOrThrow()
          ).c,
        );
      const linked = await ctx.trx
        .selectFrom('employees')
        .select('id')
        .where('userId', 'is not', null)
        .execute();
      return {
        employees: await n('employees'),
        employments: await n('employments'),
        branches: await n('branches'),
        departments: await n('departments'),
        users: await n('users'),
        linked: linked.length,
      };
    });
    expect(counts).toEqual({
      employees: 30,
      employments: 30,
      branches: 2,
      departments: 5,
      users: 3,
      linked: 3,
    });

    const again = await withTenant(admin, { companyId }, (ctx) => seedDemo(ctx, 'Demo-pass-12345'));
    expect(again.skipped).toBe(true);
  });

  it('الطبقات الموسَّعة تغطي كل الوحدات وتُضاف مرة واحدة فقط', async () => {
    const k = () => randomBytes(32).toString('base64');
    const crypto = createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() });
    const first = await seedDemoExtras(admin, companyId, { crypto, password: 'Demo-pass-12345' });
    expect(first.map((p) => `${p.part}:${p.status}`)).toEqual([
      'details:done',
      'lifecycle:done',
      'archive:done',
      'approvals:done',
    ]);
    const n = async (table: string, where = sql`true`) =>
      Number(
        (
          await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)}
            where company_id = ${companyId} and ${where}`.execute(admin)
        ).rows[0]?.n,
      );
    expect(await n('employee_addresses')).toBe(30);
    expect(await n('employee_bank_accounts')).toBe(30);
    expect(await n('employee_dependents')).toBeGreaterThan(10);
    expect(await n('employee_education')).toBe(30);
    expect(await n('employment_changes', sql`change_type <> 'hire'`)).toBe(8);
    expect(await n('employees', sql`status = 'terminated'`)).toBe(1);
    expect(await n('employees', sql`status = 'suspended'`)).toBe(1);
    expect(await n('documents')).toBe(14 + 1 + 2);
    expect(await n('document_reminders', sql`status = 'pending'`)).toBe(17);
    expect(await n('approval_requests')).toBe(7);
    for (const status of ['pending', 'approved', 'rejected', 'returned', 'withdrawn'])
      expect(await n('approval_requests', sql`status = ${status}`)).toBeGreaterThan(0);
    expect(await n('approver_delegations')).toBe(1);
    expect(await n('notifications')).toBeGreaterThan(5);

    const again = await seedDemoExtras(admin, companyId, { crypto, password: 'Demo-pass-12345' });
    expect(again.every((p) => p.status === 'skipped')).toBe(true);
    expect(await n('employee_addresses')).toBe(30);
  });
});
