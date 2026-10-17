import { sql } from 'kysely';
import type { AdminActionInput, PromotionInput } from '@hrms/shared';
import type { ApprovalEngine } from '../../approvals/index.js';
import { registerApprovalRequestType } from '../../approvals/index.js';
import type { Ctx } from '../../db/tenant.js';
import type { Notifier } from '../../notifications/index.js';
import { AppError } from '../../shared/errors.js';
import { applyChange } from '../employees/index.js';
import { addSalary } from '../payroll/index.js';

type Row = Record<string, unknown>;
const bad = (code: string, message: string, status = 400) => new AppError(code, status, message);

/** مرسِل الإشعارات: يُضبط عند تركيب المسارات (الموافقة النهائية تجري داخل محرك الموافقات بلا وصول للتبعيات) */
let notifier: Notifier | null = null;
export const setAdminActionNotifier = (n: Notifier): void => {
  notifier = n;
};

export const companyToday = async (ctx: Ctx): Promise<string> =>
  (await sql<{ d: string }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx))
    .rows[0]!.d;

export type TypeRow = {
  id: string;
  code: string;
  nameAr: string;
  category: string;
  payrollEffect: 'none' | 'deduction' | 'bonus';
  requiresApproval: boolean;
  requiresAcknowledgment: boolean;
  letterTemplateCode: string | null;
  isActive: boolean;
};

export const loadType = async (ctx: Ctx, id: string): Promise<TypeRow> => {
  const t = await ctx.trx
    .selectFrom('adminActionTypes')
    .select([
      'id',
      'code',
      'nameAr',
      'category',
      'payrollEffect',
      'requiresApproval',
      'requiresAcknowledgment',
      'letterTemplateCode',
      'isActive',
    ])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!t) throw bad('INVALID_REFERENCE', 'نوع الإجراء غير موجود');
  return t as TypeRow;
};

export type ActionRow = {
  id: string;
  employeeId: string;
  typeId: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  title: string;
  effectiveDate: string;
  amount: string | null;
  currency: string | null;
  promotion: PromotionInput | null;
  approvalRequestId: string | null;
  appliedPeriodId: string | null;
  employmentChangeId: string | null;
  acknowledgedAt: Date | null;
  version: number;
};

const ACTION_COLS = [
  'id',
  'employeeId',
  'typeId',
  'status',
  'title',
  'effectiveDate',
  'amount',
  'currency',
  'promotion',
  'approvalRequestId',
  'appliedPeriodId',
  'employmentChangeId',
  'acknowledgedAt',
  'version',
] as const;

export const loadAction = async (ctx: Ctx, id: string, lock = false): Promise<ActionRow> => {
  let q = ctx.trx
    .selectFrom('adminActions')
    .select([...ACTION_COLS])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', id);
  if (lock) q = q.forUpdate();
  const a = await q.executeTakeFirst();
  if (!a) throw new AppError('NOT_FOUND', 404, 'الإجراء غير موجود');
  return a as unknown as ActionRow;
};

/** سلسلة افتراضية: مدير الموارد البشرية (دور hr_manager) */
const ensureFlow = async (ctx: Ctx): Promise<void> => {
  const exists = await ctx.trx
    .selectFrom('approvalFlows')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('requestType', '=', 'admin_action')
    .where('isActive', '=', true)
    .executeTakeFirst();
  if (exists) return;
  const hr = await ctx.trx
    .selectFrom('roles')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('code', '=', 'hr_manager')
    .executeTakeFirst();
  if (!hr)
    throw bad('NO_FLOW', 'لا توجد سلسلة موافقة للإجراءات الإدارية ولا دور مدير موارد بشرية', 409);
  const flow = await ctx.trx
    .insertInto('approvalFlows')
    .values({
      companyId: ctx.companyId,
      code: 'admin-action-default',
      requestType: 'admin_action',
      nameAr: 'سلسلة موافقة الإجراءات الإدارية',
      nameEn: 'Administrative actions approval',
    })
    .returning('id')
    .onConflict((oc) => oc.columns(['companyId', 'code']).doNothing())
    .executeTakeFirst();
  if (!flow) return;
  await ctx.trx
    .insertInto('approvalSteps')
    .values({
      companyId: ctx.companyId,
      flowId: flow.id,
      position: 1,
      nameAr: 'مدير الموارد البشرية',
      nameEn: 'HR manager',
      approverType: 'role',
      approverRef: hr.id,
    })
    .execute();
};

type Emp = {
  id: string;
  userId: string | null;
  fullNameAr: string;
  status: string;
};
export const loadEmployee = async (ctx: Ctx, employeeId: string): Promise<Emp> => {
  const e = await ctx.trx
    .selectFrom('employees')
    .select(['id', 'userId', 'fullNameAr', 'status'])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', employeeId)
    .executeTakeFirst();
  if (!e) throw bad('INVALID_REFERENCE', 'الموظف غير موجود');
  return e;
};

/** التحقق من بيانات الإجراء حسب نوعه قبل الحفظ (بما فيها الترقية، حتى لا يفشل التطبيق عند الاعتماد) */
export const validateForType = async (
  ctx: Ctx,
  type: TypeRow,
  v: {
    employeeId: string;
    effectiveDate: string;
    amount?: string | null;
    currency?: string | null;
    promotion?: PromotionInput | null;
  },
): Promise<void> => {
  if (!type.isActive) throw bad('TYPE_INACTIVE', 'نوع الإجراء معطّل', 409);
  const moneyAllowed = type.category === 'penalty' || type.category === 'reward_cash';
  if (v.amount && !moneyAllowed)
    throw bad('AMOUNT_NOT_ALLOWED', 'المبلغ خاص بالعقوبة والمكافأة النقدية');
  if (type.payrollEffect !== 'none' && (!v.amount || !v.currency))
    throw bad('AMOUNT_REQUIRED', 'المبلغ والعملة مطلوبان لهذا النوع (أثر على الراتب)');
  if (v.currency) {
    const cur = await ctx.trx
      .selectFrom('currencies')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('code', '=', v.currency)
      .executeTakeFirst();
    if (!cur) throw bad('INVALID_REFERENCE', 'العملة غير معرّفة في الشركة');
  }
  if (type.category === 'promotion') {
    if (!v.promotion) throw bad('PROMOTION_REQUIRED', 'بيانات الترقية مطلوبة لهذا النوع');
    const emp = await loadEmployee(ctx, v.employeeId);
    if (emp.status === 'terminated') throw bad('EMPLOYEE_TERMINATED', 'الموظف منتهي الخدمة', 409);
    const cur = await ctx.trx
      .selectFrom('employments')
      .select(['validFrom', 'validTo'])
      .where('employeeId', '=', v.employeeId)
      .orderBy('validFrom', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!cur || cur.validTo !== null) throw bad('NOT_EMPLOYED', 'لا يوجد تعيين قائم للموظف', 409);
    if (v.effectiveDate <= String(cur.validFrom).slice(0, 10))
      throw bad('INVALID_EFFECTIVE_DATE', 'تاريخ السريان يجب أن يلي بداية التعيين الحالي');
    if (v.promotion.newBasicAmount) {
      const sal = await ctx.trx
        .selectFrom('employeeSalaries')
        .select('validFrom')
        .where('employeeId', '=', v.employeeId)
        .orderBy('validFrom', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!sal) throw bad('NO_SALARY', 'لا يوجد راتب مسجّل للموظف لنسخ هيكله', 409);
      if (v.effectiveDate <= String(sal.validFrom).slice(0, 10))
        throw bad('SALARY_DATE_ORDER', 'تاريخ السريان يجب أن يلي تاريخ آخر راتب مسجّل');
    }
  } else if (v.promotion) throw bad('PROMOTION_NOT_ALLOWED', 'بيانات الترقية لنوع الترقية فقط');
};

/** تطبيق أثر الترقية: تغيير تعيين (المسمى/الدرجة/القسم) وراتب جديد بتاريخ السريان */
const applyPromotion = async (
  ctx: Ctx,
  a: ActionRow,
): Promise<{ changeId: string; salaryId: string | null }> => {
  const p = a.promotion as PromotionInput;
  const { newBasicAmount, ...fields } = p;
  const res = await applyChange(ctx, a.employeeId, {
    changeType: 'promotion',
    effectiveDate: a.effectiveDate,
    notes: `ترقية — ${a.title}`,
    employment: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
  });
  let salaryId: string | null = null;
  if (newBasicAmount) {
    const last = await ctx.trx
      .selectFrom('employeeSalaries')
      .select(['id', 'structureId', 'currency'])
      .where('employeeId', '=', a.employeeId)
      .orderBy('validFrom', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();
    const comps = await ctx.trx
      .selectFrom('employeeSalaryComponents')
      .select(['componentId', 'amount', 'percent'])
      .where('employeeSalaryId', '=', last.id)
      .execute();
    const created = await addSalary(ctx, a.employeeId, {
      structureId: last.structureId,
      currency: last.currency,
      basicAmount: newBasicAmount,
      validFrom: a.effectiveDate,
      note: `ترقية — ${a.title}`,
      components: comps.map((c) => ({
        componentId: c.componentId,
        ...(c.amount !== null ? { amount: String(c.amount) } : {}),
        ...(c.percent !== null ? { percent: String(c.percent) } : {}),
      })),
    });
    salaryId = String(created['id']);
  }
  return { changeId: String((res.change as Row)['id']), salaryId };
};

/** اعتماد نهائي: الحالة ← approved وتنفيذ الأثر (الترقية) وإشعار الموظف */
const approveNow = async (ctx: Ctx, id: string): Promise<void> => {
  const a = await loadAction(ctx, id, true);
  if (a.status !== 'pending' && a.status !== 'draft') return;
  const patch: Record<string, unknown> = {
    status: 'approved',
    decidedAt: new Date(),
    version: sql`version + 1`,
  };
  if (a.promotion) {
    const r = await applyPromotion(ctx, a);
    patch['employmentChangeId'] = r.changeId;
    patch['salaryId'] = r.salaryId;
  }
  await ctx.trx.updateTable('adminActions').set(patch).where('id', '=', id).execute();
  const emp = await loadEmployee(ctx, a.employeeId);
  if (emp.userId && notifier) {
    try {
      await notifier.notify(ctx, {
        userId: emp.userId,
        event: 'admin_action.issued',
        vars: { name: emp.fullNameAr, title: a.title },
        link: '/me/admin-actions',
      });
    } catch {
      /* الإشعار best-effort */
    }
  }
};

registerApprovalRequestType({
  key: 'admin_action',
  nameAr: 'إجراء إداري',
  nameEn: 'Administrative action',
  onFinal: async (ctx, request, outcome) => {
    if (!request.entityId) return;
    const a = await loadAction(ctx, request.entityId, true);
    if (a.status !== 'pending') return;
    if (outcome === 'approved') return approveNow(ctx, a.id);
    await ctx.trx
      .updateTable('adminActions')
      .set({
        status: outcome === 'rejected' ? 'rejected' : 'cancelled',
        cancelReason: outcome === 'withdrawn' ? 'سُحب الطلب' : null,
        decidedAt: new Date(),
        version: sql`version + 1`,
      })
      .where('id', '=', a.id)
      .execute();
  },
});

export type Actor = { userId: string; canCreate: boolean };

const defaultPayrollMonth = (eff: string) => ({
  year: Number(eff.slice(0, 4)),
  month: Number(eff.slice(5, 7)),
});

export const createAction = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  actor: Actor,
  input: AdminActionInput,
): Promise<string> => {
  const type = await loadType(ctx, input.typeId);
  await loadEmployee(ctx, input.employeeId);
  const eff = input.effectiveDate ?? input.actionDate;
  await validateForType(ctx, type, {
    employeeId: input.employeeId,
    effectiveDate: eff,
    amount: input.amount,
    currency: input.currency,
    promotion: input.promotion,
  });
  const pm =
    type.payrollEffect !== 'none'
      ? input.payrollYear && input.payrollMonth
        ? { year: input.payrollYear, month: input.payrollMonth }
        : defaultPayrollMonth(eff)
      : null;
  const row = await ctx.trx
    .insertInto('adminActions')
    .values({
      companyId: ctx.companyId,
      employeeId: input.employeeId,
      typeId: input.typeId,
      title: input.title,
      description: input.description ?? null,
      actionDate: input.actionDate,
      effectiveDate: eff,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      payrollYear: pm?.year ?? null,
      payrollMonth: pm?.month ?? null,
      promotion: input.promotion ? JSON.stringify(input.promotion) : null,
      createdBy: actor.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (input.submit) await submitAction(ctx, engine, actor, row.id);
  return row.id;
};

/** إرسال مسودة: بموافقة (سلسلة الموارد البشرية) أو اعتماد مباشر لمن يملك الإنشاء إن كان النوع بلا موافقة */
export const submitAction = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  actor: Actor,
  id: string,
): Promise<'pending' | 'approved'> => {
  const a = await loadAction(ctx, id, true);
  if (a.status !== 'draft') throw bad('NOT_DRAFT', 'يُرسل الإجراء من حالة المسودة فقط', 409);
  const type = await loadType(ctx, a.typeId);
  await validateForType(ctx, type, {
    employeeId: a.employeeId,
    effectiveDate: a.effectiveDate,
    amount: a.amount,
    currency: a.currency,
    promotion: a.promotion,
  });
  if (!type.requiresApproval && actor.canCreate) {
    await approveNow(ctx, id);
    return 'approved';
  }
  await ensureFlow(ctx);
  const emp = await loadEmployee(ctx, a.employeeId);
  const approval = await engine.submit(ctx, {
    requestType: 'admin_action',
    title: `${type.nameAr} — ${emp.fullNameAr}: ${a.title}`,
    requesterUserId: actor.userId,
    entityType: 'admin_action',
    entityId: id,
    payload: { employeeId: a.employeeId, typeId: a.typeId, category: type.category },
  });
  await ctx.trx
    .updateTable('adminActions')
    .set({ status: 'pending', approvalRequestId: approval.id, version: sql`version + 1` })
    .where('id', '=', id)
    .execute();
  // إن أُنهي الطلب فوراً (مثلاً خطوة بلا مُوافِقين) فالقرار يطبَّق عبر onFinal
  return 'pending';
};

/** إلغاء: مسودة أو معلّق (سحب) أو معتمد (ما لم يُنفَّذ أثره المالي في دورة مقفلة أو الترقية) */
export const cancelAction = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  actor: { userId: string },
  id: string,
  reason: string,
): Promise<void> => {
  const a = await loadAction(ctx, id, true);
  if (a.status === 'rejected' || a.status === 'cancelled')
    throw bad('ALREADY_FINAL', 'الإجراء منتهٍ بالفعل', 409);
  if (a.status === 'pending' && a.approvalRequestId) {
    // السحب يمرّ عبر المحرك فينتهي بـ onFinal (cancelled)
    await engine.withdraw(ctx, a.approvalRequestId, actor.userId, reason).catch(async (e) => {
      if ((e as { status?: number }).status === 403)
        throw bad('FORBIDDEN', 'مقدّم الطلب فقط يسحبه؛ ارفضه من صندوق الموافقات', 403);
      throw e;
    });
    await ctx.trx
      .updateTable('adminActions')
      .set({ cancelReason: reason })
      .where('id', '=', id)
      .execute();
    return;
  }
  if (a.status === 'approved') {
    if (a.appliedPeriodId)
      throw bad(
        'APPLIED_IN_PAYROLL',
        'نُفِّذ أثره المالي في دورة رواتب مقفلة؛ أعد فتح الدورة أولاً',
        409,
      );
    if (a.employmentChangeId)
      throw bad('PROMOTION_APPLIED', 'نُفِّذت الترقية؛ ينفَّذ عكسها بتغيير تعيين وراتب', 409);
  }
  await ctx.trx
    .updateTable('adminActions')
    .set({
      status: 'cancelled',
      cancelReason: reason,
      decidedAt: new Date(),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .execute();
};

/** اقتراح تصعيد: عدد الإجراءات المعتمدة من النوع خلال المدة، والنوع التالي إن بلغ العدد */
export const escalationSuggestion = async (
  ctx: Ctx,
  employeeId: string,
  typeId: string,
): Promise<{
  count: number;
  threshold: number | null;
  windowDays: number | null;
  suggested: { id: string; nameAr: string } | null;
}> => {
  const t = await ctx.trx
    .selectFrom('adminActionTypes')
    .select(['escalationTypeId', 'escalationCount', 'escalationWindowDays'])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', typeId)
    .executeTakeFirst();
  if (!t) throw bad('INVALID_REFERENCE', 'نوع الإجراء غير موجود');
  const today = await companyToday(ctx);
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from admin_actions
     where company_id = ${ctx.companyId} and employee_id = ${employeeId} and type_id = ${typeId}
       and status = 'approved'
       ${t.escalationWindowDays ? sql`and action_date >= (${today}::date - ${t.escalationWindowDays}::int)` : sql``}`.execute(
    ctx.trx,
  );
  const count = rows[0]!.n;
  let suggested: { id: string; nameAr: string } | null = null;
  // الإجراء القادم سيكون العدد + 1: يُقترح التصعيد عند بلوغه العتبة
  if (t.escalationTypeId && t.escalationCount && count + 1 >= t.escalationCount) {
    const next = await ctx.trx
      .selectFrom('adminActionTypes')
      .select(['id', 'nameAr'])
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', t.escalationTypeId)
      .where('isActive', '=', true)
      .executeTakeFirst();
    suggested = next ?? null;
  }
  return {
    count,
    threshold: t.escalationCount ?? null,
    windowDays: t.escalationWindowDays ?? null,
    suggested,
  };
};
