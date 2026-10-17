import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { createLocalStorage } from '../../shared/storage.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('المرحلة 10: الإجراءات الإدارية', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const patch = (who: string, p: string, body: object = {}) =>
    request(api).patch(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));

  const makeUser = (email: string, roleCode: string) =>
    withTenant(admin, { companyId: acme }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', acme)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId: acme,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: acme,
          userId: user.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
      return user.id;
    });
  const login = async (email: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;

  const ids: Record<string, string> = {};
  const typeId: Record<string, string> = {};
  const approve = (who: string, requestId: string) =>
    post(who, `/approvals/${requestId}/actions`, { action: 'approve' });
  const mkEmp = async (name: string, basic: string) => {
    const e = (
      await post('admin', '/employees', {
        firstNameAr: name,
        familyNameAr: 'تجربة',
        firstHireDate: '2025-01-01',
      })
    ).body.data.id as string;
    const h = await post('admin', `/employees/${e}/changes`, {
      changeType: 'hire',
      effectiveDate: '2025-01-01',
      employment: {
        branchId: ids['br'],
        departmentId: ids['dep'],
        employmentType: 'full_time',
        jobTitleId: ids['t1'],
      },
    });
    expect(h.status).toBe(201);
    expect(
      (
        await post('admin', `/employees/${e}/salaries`, {
          currency: 'SAR',
          basicAmount: basic,
          validFrom: '2025-01-01',
          components: [],
        })
      ).status,
    ).toBe(201);
    return e;
  };
  const slipLines = async (periodId: string, employeeId: string) => {
    const list = await get('admin', `/payroll/periods/${periodId}/payslips?pageSize=100`);
    const slip = (list.body.data as { id: string; employeeId: string }[]).find(
      (s) => s.employeeId === employeeId,
    )!;
    const det = await get('admin', `/payroll/payslips/${slip.id}`);
    return det.body.data as {
      netAmount: string;
      lines: { code: string; amount: string; kind: string; explain: { type?: string } }[];
    };
  };

  let empA: string;
  let empB: string;

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'شركة أكمي' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await withTenant(admin, { companyId: acme }, (ctx) => seedDefaultRoles(ctx));
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        publicUrl: 'https://hr.example.com',
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-aa-'))),
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hrm@acme.test', 'hr_manager');
    await makeUser('hro@acme.test', 'hr_officer');
    const ua = await makeUser('empa@acme.test', 'employee');
    await makeUser('empb@acme.test', 'employee');
    for (const who of ['admin', 'hrm', 'hro', 'empa', 'empb'])
      tokens[who] = await login(`${who}@acme.test`);
    await post('admin', '/currencies', {
      code: 'SAR',
      nameAr: 'ريال',
      symbol: 'ر.س',
      isBase: true,
    });
    ids['br'] = (await post('admin', '/branches', { code: 'B1', nameAr: 'فرع' })).body.data.id;
    ids['dep'] = (
      await post('admin', '/departments', { code: 'D1', nameAr: 'قسم', branchIds: [ids['br']] })
    ).body.data.id;
    ids['t1'] = (await post('admin', '/job-titles', { code: 'T1', nameAr: 'أخصائي' })).body.data.id;
    ids['t2'] = (
      await post('admin', '/job-titles', { code: 'T2', nameAr: 'أخصائي أول' })
    ).body.data.id;
    empA = await mkEmp('أحمد', '3000');
    empB = await mkEmp('باسل', '5000');
    await withTenant(admin, { companyId: acme }, async (ctx) => {
      await ctx.trx.updateTable('employees').set({ userId: ua }).where('id', '=', empA).execute();
      const ub = await ctx.trx
        .selectFrom('users')
        .select('id')
        .where('email', '=', 'empb@acme.test')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .updateTable('employees')
        .set({ userId: ub.id })
        .where('id', '=', empB)
        .execute();
    });
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('الأنواع الافتراضية تُنشأ مرة واحدة، وقواعد النوع تُتحقق، والمستخدم بلا صلاحية يُمنع', async () => {
    expect((await post('empa', '/admin-action-types/defaults')).status).toBe(403);
    const d = await post('hrm', '/admin-action-types/defaults');
    expect(d.status).toBe(201);
    expect(d.body.data.created).toBe(9);
    expect((await post('hrm', '/admin-action-types/defaults')).body.data.created).toBe(0);
    const list = (await get('hrm', '/admin-action-types')).body.data as {
      id: string;
      code: string;
      version: number;
      escalationTypeId: string | null;
    }[];
    for (const t of list) typeId[t.code] = t.id;
    expect(list).toHaveLength(9);
    expect(list.find((t) => t.code === 'notice_verbal')?.escalationTypeId).toBe(
      typeId['warning_written'],
    );
    // أثر مالي على إنذار مرفوض
    const bad = await patch('hrm', `/admin-action-types/${typeId['warning_written']}`, {
      version: 1,
      payrollEffect: 'deduction',
    });
    expect(bad.status).toBe(400);
    const dup = await post('hrm', '/admin-action-types', {
      code: 'promotion',
      nameAr: 'مكرر',
      category: 'other',
    });
    expect(dup.status).toBe(409);
  });

  it('نوع بلا موافقة: يُعتمد فوراً، ويراه الموظف وحده ويقرّ بالاستلام', async () => {
    const r = await post('hrm', '/admin-actions', {
      employeeId: empA,
      typeId: typeId['notice_verbal'],
      title: 'تأخر متكرر',
      actionDate: '2026-10-01',
      submit: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('approved');
    const mine = await get('empa', '/me/admin-actions');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].title).toBe('تأخر متكرر');
    expect((await get('empb', '/me/admin-actions')).body.data).toHaveLength(0);
    const id = r.body.data.id as string;
    expect((await post('empb', `/me/admin-actions/${id}/acknowledge`)).status).toBe(404);
    expect((await post('empa', `/me/admin-actions/${id}/acknowledge`)).status).toBe(200);
    expect((await post('empa', `/me/admin-actions/${id}/acknowledge`)).status).toBe(200);
    const row = (await get('empa', '/me/admin-actions')).body.data[0];
    expect(row.acknowledgedAt).toBeTruthy();
    // الموظف بلا صلاحية العرض الإداري
    expect((await get('empa', '/admin-actions')).status).toBe(403);
    // موظف الموارد لا يرى الإجراءات الإدارية افتراضياً
    expect((await get('hro', '/admin-actions')).status).toBe(403);
  });

  it('اقتراح التصعيد: بعد تكرار التنبيه الشفهي يُقترح الإنذار الكتابي', async () => {
    for (const day of ['2026-10-05', '2026-10-07']) {
      await post('hrm', '/admin-actions', {
        employeeId: empA,
        typeId: typeId['notice_verbal'],
        title: `تنبيه ${day}`,
        actionDate: day,
        submit: true,
      });
    }
    const s = await get(
      'hrm',
      `/admin-actions/suggest?employeeId=${empA}&typeId=${typeId['notice_verbal']}`,
    );
    expect(s.body.data.count).toBe(3);
    expect(s.body.data.suggested?.id).toBe(typeId['warning_written']);
    const none = await get(
      'hrm',
      `/admin-actions/suggest?employeeId=${empB}&typeId=${typeId['notice_verbal']}`,
    );
    expect(none.body.data.suggested).toBeNull();
  });

  it('نوع بموافقة: مسودة ثم إرسال ثم اعتماد مدير الموارد، والرفض يُنهيها', async () => {
    const created = await post('admin', '/admin-actions', {
      employeeId: empB,
      typeId: typeId['warning_written'],
      title: 'مخالفة سلوك',
      actionDate: '2026-01-15',
    });
    expect(created.body.data.status).toBe('draft');
    const id = created.body.data.id as string;
    const upd = await patch('admin', `/admin-actions/${id}`, {
      version: 1,
      title: 'مخالفة سلوك (معدّل)',
    });
    expect(upd.status).toBe(200);
    expect((await patch('admin', `/admin-actions/${id}`, { version: 1, title: 'x' })).status).toBe(
      409,
    );
    const sub = await post('admin', `/admin-actions/${id}/submit`);
    expect(sub.body.data.status).toBe('pending');
    const det = (await get('hrm', `/admin-actions/${id}`)).body.data;
    expect(det.status).toBe('pending');
    expect((await approve('hrm', det.approvalRequestId)).status).toBe(200);
    expect((await get('hrm', `/admin-actions/${id}`)).body.data.status).toBe('approved');
    expect((await get('empb', '/me/admin-actions')).body.data).toHaveLength(1);

    const other = await post('admin', '/admin-actions', {
      employeeId: empB,
      typeId: typeId['warning_written'],
      title: 'سيُرفض',
      actionDate: '2026-01-16',
      submit: true,
    });
    const d2 = (await get('hrm', `/admin-actions/${other.body.data.id}`)).body.data;
    expect(
      (
        await post('hrm', `/approvals/${d2.approvalRequestId}/actions`, {
          action: 'reject',
          note: 'غير كافٍ',
        })
      ).status,
    ).toBe(200);
    expect((await get('hrm', `/admin-actions/${other.body.data.id}`)).body.data.status).toBe(
      'rejected',
    );
    // لا يظهر للموظف
    expect((await get('empb', '/me/admin-actions')).body.data).toHaveLength(1);
  });

  it('التحقق: مبلغ وعملة مطلوبان لأثر الراتب، والمبلغ غير مسموح لغير المالي، والنوع المستخدم لا يُحذف', async () => {
    const base = { employeeId: empA, title: 'خصم', actionDate: '2026-01-20' };
    expect(
      (await post('admin', '/admin-actions', { ...base, typeId: typeId['penalty_deduction'] }))
        .status,
    ).toBe(400);
    expect(
      (
        await post('admin', '/admin-actions', {
          ...base,
          typeId: typeId['warning_final'],
          amount: '50',
          currency: 'SAR',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('admin', '/admin-actions', {
          ...base,
          typeId: typeId['penalty_deduction'],
          amount: '50',
          currency: 'XXX',
        })
      ).status,
    ).toBe(400);
    expect((await del('hrm', `/admin-action-types/${typeId['notice_verbal']}`)).status).toBe(409);
  });

  it('تغذية الرواتب: الخصم والمكافأة بنداً مستقلاً مرة واحدة، ثم يُعلَّمان عند القفل ويُفكّان عند إعادة الفتح', async () => {
    const mk = async (typeCode: string, amount: string, title: string) => {
      const r = await post('admin', '/admin-actions', {
        employeeId: empA,
        typeId: typeId[typeCode],
        title,
        actionDate: '2026-01-20',
        amount,
        currency: 'SAR',
        submit: true,
      });
      expect(r.status).toBe(201);
      const d = (await get('hrm', `/admin-actions/${r.body.data.id}`)).body.data;
      expect((await approve('hrm', d.approvalRequestId)).status).toBe(200);
      return r.body.data.id as string;
    };
    const pen = await mk('penalty_deduction', '100', 'خصم تأخير');
    const bon = await mk('reward_cash', '250', 'مكافأة إنجاز');
    expect((await get('hrm', `/admin-actions/${pen}`)).body.data.payrollMonth).toBe(1);

    const period = (
      await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' })
    ).body.data.id as string;
    expect((await post('admin', `/payroll/periods/${period}/calculate`)).status).toBe(200);
    const a = await slipLines(period, empA);
    const byCode = Object.fromEntries(a.lines.map((l) => [l.code, l]));
    expect(byCode['admin_penalty']?.amount).toBe('100.0000');
    expect(byCode['admin_penalty']?.kind).toBe('deduction');
    expect(byCode['admin_bonus']?.amount).toBe('250.0000');
    expect(byCode['admin_bonus']?.explain.type).toBe('admin_actions');
    expect(Number(a.netAmount)).toBe(3000 - 100 + 250);
    // الموظف الآخر بلا بنود
    expect((await slipLines(period, empB)).lines.some((l) => l.code.startsWith('admin_'))).toBe(
      false,
    );
    // إعادة الاحتساب لا تكرر البنود
    await post('admin', `/payroll/periods/${period}/calculate`);
    const again = await slipLines(period, empA);
    expect(again.lines.filter((l) => l.code === 'admin_penalty')).toHaveLength(1);
    expect(Number(again.netAmount)).toBe(3150);

    expect((await post('admin', `/payroll/periods/${period}/approve`)).status).toBe(200);
    expect((await post('admin', `/payroll/periods/${period}/lock`)).status).toBe(200);
    const applied = await admin
      .selectFrom('adminActions')
      .select(['id', 'appliedPeriodId'])
      .where('id', 'in', [pen, bon])
      .execute();
    expect(applied.every((x) => x.appliedPeriodId === period)).toBe(true);
    // لا يُلغى بعد التنفيذ المالي
    const c = await post('admin', `/admin-actions/${pen}/cancel`, { reason: 'خطأ في الإدخال' });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('APPLIED_IN_PAYROLL');

    expect(
      (await post('admin', `/payroll/periods/${period}/reopen`, { reason: 'تصحيح' })).status,
    ).toBe(200);
    const reverted = await admin
      .selectFrom('adminActions')
      .select('appliedPeriodId')
      .where('id', '=', pen)
      .executeTakeFirstOrThrow();
    expect(reverted.appliedPeriodId).toBeNull();
    // الآن يمكن إلغاؤه، ويخرج من الاحتساب
    expect(
      (await post('admin', `/admin-actions/${pen}/cancel`, { reason: 'خطأ في الإدخال' })).status,
    ).toBe(200);
    await post('admin', `/payroll/periods/${period}/calculate`);
    const after = await slipLines(period, empA);
    expect(after.lines.some((l) => l.code === 'admin_penalty')).toBe(false);
    expect(Number(after.netAmount)).toBe(3250);
  });

  it('الترقية: عند الاعتماد تُنشأ تغيير تعيين وراتب جديد بتاريخ السريان، ويُتحقق من التاريخ مسبقاً', async () => {
    const bad = await post('admin', '/admin-actions', {
      employeeId: empB,
      typeId: typeId['promotion'],
      title: 'ترقية',
      actionDate: '2026-02-01',
      effectiveDate: '2024-01-01',
      promotion: { jobTitleId: ids['t2'] },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await post('admin', '/admin-actions', {
          employeeId: empB,
          typeId: typeId['promotion'],
          title: 'بلا بيانات',
          actionDate: '2026-02-01',
        })
      ).status,
    ).toBe(400);
    const r = await post('admin', '/admin-actions', {
      employeeId: empB,
      typeId: typeId['promotion'],
      title: 'ترقية إلى أخصائي أول',
      actionDate: '2026-02-01',
      effectiveDate: '2026-03-01',
      promotion: { jobTitleId: ids['t2'], newBasicAmount: '6000' },
      submit: true,
    });
    expect(r.status).toBe(201);
    const id = r.body.data.id as string;
    const d = (await get('hrm', `/admin-actions/${id}`)).body.data;
    expect((await approve('hrm', d.approvalRequestId)).status).toBe(200);
    const done = (await get('hrm', `/admin-actions/${id}`)).body.data;
    expect(done.status).toBe('approved');
    expect(done.employmentChangeId).toBeTruthy();
    expect(done.salaryId).toBeTruthy();
    const emps = await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx
        .selectFrom('employments')
        .select(['jobTitleId', 'validFrom'])
        .where('employeeId', '=', empB)
        .orderBy('validFrom', 'desc')
        .execute(),
    );
    expect(emps[0]!.jobTitleId).toBe(ids['t2']);
    expect(String(emps[0]!.validFrom).slice(0, 10)).toBe('2026-03-01');
    const sal = await withTenant(
      admin,
      { companyId: acme },
      async (ctx) =>
        (
          await sql<{ basic: string; from: string }>`
          select basic_amount::text as basic, valid_from::text as from from employee_salaries
           where employee_id = ${empB} order by valid_from desc limit 1`.execute(ctx.trx)
        ).rows[0],
    );
    expect(Number(sal!.basic)).toBe(6000);
    expect(sal!.from).toBe('2026-03-01');
    // لا يُلغى بعد التطبيق
    expect(
      (await post('admin', `/admin-actions/${id}/cancel`, { reason: 'تراجع عن القرار' })).status,
    ).toBe(409);
  });

  it('الفرز والتصفية والنطاق: القائمة تُفرز في الخادم والموظف بلا صلاحية يُمنع', async () => {
    const byAmount = await get('hrm', '/admin-actions?sort=-amount&category=reward_cash');
    expect(byAmount.status).toBe(200);
    expect(
      byAmount.body.data.every((x: { category: string }) => x.category === 'reward_cash'),
    ).toBe(true);
    const byEmp = await get('hrm', `/admin-actions?employeeId=${empB}&sort=employee`);
    expect(byEmp.body.data.every((x: { employeeId: string }) => x.employeeId === empB)).toBe(true);
    expect((await get('hrm', '/admin-actions?sort=password')).status).toBe(400);
    const all = await get('hrm', '/admin-actions?pageSize=200');
    expect(all.body.meta.total).toBeGreaterThanOrEqual(8);
    expect((await get('empa', `/admin-actions/${all.body.data[0].id}`)).status).toBe(403);
  });
});
