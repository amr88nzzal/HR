import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import { startTestPg, type TestPg } from '../test/pg.js';
import { seedDefaultRoles, syncPermissionCatalog } from '../modules/identity/index.js';
import { seedDemo } from './demo.js';

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
});
