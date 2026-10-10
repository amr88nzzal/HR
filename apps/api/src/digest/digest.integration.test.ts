import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import { createApprovalEngine } from '../approvals/index.js';
import { buildRegistry } from '../jobs/registry.js';
import type { JobInfo } from '../jobs/types.js';
import {
  hashPassword,
  seedDefaultRoles,
  syncPermissionCatalog,
} from '../modules/identity/index.js';
import { createNotifier } from '../notifications/index.js';
import { seedDemo } from '../seed/demo.js';
import { startTestPg, type TestPg } from '../test/pg.js';

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('الملخص اليومي', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  const info: JobInfo = {
    runId: 'r',
    attempt: 1,
    maxAttempts: 1,
    queue: { enqueue: async () => null },
  };
  const def = buildRegistry(undefined).get('digest.daily')!;
  const run = (data: unknown = { minHour: 0 }) =>
    withTenant(app, { companyId: acme }, (ctx) =>
      def.handle(ctx, def.parse(data), info),
    ) as Promise<{
      sent?: number;
      skipped?: string;
    }>;
  const notesOf = (email: string) =>
    admin
      .selectFrom('notifications as n')
      .innerJoin('users as u', 'u.id', 'n.userId')
      .select(['n.title', 'n.body', 'n.link'])
      .where('u.email', '=', email)
      .where('n.eventKey', '=', 'digest.daily')
      .execute();

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'acme' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await withTenant(admin, { companyId: acme }, async (ctx) => {
      await seedDefaultRoles(ctx);
      await seedDemo(ctx, 'Demo-pass-12345');
      // مدير نظام بنطاق الشركة
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', acme)
        .where('code', '=', 'admin')
        .executeTakeFirstOrThrow();
      const u = await ctx.trx
        .insertInto('users')
        .values({
          companyId: acme,
          email: 'admin@acme.test',
          displayName: 'المدير',
          passwordHash: await hashPassword('Demo-pass-12345'),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: acme,
          userId: u.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();

      // وثائق بتذكيرات: متأخر، قادم، وبعيد (خارج الأفق)
      const type = await ctx.trx
        .insertInto('documentTypes')
        .values({ companyId: acme, nameAr: 'إقامة', nameEn: 'Residence', ownerType: 'employee' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const owner = await ctx.trx
        .selectFrom('employees')
        .select('id')
        .where('employeeNo', '=', 'DEMO-001')
        .executeTakeFirstOrThrow();
      for (const [key, due] of [
        ['a', day(-3)],
        ['b', day(10)],
        ['c', day(200)],
      ] as const) {
        const doc = await ctx.trx
          .insertInto('documents')
          .values({
            companyId: acme,
            documentTypeId: type.id,
            ownerType: 'employee',
            ownerId: owner.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await ctx.trx
          .insertInto('documentReminders')
          .values({ companyId: acme, documentId: doc.id, fieldKey: key, dueDate: due })
          .execute();
      }

      // سلسلة وطلب موافقة معلّق لدى المدير المباشر (demo.hr)
      const flow = await ctx.trx
        .insertInto('approvalFlows')
        .values({ companyId: acme, code: 'g', requestType: 'general', nameAr: 'عامة' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('approvalSteps')
        .values({
          companyId: acme,
          flowId: flow.id,
          position: 1,
          nameAr: 'المدير',
          approverType: 'direct_manager',
        })
        .execute();
      const requester = await ctx.trx
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'demo.employee@demo.hrms.local')
        .executeTakeFirstOrThrow();
      await createApprovalEngine(createNotifier(undefined)).submit(ctx, {
        requestType: 'general',
        title: 'طلب',
        requesterUserId: requester.id,
      });
    });
  }, 120_000);

  afterAll(async () => {
    await app?.destroy();
    await admin?.destroy();
    await pgx?.stop();
  });

  it('يرفض ساعة غير صالحة ويرسل لمن عنده ما يستحق', async () => {
    expect(() => def.parse({ minHour: 24 })).toThrow();
    expect(await run()).toEqual({ sent: 2 }); // المدير ومدير الموارد (النائب المباشر للموظف)
  });

  it('يرسل ملخصاً واحداً لكل مستخدم بما يخصه، ولا يكرر في اليوم نفسه', async () => {
    const hr = await notesOf('demo.hr@demo.hrms.local');
    expect(hr).toHaveLength(1);
    expect(hr[0]?.body).toContain('وثائق متأخرة: 1');
    expect(hr[0]?.body).toContain('وثائق تستحق خلال 30 يوماً: 1');
    expect(hr[0]?.body).toContain('طلبات موافقة بانتظار إجرائك: 1');
    expect(hr[0]?.body).not.toContain(day(200));

    const boss = await notesOf('admin@acme.test');
    expect(boss).toHaveLength(1);
    expect(boss[0]?.body).toContain('وثائق متأخرة: 1');
    expect(boss[0]?.body).not.toContain('طلبات موافقة');
    expect(boss[0]?.link).toBe('/archive/documents');

    // الموظف لا يملك الأرشيف ولا لديه طلبات معلقة
    expect(await notesOf('demo.employee@demo.hrms.local')).toHaveLength(0);
    expect(await run()).toEqual({ sent: 0 });
    expect(await notesOf('demo.hr@demo.hrms.local')).toHaveLength(1);
  });
});
