import { sql } from 'kysely';
import type { Ctx } from '../../db/tenant.js';
import type { EngineInput } from './engine.js';

type Row = Record<string, unknown>;
type Added = EngineInput['added'];

export const ADMIN_BONUS_CODE = 'admin_bonus';
export const ADMIN_PENALTY_CODE = 'admin_penalty';

/**
 * بنود الإجراءات الإدارية المعتمدة (خصم/مكافأة لمرة واحدة) للشهر والعملة المستهدفين.
 * تُقرأ مباشرة من الجدول (كما يقرأ المحرك الحضور والإجازات) ولا تعتمد الرواتب على وحدة الإجراءات.
 * إجراء بعملة أخرى لا يدخل الدورة ويُنذَر به عبر تحذير القسيمة.
 */
export const loadAdminLines = async (
  ctx: Ctx,
  p: { id: string; year: number; month: number; currency: string },
  employeeIds: string[],
): Promise<Map<string, { added: Added; warnings: string[] }>> => {
  const out = new Map<string, { added: Added; warnings: string[] }>();
  if (!employeeIds.length) return out;
  const { rows } = await sql<Row>`
    select a.employee_id, a.id, a.title, a.amount::text as amount, a.currency, t.payroll_effect
      from admin_actions a join admin_action_types t on t.id = a.type_id
     where a.company_id = ${ctx.companyId} and a.status = 'approved' and t.payroll_effect <> 'none'
       and a.payroll_year = ${p.year} and a.payroll_month = ${p.month}
       and (a.applied_period_id is null or a.applied_period_id = ${p.id})
       and a.employee_id = any(${employeeIds}::uuid[])
     order by a.employee_id, a.action_date, a.id`.execute(ctx.trx);
  const byEmp = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byEmp.get(r.employeeId as string) ?? [];
    list.push(r);
    byEmp.set(r.employeeId as string, list);
  }
  for (const [emp, list] of byEmp) {
    const added: Added = [];
    const warnings: string[] = [];
    if (list.some((r) => r.currency !== p.currency)) warnings.push('ADMIN_ACTION_CURRENCY');
    for (const [effect, code, nameAr, nameEn, kind] of [
      ['bonus', ADMIN_BONUS_CODE, 'مكافآت (إجراءات إدارية)', 'Bonuses (admin actions)', 'earning'],
      [
        'deduction',
        ADMIN_PENALTY_CODE,
        'جزاءات مالية (إجراءات إدارية)',
        'Penalties (admin actions)',
        'deduction',
      ],
    ] as const) {
      const items = list.filter((r) => r.payrollEffect === effect && r.currency === p.currency);
      if (!items.length) continue;
      const sum = items.reduce((a, r) => a + Math.round(Number(r.amount) * 10000), 0) / 10000;
      added.push({
        code,
        nameAr,
        nameEn,
        kind,
        amount: sum.toFixed(4),
        auto: {
          explain: {
            type: 'admin_actions',
            actions: items.map((r) => ({ id: r.id, title: r.title, amount: r.amount })),
          },
        },
      });
    }
    out.set(emp, { added, warnings });
  }
  return out;
};

/** عند قفل الدورة: تعليم الإجراءات المخصومة/المضافة بالدورة فلا تتكرر في دورة أخرى */
export const applyAdminActionsOnLock = async (
  ctx: Ctx,
  p: { id: string; year: number; month: number; currency: string },
): Promise<void> => {
  await sql`
    update admin_actions a set applied_period_id = ${p.id}, version = a.version + 1
      from admin_action_types t
     where t.id = a.type_id and a.company_id = ${ctx.companyId} and a.status = 'approved'
       and t.payroll_effect <> 'none' and a.applied_period_id is null
       and a.payroll_year = ${p.year} and a.payroll_month = ${p.month} and a.currency = ${p.currency}
       and exists (select 1 from payslips s where s.period_id = ${p.id} and s.employee_id = a.employee_id
                      and s.status = 'calculated')`.execute(ctx.trx);
};

/** إعادة فتح دورة مقفلة: تعود الإجراءات إلى «غير مطبّقة» لتُحتسب من جديد */
export const revertAdminActionsOnReopen = async (ctx: Ctx, periodId: string): Promise<void> => {
  await sql`update admin_actions set applied_period_id = null, version = version + 1
             where company_id = ${ctx.companyId} and applied_period_id = ${periodId}`.execute(
    ctx.trx,
  );
};
