import { sql } from 'kysely';
import { weeklyOffSchema, type LeaveRequestInput } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { registerApprovalRequestType, type ApprovalEngine } from '../../approvals/index.js';
import { resolvePolicy } from './assignments.js';
import { computeLeaveDays, fromCents, splitByYear, toCents, type LeaveDay } from './engine.js';
import { debit, restore } from './ledger.js';
import { recomputeDays } from '../attendance/index.js';

const DEFAULT_WEEKLY_OFF = [5, 6];

const addDaysIso = (d: string, n: number): string => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** إعادة احتساب أيام الحضور المتأثرة بإجازة (حتى اليوم فقط، وبحد أقصى 62 يوماً). */
const refreshAttendance = async (ctx: Ctx, employeeId: string, start: string, end: string) => {
  const today = await todayOf(ctx);
  const to = end < today ? end : today;
  if (start > to) return;
  const minFrom = addDaysIso(to, -61);
  await recomputeDays(ctx, [employeeId], start < minFrom ? minFrom : start, to);
};

const todayOf = async (ctx: Ctx): Promise<string> =>
  (await sql<{ d: string }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx))
    .rows[0]?.d as string;

/** الراحة الأسبوعية (إعداد الشركة) والعطل الرسمية ضمن الفترة. */
export const loadCalendar = async (ctx: Ctx, start: string, end: string) => {
  const s = await ctx.trx
    .selectFrom('settings')
    .select('value')
    .where('companyId', '=', ctx.companyId)
    .where('scopeType', '=', 'company')
    .where('key', '=', 'weeklyOff')
    .executeTakeFirst();
  const parsed = weeklyOffSchema.safeParse(s?.value);
  const weeklyOff = parsed.success ? parsed.data : DEFAULT_WEEKLY_OFF;
  const rows = await ctx.trx
    .selectFrom('holidays')
    .select('holidayDate')
    .where('companyId', '=', ctx.companyId)
    .where('holidayDate', '>=', start)
    .where('holidayDate', '<=', end)
    .execute();
  return { weeklyOff, holidays: new Set(rows.map((r) => r.holidayDate)) };
};

type TypeRow = { id: string; isPaid: boolean; allowHalfDay: boolean; isActive: boolean };

export type Analysis = {
  employeeId: string;
  type: TypeRow;
  days: LeaveDay[];
  totalCents: number;
  /** النوع المدفوع يخصم من الرصيد؛ غير المدفوع لا يحتاج سياسة ولا رصيداً */
  deductsBalance: boolean;
  policy: { id: string; maxNegative: string } | null;
  balanceCents: number;
  afterCents: number;
  sufficient: boolean;
  overlaps: { id: string; startDate: string; endDate: string; status: string }[];
};

const loadType = async (ctx: Ctx, id: string): Promise<TypeRow> => {
  const t = await ctx.trx
    .selectFrom('leaveTypes')
    .select(['id', 'isPaid', 'allowHalfDay', 'isActive'])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!t) throw new AppError('INVALID_REFERENCE', 400, 'نوع الإجازة غير موجود');
  if (!t.isActive) throw new AppError('TYPE_INACTIVE', 409, 'نوع الإجازة معطّل');
  return t;
};

/** تحليل الطلب دون أي أثر: الأيام، السياسة، الرصيد قبل/بعد، والتداخل. */
export const analyze = async (
  ctx: Ctx,
  employeeId: string,
  input: LeaveRequestInput,
  ignoreRequestId?: string,
): Promise<Analysis> => {
  const type = await loadType(ctx, input.leaveTypeId);
  if ((input.firstDayHalf || input.lastDayHalf) && !type.allowHalfDay)
    throw new AppError('HALF_DAY_NOT_ALLOWED', 400, 'هذا النوع لا يسمح بنصف يوم');
  const cal = await loadCalendar(ctx, input.startDate, input.endDate);
  let computed;
  try {
    computed = computeLeaveDays({
      start: input.startDate,
      end: input.endDate,
      weeklyOff: cal.weeklyOff,
      holidays: cal.holidays,
      firstDayHalf: input.firstDayHalf,
      lastDayHalf: input.lastDayHalf,
    });
  } catch (err) {
    if (err instanceof RangeError)
      throw new AppError(err.message, 400, 'الفترة غير صالحة أو أطول من 366 يوماً');
    throw err;
  }
  if (computed.totalCents <= 0)
    throw new AppError('NO_WORKING_DAYS', 400, 'الفترة كلها راحة أو عطلة رسمية');

  const deductsBalance = type.isPaid;
  let policy: Analysis['policy'] = null;
  let balanceCents = 0;
  if (deductsBalance) {
    const resolved = await resolvePolicy(ctx, employeeId, type.id, input.startDate);
    if (!resolved)
      throw new AppError('NO_POLICY', 409, 'لا توجد سياسة إجازة مُعيَّنة لهذا الموظف والنوع');
    const p = await ctx.trx
      .selectFrom('leavePolicies')
      .select(['id', 'maxNegative'])
      .where('id', '=', resolved.policyId)
      .executeTakeFirstOrThrow();
    policy = p;
    const bal = await ctx.trx
      .selectFrom('leaveBalances')
      .select('balance')
      .where('companyId', '=', ctx.companyId)
      .where('employeeId', '=', employeeId)
      .where('leaveTypeId', '=', type.id)
      .executeTakeFirst();
    balanceCents = toCents(bal?.balance ?? 0);
  }
  const afterCents = balanceCents - (deductsBalance ? computed.totalCents : 0);
  const sufficient = !deductsBalance || afterCents >= -toCents(policy?.maxNegative ?? 0);

  let ov = ctx.trx
    .selectFrom('leaveRequests')
    .select(['id', 'startDate', 'endDate', 'status'])
    .where('companyId', '=', ctx.companyId)
    .where('employeeId', '=', employeeId)
    .where('status', 'in', ['pending', 'approved'])
    .where('startDate', '<=', input.endDate)
    .where('endDate', '>=', input.startDate);
  if (ignoreRequestId) ov = ov.where('id', '<>', ignoreRequestId);
  const overlaps = await ov.execute();

  return {
    employeeId,
    type,
    days: computed.days,
    totalCents: computed.totalCents,
    deductsBalance,
    policy,
    balanceCents,
    afterCents,
    sufficient,
    overlaps,
  };
};

export const previewDto = (a: Analysis) => ({
  days: a.days.map((d) => ({ date: d.date, kind: d.kind, units: fromCents(d.cents) })),
  totalDays: fromCents(a.totalCents),
  deductsBalance: a.deductsBalance,
  balance: a.deductsBalance ? fromCents(a.balanceCents) : null,
  balanceAfter: a.deductsBalance ? fromCents(a.afterCents) : null,
  sufficient: a.sufficient,
  overlaps: a.overlaps,
});

/** سلسلة موافقة الإجازات الافتراضية: المدير المباشر، وبديله مدير الموارد البشرية. */
const ensureLeaveFlow = async (ctx: Ctx): Promise<void> => {
  const exists = await ctx.trx
    .selectFrom('approvalFlows')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('requestType', '=', 'leave')
    .where('isActive', '=', true)
    .executeTakeFirst();
  if (exists) return;
  const hr = await ctx.trx
    .selectFrom('roles')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('code', '=', 'hr_manager')
    .executeTakeFirst();
  const flow = await ctx.trx
    .insertInto('approvalFlows')
    .values({
      companyId: ctx.companyId,
      code: 'leave-default',
      requestType: 'leave',
      nameAr: 'سلسلة موافقة الإجازات',
      nameEn: 'Leave approval',
    })
    .returning('id')
    .onConflict((oc) => oc.columns(['companyId', 'code']).doNothing())
    .executeTakeFirst();
  if (!flow) return; // رمز موجود لكن معطّل: يفعّله المدير يدوياً
  await ctx.trx
    .insertInto('approvalSteps')
    .values({
      companyId: ctx.companyId,
      flowId: flow.id,
      position: 1,
      nameAr: 'المدير المباشر',
      nameEn: 'Direct manager',
      approverType: 'direct_manager',
      fallbackRoleId: hr?.id ?? null,
    })
    .execute();
};

const nameOf = (r: { fullNameAr: string }) => r.fullNameAr;

export const submitRequest = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  createdBy: string,
  employeeId: string,
  input: LeaveRequestInput,
) => {
  const emp = await ctx.trx
    .selectFrom('employees')
    .select(['id', 'userId', 'fullNameAr', 'status'])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', employeeId)
    .executeTakeFirst();
  if (!emp) throw new AppError('INVALID_REFERENCE', 400, 'الموظف غير موجود');
  if (emp.status === 'terminated')
    throw new AppError('EMPLOYEE_TERMINATED', 409, 'الموظف منتهي الخدمة');
  if (!emp.userId)
    throw new AppError('NO_ACCOUNT', 409, 'الموظف بلا حساب مستخدم فلا يمكن توجيه الموافقة');

  const a = await analyze(ctx, employeeId, input);
  if (a.overlaps.length)
    throw new AppError('LEAVE_OVERLAP', 409, 'يتداخل مع طلب إجازة قائم لنفس الموظف', {
      overlaps: a.overlaps,
    });
  if (!a.sufficient)
    throw new AppError(
      'INSUFFICIENT_BALANCE',
      409,
      `الرصيد غير كافٍ: المتاح ${fromCents(Math.max(a.balanceCents, 0))} والمطلوب ${fromCents(a.totalCents)}`,
    );

  const row = await ctx.trx
    .insertInto('leaveRequests')
    .values({
      companyId: ctx.companyId,
      employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      firstDayHalf: input.firstDayHalf,
      lastDayHalf: input.lastDayHalf,
      reason: input.reason ?? null,
      days: fromCents(a.totalCents),
      createdBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.trx
    .insertInto('leaveRequestDays')
    .values(
      a.days.map((d) => ({
        companyId: ctx.companyId,
        requestId: row.id,
        dayDate: d.date,
        units: fromCents(d.cents),
        kind: d.kind,
      })),
    )
    .execute();

  // حجز الرصيد (لكل سنة تقويمية على حدة)
  if (a.deductsBalance) {
    for (const seg of splitByYear(a.days)) {
      await debit(ctx, {
        employeeId,
        leaveTypeId: input.leaveTypeId,
        days: seg.cents / 100,
        date: seg.date,
        requestId: row.id,
        reason: 'leave_request',
        userId: createdBy,
        maxNegative: Number(a.policy?.maxNegative ?? 0),
      });
    }
  }

  await ensureLeaveFlow(ctx);
  const typeName = (
    await ctx.trx
      .selectFrom('leaveTypes')
      .select('nameAr')
      .where('id', '=', input.leaveTypeId)
      .executeTakeFirstOrThrow()
  ).nameAr;
  const approval = await engine.submit(ctx, {
    requestType: 'leave',
    title: `${typeName} — ${nameOf(emp)} (${input.startDate} → ${input.endDate})`,
    requesterUserId: emp.userId,
    entityType: 'leave_request',
    entityId: row.id,
    payload: {
      days: Number(fromCents(a.totalCents)),
      leaveTypeId: input.leaveTypeId,
      employeeId,
      startDate: input.startDate,
      endDate: input.endDate,
    },
  });
  await ctx.trx
    .updateTable('leaveRequests')
    .set({ approvalRequestId: approval.id })
    .where('id', '=', row.id)
    .execute();
  return row.id;
};

/** نتيجة الموافقات تنعكس على الطلب والرصيد (داخل معاملة القرار نفسها). */
registerApprovalRequestType({
  key: 'leave',
  nameAr: 'طلب إجازة',
  nameEn: 'Leave request',
  onFinal: async (ctx, request, outcome) => {
    if (!request.entityId) return;
    const lr = await ctx.trx
      .selectFrom('leaveRequests')
      .select(['id', 'status', 'employeeId', 'startDate', 'endDate'])
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', request.entityId)
      .forUpdate()
      .executeTakeFirst();
    if (!lr || lr.status !== 'pending') return;
    if (outcome === 'approved') {
      await ctx.trx
        .updateTable('leaveRequests')
        .set({ status: 'approved', version: sql`version + 1` })
        .where('id', '=', lr.id)
        .execute();
      await refreshAttendance(ctx, lr.employeeId, lr.startDate, lr.endDate);
      return;
    }
    await restore(ctx, lr.id, null);
    await ctx.trx
      .updateTable('leaveRequests')
      .set({ status: outcome, version: sql`version + 1` })
      .where('id', '=', lr.id)
      .execute();
  },
});

type Actor = { userId: string; canManage: boolean };

const loadForUpdate = async (ctx: Ctx, id: string) => {
  const r = await ctx.trx
    .selectFrom('leaveRequests as r')
    .innerJoin('employees as e', 'e.id', 'r.employeeId')
    .select([
      'r.id',
      'r.employeeId',
      'r.leaveTypeId',
      'r.status',
      'r.startDate',
      'r.endDate',
      'r.days',
      'r.approvalRequestId',
      'e.userId as employeeUserId',
    ])
    .where('r.companyId', '=', ctx.companyId)
    .where('r.id', '=', id)
    .forUpdate('r')
    .executeTakeFirst();
  if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
  return r;
};

/** إلغاء: قيد الموافقة = سحب (يعيد الرصيد)، ومعتمد = إلغاء (لصاحبه قبل البدء، وللإدارة دائماً). */
export const cancelRequest = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  id: string,
  actor: Actor,
  note?: string | null,
) => {
  const r = await loadForUpdate(ctx, id);
  const isOwner = r.employeeUserId === actor.userId;
  if (!isOwner && !actor.canManage)
    throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية إلغاء هذا الطلب');
  if (r.status === 'pending') {
    if (!r.approvalRequestId) throw new AppError('INVALID_STATE', 409, 'طلب بلا مسار موافقة');
    const ar = await ctx.trx
      .selectFrom('approvalRequests')
      .select('requesterUserId')
      .where('id', '=', r.approvalRequestId)
      .executeTakeFirstOrThrow();
    // الصلاحية تحققت أعلاه؛ المحرك يشترط مقدّم الطلب فنمرّره
    await engine.withdraw(ctx, r.approvalRequestId, ar.requesterUserId, note ?? null);
    return;
  }
  if (r.status !== 'approved')
    throw new AppError('NOT_CANCELLABLE', 409, 'لا يمكن إلغاء طلب منتهٍ');
  if (!actor.canManage && r.startDate <= (await todayOf(ctx)))
    throw new AppError('ALREADY_STARTED', 409, 'بدأت الإجازة؛ الإلغاء للموارد البشرية فقط');
  await restore(ctx, id, actor.userId);
  await ctx.trx
    .updateTable('leaveRequests')
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: actor.userId,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .execute();
  await refreshAttendance(ctx, r.employeeId, r.startDate, r.endDate);
};

/** تجاوز يدوي لعدد الأيام المخصومة: يعيد الحجز السابق ثم يخصم العدد الجديد. */
export const overrideDays = async (
  ctx: Ctx,
  id: string,
  userId: string,
  days: number,
  reason: string,
) => {
  const r = await loadForUpdate(ctx, id);
  if (r.status !== 'pending' && r.status !== 'approved')
    throw new AppError('NOT_OVERRIDABLE', 409, 'لا يمكن تعديل أيام طلب منتهٍ');
  const type = await ctx.trx
    .selectFrom('leaveTypes')
    .select('isPaid')
    .where('id', '=', r.leaveTypeId)
    .executeTakeFirstOrThrow();
  if (type.isPaid) {
    await restore(ctx, id, userId);
    if (days > 0) {
      const policy = await resolvePolicy(ctx, r.employeeId, r.leaveTypeId, r.startDate);
      const max = policy
        ? (
            await ctx.trx
              .selectFrom('leavePolicies')
              .select('maxNegative')
              .where('id', '=', policy.policyId)
              .executeTakeFirstOrThrow()
          ).maxNegative
        : '0';
      await debit(ctx, {
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        days,
        date: r.startDate,
        requestId: id,
        reason: 'override',
        userId,
        maxNegative: Number(max),
      });
    }
  }
  await ctx.trx
    .updateTable('leaveRequests')
    .set({
      overrideDays: days.toFixed(2),
      overrideReason: reason,
      overrideBy: userId,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .execute();
};
