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
import { seedDemoHistory } from './demo-history.js';

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
      'leave:done',
      'attendance:done',
      'punches:done',
      'import:done',
      'adjustments:done',
      'letters:done',
      'payroll:done',
      'payrollRuns:done',
      'accounts:done',
      'loans:done',
      'payslips:done',
      'reports:done',
      'brand:done',
      'payslipTemplates:done',
      'payrollAccounting:done',
      'adminActions:done',
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
    expect(await n('approval_requests', sql`request_type = 'general'`)).toBe(7);
    for (const status of ['pending', 'approved', 'rejected', 'returned', 'withdrawn'])
      expect(await n('approval_requests', sql`status = ${status}`)).toBeGreaterThan(0);
    expect(await n('approver_delegations')).toBe(1);
    expect(await n('notifications')).toBeGreaterThan(5);

    // الإجازات: أنواع وسياسات وعطل ودفتر وطلبات بكل الحالات
    expect(await n('leave_types')).toBe(3);
    expect(await n('leave_policies')).toBe(3);
    expect(await n('holidays')).toBe(5);
    for (const status of ['pending', 'approved', 'rejected', 'withdrawn', 'cancelled'])
      expect(await n('leave_requests', sql`status = ${status}`)).toBeGreaterThan(0);
    expect(await n('leave_ledger', sql`entry_type = 'carry_over'`)).toBeGreaterThan(0);
    expect(await n('leave_ledger', sql`entry_type = 'adjustment'`)).toBe(2);
    expect(await n('leave_request_days', sql`kind = 'holiday'`)).toBeGreaterThan(0);

    // الحضور: ورديات (عادية ومقسومة وليلية) وجداول وتعيينات بالأخص
    expect(await n('shifts')).toBe(3);
    expect(await n('shift_segments')).toBe(4);
    expect(await n('shift_segments', sql`ends_next_day`)).toBe(1);
    expect(await n('work_schedules')).toBe(3);
    expect(await n('work_schedule_days')).toBe(21);
    expect(await n('schedule_assignments', sql`scope = 'company'`)).toBe(1);
    expect(await n('schedule_assignments', sql`scope = 'department'`)).toBe(1);
    expect(await n('schedule_assignments', sql`scope = 'employee'`)).toBe(1);

    // البصمات: حضور وتأخير وغياب وليلي وتجاوز مفتوح
    expect(await n('attendance_records', sql`note = 'DEMO'`)).toBeGreaterThan(100);
    expect(await n('attendance_days', sql`status = 'present'`)).toBeGreaterThan(50);
    expect(await n('attendance_days', sql`late_minutes > 0`)).toBeGreaterThan(0);
    expect(await n('attendance_days', sql`early_leave_minutes > 0`)).toBeGreaterThan(0);
    expect(
      await n('attendance_days', sql`status = 'absent' and override_status is null`),
    ).toBeGreaterThan(0);
    expect(await n('attendance_days', sql`override_status is not null`)).toBe(1);

    // الاستيراد: ملف افتراضي ومراجع أجهزة ودفعة مطبَّقة وسجلات محجوزة
    expect(await n('import_profiles')).toBe(1);
    expect(await n('import_batches', sql`status = 'applied'`)).toBe(1);
    expect(await n('employee_external_refs', sql`notes is null`)).toBeGreaterThanOrEqual(6);
    expect(await n('attendance_records', sql`source = 'import'`)).toBeGreaterThan(50);
    expect(await n('import_held_rows', sql`status = 'held'`)).toBeGreaterThan(10);

    // تعديلات الحضور والعمل الإضافي بكل الحالات
    expect(await n('attendance_corrections', sql`status = 'approved' and method = 'request'`)).toBe(
      1,
    );
    expect(await n('attendance_corrections', sql`status = 'approved' and method = 'direct'`)).toBe(
      1,
    );
    expect(await n('attendance_corrections', sql`status = 'pending'`)).toBe(1);
    expect(await n('attendance_corrections', sql`status = 'rejected'`)).toBe(1);
    expect(await n('overtime_requests', sql`status = 'approved'`)).toBe(1);
    expect(await n('overtime_requests', sql`status = 'rejected'`)).toBe(1);
    expect(await n('overtime_requests', sql`status = 'pending'`)).toBe(2);
    expect(await n('attendance_days', sql`overtime_minutes > 0`)).toBe(1);
    expect(await n('attendance_days', sql`surplus_minutes > 0`)).toBeGreaterThanOrEqual(3);

    // قوالب الوثائق: عربي وإنجليزي بإصدارين لكل منهما (مفعّل ومسودة)
    expect(await n('letter_templates')).toBe(2);
    expect(await n('letter_template_versions', sql`status = 'active'`)).toBe(2);
    expect(await n('letter_template_versions', sql`status = 'draft'`)).toBe(2);

    // هيكل الرواتب: أسس ومكونات وجدول نسب وهيكلان وراتب لكل موظف (مع زيادتين)
    expect(await n('payroll_bases')).toBe(2);
    expect(await n('pay_components')).toBe(7);
    expect(await n('rate_tables')).toBe(1);
    expect(await n('salary_structures')).toBe(2);
    expect(await n('employee_salaries', sql`valid_to is null`)).toBe(30);
    expect(await n('employee_salaries', sql`valid_to is not null`)).toBe(2);

    // دورة الرواتب: مجموعة افتراضية وسببا تجاوز ودورة مسودة محتسبة بقسائم
    expect(await n('pay_groups', sql`is_default`)).toBe(1);
    expect(await n('override_reasons')).toBe(2);
    expect(await n('payroll_periods', sql`status = 'draft' and calculated_at is not null`)).toBe(1);
    expect(await n('payslips')).toBeGreaterThan(0);
    expect(await n('payslips', sql`status = 'error'`)).toBe(0);

    // حساب مدعو لموظف تجريبي (يظهر «مدعو» في بطاقته)
    const invited = await sql<{ n: string }>`
      select count(*)::text as n from users u
       where u.company_id = ${companyId} and u.email like 'demo.invited@%'
         and exists (select 1 from employees e where e.user_id = u.id)
         and exists (select 1 from password_resets p where p.user_id = u.id and p.used_at is null)`.execute(
      admin,
    );
    expect(Number(invited.rows[0]?.n)).toBe(1);

    // الإجراءات الإدارية: أنواع افتراضية + 7 إجراءات بحالات متنوعة
    expect(await n('admin_action_types')).toBe(9);
    expect(await n('admin_actions')).toBe(7);
    expect(await n('admin_actions', sql`status = 'approved'`)).toBe(5);
    expect(await n('admin_actions', sql`acknowledged_at is not null`)).toBe(1);

    // السلف: ثلاث سلف بأقساطها ودفعات صرف، وأقساط ظاهرة في الدورة (واحدة تتجاوز السقف)
    expect(await n('loans')).toBe(6); // 3 سلف + 3 فواتير ذمم
    expect(await n('loan_installments')).toBe(13);
    expect(await n('payments', sql`kind = 'loan'`)).toBe(3);
    expect(await n('payslips', sql`loans_amount > 0`)).toBeGreaterThan(0);
    expect(await n('payslip_loan_items', sql`over_cap`)).toBeGreaterThan(0);

    // الهوية البصرية: نصوص بلغتين وقالبا الشهادة يستعملان الترويسة
    expect(await n('company_brand')).toBe(1);
    expect(await n('letter_templates', sql`use_letterhead`)).toBe(2);

    // قوالب القسيمة: ثلاثة تصاميم جاهزة وواحد افتراضي
    expect(await n('payslip_templates')).toBe(3);
    expect(await n('payslip_templates', sql`is_default`)).toBe(1);

    // حسابات المحاسبة: حسابات الشركة وربط المكونات التجريبية كلها
    expect(await n('payroll_gl_settings')).toBe(1);
    expect(await n('pay_components', sql`code like 'demo\\_%' and gl_account is null`)).toBe(0);
    expect(
      await n('pay_components', sql`kind = 'employer' and gl_offset_account is not null`),
    ).toBeGreaterThan(0);

    // قسائم منشورة: دورة مقفلة سابقة للدورة التجريبية، قسائمها تظهر للموظف
    expect(await n('payroll_periods', sql`status = 'locked'`)).toBe(1);
    expect(
      await n(
        'payslips',
        sql`period_id in (select id from payroll_periods where status = 'locked')`,
      ),
    ).toBeGreaterThan(0);

    // تخطيطات التقارير: افتراضي لمستخدمين تجريبيين
    expect(await n('report_layouts', sql`is_default and name like 'DEMO%'`)).toBeGreaterThan(0);

    const again = await seedDemoExtras(admin, companyId, { crypto, password: 'Demo-pass-12345' });
    expect(again.every((p) => p.status === 'skipped')).toBe(true);
    expect(await n('employee_addresses')).toBe(30);
  });
  it('طبقة التاريخ: ستة أشهر من الحضور والإجازات والرواتب، وتُضاف مرة واحدة', async () => {
    const first = await seedDemoHistory(admin, companyId);
    expect(first.map((p) => `${p.part}:${p.status}`)).toEqual([
      'historyLeave:done',
      'historyAttendance:done',
      'historyPayroll:done',
      'historyShortfall:done',
    ]);
    const n = async (table: string, where = sql`true`) =>
      Number(
        (
          await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)}
            where company_id = ${companyId} and ${where}`.execute(admin)
        ).rows[0]?.n,
      );
    // حضور يمتد قرابة ستة أشهر
    const span = await sql<{
      d: number;
    }>`select (max(day_date) - min(day_date))::int as d from attendance_days
      where company_id = ${companyId}`.execute(admin);
    expect(span.rows[0]!.d).toBeGreaterThan(170);
    expect(await n('attendance_days', sql`status = 'absent'`)).toBeGreaterThan(20);
    // إجازات تاريخية بحالات معتمدة ومرفوضة
    expect(await n('leave_requests', sql`reason like '%DEMO-HIST%' and status = 'approved'`)).toBe(
      7,
    );
    expect(await n('leave_requests', sql`reason like '%DEMO-HIST%' and status = 'rejected'`)).toBe(
      1,
    );
    // ستة أشهر رواتب: مسودة + خمس مقفلة، ودفعات مدفوعة ومعلّقة
    expect(await n('payroll_periods')).toBe(6);
    expect(await n('payroll_periods', sql`status = 'locked'`)).toBe(5);
    expect(await n('payments', sql`kind = 'payslip' and status = 'paid'`)).toBeGreaterThan(0);
    expect(await n('payments', sql`kind = 'payslip' and status = 'pending'`)).toBeGreaterThan(0);
    // سلفة مسدَّدة بأقساطها الأربعة المخصومة
    expect(await n('loans', sql`status = 'settled'`)).toBe(1);
    expect(await n('loan_installments', sql`status = 'deducted'`)).toBe(4);

    // نقص الدوام: سياسة مفعّلة وقرارا مدير (رصيد وإعفاء)، وأثرهما في قسائم المسودة
    expect(await n('shortfall_policies', sql`is_enabled`)).toBe(1);
    expect(await n('shortfall_decisions', sql`target = 'leave'`)).toBe(1);
    expect(await n('shortfall_decisions', sql`target = 'waive'`)).toBe(1);
    expect(await n('payslip_shortfalls')).toBeGreaterThan(0);
    expect(await n('payslip_lines', sql`code = 'shortfall_deduction'`)).toBeGreaterThan(0);

    const again = await seedDemoHistory(admin, companyId);
    expect(again.every((p) => p.status === 'skipped')).toBe(true);
  });
});
