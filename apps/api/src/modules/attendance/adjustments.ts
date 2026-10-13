import { sql } from 'kysely';
import {
  SETTING_DEFS,
  type CorrectionDirectInput,
  type CorrectionInput,
  type OvertimeInput,
} from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { registerApprovalRequestType, type ApprovalEngine } from '../../approvals/index.js';
import { companyTimezone, companyToday, recomputeDays } from './days.js';
import { MAX_SPAN_MINUTES } from './engine.js';
import { addDays, localToUtc } from './time.js';

export type Mode = 'both' | 'request' | 'direct';

export const loadPolicy = async (ctx: Ctx): Promise<{ mode: Mode; windowDays: number }> => {
  const rows = await ctx.trx
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('companyId', '=', ctx.companyId)
    .where('scopeType', '=', 'company')
    .where('key', 'in', ['attendanceCorrectionMode', 'attendanceCorrectionWindowDays'])
    .execute();
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const mode = SETTING_DEFS.attendanceCorrectionMode.schema.safeParse(
    v.get('attendanceCorrectionMode'),
  );
  const win = SETTING_DEFS.attendanceCorrectionWindowDays.schema.safeParse(
    v.get('attendanceCorrectionWindowDays'),
  );
  return {
    mode: mode.success ? mode.data : SETTING_DEFS.attendanceCorrectionMode.default,
    windowDays: win.success ? win.data : SETTING_DEFS.attendanceCorrectionWindowDays.default,
  };
};

/** سلسلة افتراضية: المدير المباشر وبديله مدير الموارد البشرية. */
const ensureFlow = async (
  ctx: Ctx,
  requestType: string,
  code: string,
  nameAr: string,
  nameEn: string,
): Promise<void> => {
  const exists = await ctx.trx
    .selectFrom('approvalFlows')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('requestType', '=', requestType)
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
    .values({ companyId: ctx.companyId, code, requestType, nameAr, nameEn })
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
      nameAr: 'المدير المباشر',
      nameEn: 'Direct manager',
      approverType: 'direct_manager',
      fallbackRoleId: hr?.id ?? null,
    })
    .execute();
};

type Emp = { id: string; userId: string; fullNameAr: string };

const loadEmployee = async (ctx: Ctx, employeeId: string): Promise<Emp> => {
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
  return { id: emp.id, userId: emp.userId, fullNameAr: emp.fullNameAr };
};

const isUnique = (e: unknown) => (e as { code?: string }).code === '23505';

/** إعادة احتساب يوم (واليومين المجاورين للدوام الليلي) دون المستقبل. */
const refreshDay = async (ctx: Ctx, employeeId: string, day: string) => {
  const today = await companyToday(ctx);
  const to = addDays(day, 1) > today ? today : addDays(day, 1);
  const from = addDays(day, -1);
  if (from > to) return;
  await recomputeDays(ctx, [employeeId], from, to);
};

// ───── تعديلات الحضور ─────
const toInstants = (
  tz: string,
  v: { date: string; inTime: string; outTime: string; outNextDay: boolean },
) => {
  const inAt = localToUtc(v.date, v.inTime, tz);
  const outAt = localToUtc(v.outNextDay ? addDays(v.date, 1) : v.date, v.outTime, tz);
  if ((outAt.getTime() - inAt.getTime()) / 60_000 > MAX_SPAN_MINUTES)
    throw new AppError('SPAN_TOO_LONG', 400, 'المدة بين الدخول والخروج أطول من 18 ساعة');
  return { inAt, outAt };
};

/** يكتب بصمتي التصحيح (دخول وخروج) ويعيد الاحتساب. */
const applyCorrection = async (
  ctx: Ctx,
  c: { employeeId: string; dayDate: string; inAt: Date; outAt: Date; reason: string },
  userId: string | null,
) => {
  for (const [at, direction] of [
    [c.inAt, 'in'],
    [c.outAt, 'out'],
  ] as const) {
    await ctx.trx
      .insertInto('attendanceRecords')
      .values({
        companyId: ctx.companyId,
        employeeId: c.employeeId,
        punchedAt: at,
        direction,
        source: 'correction',
        note: c.reason,
        createdBy: userId,
      })
      .onConflict((oc) =>
        oc
          .columns(['companyId', 'employeeId', 'punchedAt'])
          .doUpdateSet({ direction, source: 'correction', note: c.reason }),
      )
      .execute();
  }
  await refreshDay(ctx, c.employeeId, c.dayDate);
};

const checkDay = async (ctx: Ctx, day: string, canManage: boolean, windowDays: number) => {
  const today = await companyToday(ctx);
  if (day > today) throw new AppError('FUTURE_DAY', 400, 'لا يمكن تعديل يوم لم يأتِ بعد');
  if (!canManage && day < addDays(today, -windowDays))
    throw new AppError(
      'OUT_OF_WINDOW',
      409,
      `تجاوزت مهلة التقديم (${windowDays} يوماً)؛ راجع الموارد البشرية`,
    );
  return today;
};

export const submitCorrection = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  actor: { userId: string; canManage: boolean },
  employeeId: string,
  input: CorrectionInput,
) => {
  const emp = await loadEmployee(ctx, employeeId);
  const policy = await loadPolicy(ctx);
  if (policy.mode === 'direct')
    throw new AppError('REQUESTS_DISABLED', 409, 'الشركة تعتمد التعديل المباشر من الإدارة فقط');
  await checkDay(ctx, input.date, actor.canManage, policy.windowDays);
  const { inAt, outAt } = toInstants(await companyTimezone(ctx), input);
  let id: string;
  try {
    id = (
      await ctx.trx
        .insertInto('attendanceCorrections')
        .values({
          companyId: ctx.companyId,
          employeeId,
          dayDate: input.date,
          inAt,
          outAt,
          reason: input.reason,
          method: 'request',
          createdBy: actor.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  } catch (e) {
    if (isUnique(e))
      throw new AppError('DUPLICATE_PENDING', 409, 'يوجد طلب تعديل معلّق لنفس اليوم');
    throw e;
  }
  await ensureFlow(
    ctx,
    'attendance_correction',
    'attendance-correction-default',
    'سلسلة موافقة تعديل الحضور',
    'Attendance correction approval',
  );
  const approval = await engine.submit(ctx, {
    requestType: 'attendance_correction',
    title: `تعديل حضور — ${emp.fullNameAr} (${input.date})`,
    requesterUserId: emp.userId,
    entityType: 'attendance_correction',
    entityId: id,
    payload: { employeeId, date: input.date, inTime: input.inTime, outTime: input.outTime },
  });
  await ctx.trx
    .updateTable('attendanceCorrections')
    .set({ approvalRequestId: approval.id })
    .where('id', '=', id)
    .execute();
  return id;
};

/** تعديل مباشر من الإدارة: يُعتمد فوراً ويُسجَّل في السجل. */
export const directCorrection = async (ctx: Ctx, userId: string, input: CorrectionDirectInput) => {
  await loadEmployee(ctx, input.employeeId).catch(async (e: unknown) => {
    // الموظف بلا حساب مقبول للتعديل المباشر (لا موافقة مطلوبة)
    if (e instanceof AppError && e.code === 'NO_ACCOUNT') return;
    throw e;
  });
  const policy = await loadPolicy(ctx);
  if (policy.mode === 'request')
    throw new AppError('DIRECT_DISABLED', 409, 'الشركة تعتمد طلبات الموظفين بموافقة فقط');
  await checkDay(ctx, input.date, true, policy.windowDays);
  const pending = await ctx.trx
    .selectFrom('attendanceCorrections')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('employeeId', '=', input.employeeId)
    .where('dayDate', '=', input.date)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (pending) throw new AppError('DUPLICATE_PENDING', 409, 'يوجد طلب تعديل معلّق لنفس اليوم');
  const { inAt, outAt } = toInstants(await companyTimezone(ctx), input);
  const row = await ctx.trx
    .insertInto('attendanceCorrections')
    .values({
      companyId: ctx.companyId,
      employeeId: input.employeeId,
      dayDate: input.date,
      inAt,
      outAt,
      reason: input.reason,
      method: 'direct',
      status: 'approved',
      decidedAt: new Date(),
      createdBy: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await applyCorrection(
    ctx,
    { employeeId: input.employeeId, dayDate: input.date, inAt, outAt, reason: input.reason },
    userId,
  );
  return row.id;
};

registerApprovalRequestType({
  key: 'attendance_correction',
  nameAr: 'طلب تعديل حضور',
  nameEn: 'Attendance correction',
  onFinal: async (ctx, request, outcome) => {
    if (!request.entityId) return;
    const c = await ctx.trx
      .selectFrom('attendanceCorrections')
      .select(['id', 'status', 'employeeId', 'dayDate', 'inAt', 'outAt', 'reason'])
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', request.entityId)
      .forUpdate()
      .executeTakeFirst();
    if (!c || c.status !== 'pending') return;
    await ctx.trx
      .updateTable('attendanceCorrections')
      .set({ status: outcome, decidedAt: new Date(), version: sql`version + 1` })
      .where('id', '=', c.id)
      .execute();
    if (outcome === 'approved')
      await applyCorrection(
        ctx,
        {
          employeeId: c.employeeId,
          dayDate: c.dayDate,
          inAt: c.inAt,
          outAt: c.outAt,
          reason: c.reason,
        },
        null,
      );
  },
});

// ───── العمل الإضافي ─────
export const submitOvertime = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  actor: { userId: string; canManage: boolean },
  employeeId: string,
  input: OvertimeInput,
) => {
  const emp = await loadEmployee(ctx, employeeId);
  const policy = await loadPolicy(ctx);
  const today = await companyToday(ctx);
  const kind: 'pre' | 'post' = input.date >= today ? 'pre' : 'post';
  if (kind === 'post' && !actor.canManage && input.date < addDays(today, -policy.windowDays))
    throw new AppError(
      'OUT_OF_WINDOW',
      409,
      `تجاوزت مهلة التقديم (${policy.windowDays} يوماً)؛ راجع الموارد البشرية`,
    );
  if (kind === 'pre' && input.date > addDays(today, 60))
    throw new AppError('TOO_FAR', 400, 'الطلب المسبق لا يتجاوز 60 يوماً قادمة');
  let id: string;
  try {
    id = (
      await ctx.trx
        .insertInto('overtimeRequests')
        .values({
          companyId: ctx.companyId,
          employeeId,
          dayDate: input.date,
          minutes: input.minutes,
          reason: input.reason,
          kind,
          createdBy: actor.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  } catch (e) {
    if (isUnique(e))
      throw new AppError('DUPLICATE_ACTIVE', 409, 'يوجد طلب إضافي معلّق أو معتمد لنفس اليوم');
    throw e;
  }
  await ensureFlow(
    ctx,
    'overtime',
    'overtime-default',
    'سلسلة موافقة العمل الإضافي',
    'Overtime approval',
  );
  const approval = await engine.submit(ctx, {
    requestType: 'overtime',
    title: `عمل إضافي — ${emp.fullNameAr} (${input.date}، ${input.minutes} دقيقة)`,
    requesterUserId: emp.userId,
    entityType: 'overtime_request',
    entityId: id,
    payload: { employeeId, date: input.date, minutes: input.minutes, kind },
  });
  await ctx.trx
    .updateTable('overtimeRequests')
    .set({ approvalRequestId: approval.id })
    .where('id', '=', id)
    .execute();
  return id;
};

registerApprovalRequestType({
  key: 'overtime',
  nameAr: 'طلب عمل إضافي',
  nameEn: 'Overtime request',
  onFinal: async (ctx, request, outcome) => {
    if (!request.entityId) return;
    const o = await ctx.trx
      .selectFrom('overtimeRequests')
      .select(['id', 'status', 'employeeId', 'dayDate'])
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', request.entityId)
      .forUpdate()
      .executeTakeFirst();
    if (!o || o.status !== 'pending') return;
    await ctx.trx
      .updateTable('overtimeRequests')
      .set({ status: outcome, decidedAt: new Date(), version: sql`version + 1` })
      .where('id', '=', o.id)
      .execute();
    if (outcome === 'approved') await refreshDay(ctx, o.employeeId, o.dayDate);
  },
});

/** سحب طلب معلّق (صاحبه أو الإدارة). */
export const withdrawAdjustment = async (
  ctx: Ctx,
  engine: ApprovalEngine,
  table: 'attendanceCorrections' | 'overtimeRequests',
  id: string,
  actor: { userId: string; canManage: boolean },
  note?: string | null,
) => {
  const r =
    table === 'attendanceCorrections'
      ? await ctx.trx
          .selectFrom('attendanceCorrections as r')
          .innerJoin('employees as e', 'e.id', 'r.employeeId')
          .select(['r.status', 'r.approvalRequestId', 'e.userId as employeeUserId'])
          .where('r.companyId', '=', ctx.companyId)
          .where('r.id', '=', id)
          .forUpdate('r')
          .executeTakeFirst()
      : await ctx.trx
          .selectFrom('overtimeRequests as r')
          .innerJoin('employees as e', 'e.id', 'r.employeeId')
          .select(['r.status', 'r.approvalRequestId', 'e.userId as employeeUserId'])
          .where('r.companyId', '=', ctx.companyId)
          .where('r.id', '=', id)
          .forUpdate('r')
          .executeTakeFirst();
  if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
  if (r.employeeUserId !== actor.userId && !actor.canManage)
    throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية سحب هذا الطلب');
  if (r.status !== 'pending' || !r.approvalRequestId)
    throw new AppError('NOT_WITHDRAWABLE', 409, 'لا يمكن سحب إلا الطلب المعلّق');
  const ar = await ctx.trx
    .selectFrom('approvalRequests')
    .select('requesterUserId')
    .where('id', '=', r.approvalRequestId)
    .executeTakeFirstOrThrow();
  await engine.withdraw(ctx, r.approvalRequestId, ar.requesterUserId, note ?? null);
};
