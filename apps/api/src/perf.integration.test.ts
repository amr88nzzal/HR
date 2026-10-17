import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createDb, type Db } from './db/index.js';
import { withTenant } from './db/tenant.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from './modules/identity/index.js';
import { reportJobs } from './modules/reports/index.js';
import { createLocalStorage } from './shared/storage.js';
import { startTestPg, type TestPg } from './test/pg.js';

/**
 * أداء بحجم الإنتاج المتوقَّع: PERF_EMPLOYEES موظف (افتراضياً 200) × PERF_DAYS يوم حضور (افتراضياً 180).
 * الميزانيات سخيّة عمداً (تلتقط الانحدار الحاد: فهرس ناقص أو استعلام تربيعي) لا تفاصيل الجهاز.
 * يطبع جدول الأزمنة ليُقرأ عند المراجعة.
 */
const N = Number(process.env['PERF_EMPLOYEES'] ?? 200);
const DAYS = Number(process.env['PERF_DAYS'] ?? 180);
const testStorage = createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-perf-')));
const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'p'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe(`الأداء: ${N} موظفاً × ${DAYS} يوماً`, () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let company: string;
  let api: ReturnType<typeof createApp>;
  let token = '';
  const timings: { step: string; ms: number }[] = [];
  const timed = async <T>(step: string, budgetMs: number, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const out = await fn();
    const ms = Math.round(performance.now() - t0);
    timings.push({ step, ms });
    expect(ms, `${step} تجاوز ${budgetMs}ms`).toBeLessThan(budgetMs);
    return out;
  };
  const get = (p: string) =>
    request(api).get(`/api/v1${p}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    company = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'شركة أكمي' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await withTenant(admin, { companyId: company }, (ctx) => seedDefaultRoles(ctx));
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        storage: testStorage,
        render: async () => Buffer.from('%PDF-1.4'),
      },
    });
    await withTenant(admin, { companyId: company }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', company)
        .where('code', '=', 'admin')
        .executeTakeFirstOrThrow();
      const u = await ctx.trx
        .insertInto('users')
        .values({
          companyId: company,
          email: 'admin@perf.test',
          displayName: 'مدير',
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: company,
          userId: u.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
    });
    token = (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: 'admin@perf.test', password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;
    await request(api)
      .post('/api/v1/currencies')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'SAR', nameAr: 'ريال', symbol: 'ر.س', isBase: true });

    // بيانات اصطناعية بالجملة (SQL مباشر بصلاحية المالك)
    await withTenant(admin, { companyId: company }, async (ctx) => {
      const t = ctx.trx;
      await sql`insert into branches (company_id, code, name_ar) select ${company}, 'B' || g, 'فرع ' || g from generate_series(1, 4) g`.execute(
        t,
      );
      await sql`insert into departments (company_id, code, name_ar) select ${company}, 'D' || g, 'قسم ' || g from generate_series(1, 12) g`.execute(
        t,
      );
      await sql`
        insert into employees (company_id, employee_no, first_name_ar, family_name_ar, full_name_ar, search_text, status, first_hire_date)
        select ${company}, 'E-' || lpad(g::text, 5, '0'), 'موظف', 'رقم' || g, 'موظف رقم' || g,
               'e-' || g || ' موظف رقم' || g, 'active', date '2024-01-01' + (g % 300)
          from generate_series(1, ${N}) g`.execute(t);
      await sql`insert into department_branches (company_id, department_id, branch_id)
        select ${company}, d.id, b.id from departments d cross join branches b where d.company_id = ${company} and b.company_id = ${company}`.execute(
        t,
      );
      await sql`
        insert into employments (company_id, employee_id, branch_id, department_id, employment_type, valid_from)
        select ${company}, e.id,
               (select id from branches where company_id = ${company} order by code offset (e.rn % 4) limit 1),
               (select id from departments where company_id = ${company} order by code offset (e.rn % 12) limit 1),
               'full_time', date '2024-01-01'
          from (select id, row_number() over (order by employee_no) as rn from employees where company_id = ${company}) e`.execute(
        t,
      );
      await sql`
        insert into employee_salaries (company_id, employee_id, currency, basic_amount, valid_from)
        select ${company}, id, 'SAR', 3000 + (random() * 4000)::int, date '2024-01-01'
          from employees where company_id = ${company}`.execute(t);
      await sql`
        insert into attendance_days (company_id, employee_id, day_date, status, scheduled_minutes, worked_minutes, late_minutes)
        select ${company}, e.id, d::date, case when extract(dow from d) in (5, 6) then 'off' else 'present' end,
               480, 470, (random() * 10)::int
          from employees e cross join generate_series((current_date - (${DAYS})::int)::timestamp, (current_date - 1)::timestamp, interval '1 day') d
         where e.company_id = ${company}`.execute(t);
      await sql`analyze`.execute(t);
    });
  }, 300_000);
  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.table(timings);
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('قوائم الواجهة الأساسية', async () => {
    await timed('employees list (page 50)', 1500, async () =>
      expect((await get('/employees?pageSize=50')).status).toBe(200),
    );
    await timed('employees search', 1500, async () =>
      expect((await get('/employees?q=' + encodeURIComponent('رقم17'))).status).toBe(200),
    );
    await timed('dashboard summary', 2000, async () =>
      expect((await get('/dashboard/summary')).status).toBe(200),
    );
  });

  it('التقارير: معاينة وتصدير كامل', async () => {
    const from = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    await timed('report roster run', 2000, async () =>
      expect((await get('/reports/employees.roster/run')).status).toBe(200),
    );
    await timed('report attendance.daily run (page)', 3000, async () =>
      expect(
        (await get(`/reports/attendance.daily/run?dateFrom=${from}&dateTo=${to}`)).status,
      ).toBe(200),
    );
    await timed('report attendance.summary run', 4000, async () =>
      expect(
        (await get(`/reports/attendance.summary/run?dateFrom=${from}&dateTo=${to}`)).status,
      ).toBe(200),
    );
    // تصدير كل الأيام كمهمة: مباشر محظور فوق 2000 صف، فنستدعي المحرك عبر CSV بتضييق شهر
    const monthFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const exp = await timed(
      'report attendance.daily export 30 days csv (direct)',
      15_000,
      async () =>
        get(`/reports/attendance.daily/export?format=csv&dateFrom=${monthFrom}&dateTo=${to}`),
    );
    // أكثر من 2000 صف يُرفض مباشراً بسلوك موثّق (409) — وليس خطأ
    expect([200, 409]).toContain(exp.status);
  });

  // فوق سقف 100 ألف صف يُرفض التصدير عمداً (413)، فلا معنى لقياسه
  it.skipIf(N * DAYS > 100_000)(
    'التصدير الكبير كمهمة خلفية: كل أيام الحضور (CSV وXLSX) على دفعات',
    async () => {
      const userId = (
        await admin
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@perf.test')
          .executeTakeFirstOrThrow()
      ).id;
      const [exportJob] = reportJobs({ storage: testStorage, crypto: undefined });
      const info = {
        runId: 'r',
        attempt: 1,
        maxAttempts: 1,
        queue: { enqueue: async () => 'x' } as never,
      };
      const from = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const expected = N * DAYS;
      for (const [format, budget] of [
        ['csv', 60_000],
        ['xlsx', 120_000],
      ] as const) {
        const rows = await timed(
          `export job attendance.daily ${format} (~${expected} rows)`,
          budget,
          async () =>
            withTenant(admin, { companyId: company }, async (ctx) => {
              const { rows: r } = await sql<{ id: string }>`
            insert into report_runs (company_id, user_id, report_code, format, mode, filters, columns, lang, status)
            values (${company}, ${userId}, 'attendance.daily', ${format}, 'job',
                    ${JSON.stringify({ dateFrom: from, dateTo: to })}::jsonb, '[]'::jsonb, 'ar', 'queued')
            returning id`.execute(ctx.trx);
              await exportJob!.handle(ctx, { runId: r[0]!.id }, info);
              const done = await sql<{
                rowCount: number;
              }>`select row_count from report_runs where id = ${r[0]!.id}`.execute(ctx.trx);
              return done.rows[0]!.rowCount;
            }),
        );
        expect(Number(rows)).toBeGreaterThanOrEqual(expected - N);
      }
    },
    300_000,
  );

  it('الرواتب: احتساب دورة كاملة وقراءتها', async () => {
    const now = new Date();
    const period = (
      await request(api)
        .post('/api/v1/payroll/periods')
        .set('Authorization', `Bearer ${token}`)
        .send({ year: now.getUTCFullYear() - 1, month: 12, currency: 'SAR' })
    ).body.data.id as string;
    await timed(`payroll calculate ${N} employees`, 60_000, async () => {
      const r = await request(api)
        .post(`/api/v1/payroll/periods/${period}/calculate`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    });
    await timed('payslips list', 2000, async () =>
      expect((await get(`/payroll/periods/${period}/payslips?pageSize=50`)).status).toBe(200),
    );
    await timed('period detail (totals)', 2000, async () =>
      expect((await get(`/payroll/periods/${period}`)).status).toBe(200),
    );
    await timed('period compare', 3000, async () =>
      expect((await get(`/payroll/periods/${period}/compare`)).status).toBe(200),
    );
    await timed('report payroll.summary', 2000, async () =>
      expect((await get('/reports/payroll.summary/run')).status).toBe(200),
    );
  }, 180_000);
});
