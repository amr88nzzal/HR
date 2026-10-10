import { sql } from 'kysely';
import { evaluateCondition, conditionSchema } from '@hrms/shared';
import type { Ctx } from '../db/tenant.js';
import type { Notifier } from '../notifications/index.js';
import { AppError } from '../shared/errors.js';
import { getApprovalRequestType, type ApprovalOutcome } from './registry.js';

const bad = (code: string, message: string, status = 400) => new AppError(code, status, message);

export type SubmitInput = {
  requestType: string;
  title: string;
  requesterUserId: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

const todayOf = async (ctx: Ctx): Promise<string> => {
  const { rows } = await sql<{
    d: string;
  }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx);
  return rows[0]?.d as string;
};

/** المدير المباشر (مستخدم) للموظف المرتبط بالحساب، بحسب التعيين الحالي. */
const managerUserOf = async (ctx: Ctx, userId: string): Promise<string | null> => {
  const { rows } = await sql<{ managerUserId: string | null }>`
    select m.user_id as manager_user_id
      from employees e
      join employments cur on cur.employee_id = e.id
       and cur.valid_from <= company_today(e.company_id)
       and (cur.valid_to is null or cur.valid_to >= company_today(e.company_id))
      join employees m on m.id = cur.manager_employee_id
     where e.user_id = ${userId} and e.company_id = ${ctx.companyId}
     limit 1`.execute(ctx.trx);
  return rows[0]?.managerUserId ?? null;
};

type StepRow = {
  id: string;
  position: number;
  nameAr: string;
  nameEn: string | null;
  approverType: 'direct_manager' | 'manager_of_manager' | 'role' | 'user';
  approverRef: string | null;
  mode: 'any' | 'all';
  condition: unknown;
};

const resolveApprovers = async (ctx: Ctx, step: StepRow, requesterUserId: string) => {
  let ids: string[] = [];
  if (step.approverType === 'direct_manager') {
    const m = await managerUserOf(ctx, requesterUserId);
    if (m) ids = [m];
  } else if (step.approverType === 'manager_of_manager') {
    const m = await managerUserOf(ctx, requesterUserId);
    const mm = m ? await managerUserOf(ctx, m) : null;
    if (mm) ids = [mm];
  } else if (step.approverType === 'user') {
    ids = step.approverRef ? [step.approverRef] : [];
  } else {
    const rows = await ctx.trx
      .selectFrom('userRoleAssignments')
      .select('userId')
      .where('companyId', '=', ctx.companyId)
      .where('roleId', '=', step.approverRef as string)
      .execute();
    ids = [...new Set(rows.map((r) => r.userId))];
  }
  ids = ids.filter((id) => id !== requesterUserId); // لا يوافق مقدّم الطلب على طلبه
  if (!ids.length) return [];
  const active = await ctx.trx
    .selectFrom('users')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('id', 'in', ids)
    .where('status', '=', 'active')
    .execute();
  return active.map((u) => u.id);
};

const displayName = async (ctx: Ctx, userId: string): Promise<string> =>
  (
    await ctx.trx
      .selectFrom('users')
      .select('displayName')
      .where('id', '=', userId)
      .executeTakeFirst()
  )?.displayName ?? '';

type ReqRow = {
  id: string;
  flowId: string;
  requestType: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  requesterUserId: string;
  payload: Record<string, unknown>;
  status: string;
  currentPosition: number | null;
  version: number;
};

const loadRequest = async (ctx: Ctx, id: string, lock = true): Promise<ReqRow> => {
  let q = ctx.trx
    .selectFrom('approvalRequests')
    .select([
      'id',
      'flowId',
      'requestType',
      'entityType',
      'entityId',
      'title',
      'requesterUserId',
      'payload',
      'status',
      'currentPosition',
      'version',
    ])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', id);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw bad('NOT_FOUND', 'الطلب غير موجود', 404);
  return row;
};

export type ApprovalEngine = ReturnType<typeof createApprovalEngine>;

export const createApprovalEngine = (notifier: Notifier) => {
  const link = (id: string) => `/approvals/${id}`;

  const record = (
    ctx: Ctx,
    requestId: string,
    actorUserId: string,
    action: 'submit' | 'resubmit' | 'approve' | 'reject' | 'return' | 'withdraw',
    extra: {
      stepId?: string | null;
      position?: number | null;
      onBehalfOf?: string | null;
      note?: string | null;
    } = {},
  ) =>
    ctx.trx
      .insertInto('approvalActions')
      .values({
        companyId: ctx.companyId,
        requestId,
        stepId: extra.stepId ?? null,
        position: extra.position ?? null,
        actorUserId,
        onBehalfOfUserId: extra.onBehalfOf ?? null,
        action,
        note: extra.note ?? null,
      })
      .execute();

  const finalize = async (
    ctx: Ctx,
    req: ReqRow,
    outcome: ApprovalOutcome,
    actorUserId: string,
    note: string | null,
  ) => {
    const status = outcome;
    await ctx.trx
      .updateTable('approvalRequests')
      .set({
        status,
        currentStepId: null,
        currentPosition: null,
        finalNote: note,
        decidedAt: new Date(),
        version: sql`version + 1`,
      })
      .where('id', '=', req.id)
      .execute();
    if (outcome !== 'withdrawn') {
      await notifier.notify(ctx, {
        userId: req.requesterUserId,
        event: outcome === 'approved' ? 'approval.approved' : 'approval.rejected',
        vars: {
          entity: req.title,
          approver: await displayName(ctx, actorUserId),
          reason: note ?? '',
        },
        link: link(req.id),
        data: { requestId: req.id },
      });
    }
    const handler = getApprovalRequestType(req.requestType)?.onFinal;
    if (handler) await handler(ctx, { ...req }, outcome);
  };

  /** يفعّل أول خطوة لاحقة للموضع المعطى تنطبق شروطها، أو يُنهي الطلب بالموافقة إن لم تبق خطوات. */
  const advance = async (ctx: Ctx, req: ReqRow, afterPosition: number, lastActor: string) => {
    const steps = (await ctx.trx
      .selectFrom('approvalSteps')
      .selectAll()
      .where('flowId', '=', req.flowId)
      .where('position', '>', afterPosition)
      .orderBy('position')
      .execute()) as StepRow[];
    const today = await todayOf(ctx);
    for (const step of steps) {
      if (step.condition) {
        const parsed = conditionSchema.safeParse(step.condition);
        if (parsed.success && !evaluateCondition(parsed.data, req.payload)) continue;
      }
      const approvers = await resolveApprovers(ctx, step, req.requesterUserId);
      if (!approvers.length) {
        throw bad(
          'NO_APPROVER',
          `تعذّر تحديد معتمد للخطوة «${step.nameAr}» (مدير غير معيَّن أو لا يوجد مستخدم مؤهل)`,
          409,
        );
      }
      const delegations = await ctx.trx
        .selectFrom('approverDelegations as d')
        .innerJoin('users as u', 'u.id', 'd.delegateUserId')
        .select(['d.delegatorUserId', 'd.delegateUserId'])
        .where('d.companyId', '=', ctx.companyId)
        .where('d.isActive', '=', true)
        .where('d.delegatorUserId', 'in', approvers)
        .where('d.validFrom', '<=', today)
        .where('d.validTo', '>=', today)
        .where((eb) =>
          eb.or([eb('d.requestType', 'is', null), eb('d.requestType', '=', req.requestType)]),
        )
        .where('u.status', '=', 'active')
        .execute();
      const rows = approvers.map((u) => ({ userId: u, from: null as string | null }));
      for (const d of delegations) {
        if (d.delegateUserId === req.requesterUserId) continue;
        if (rows.some((r) => r.userId === d.delegateUserId)) continue;
        rows.push({ userId: d.delegateUserId, from: d.delegatorUserId });
      }
      await ctx.trx
        .insertInto('approvalRequestAssignees')
        .values(
          rows.map((r) => ({
            companyId: ctx.companyId,
            requestId: req.id,
            stepId: step.id,
            position: step.position,
            userId: r.userId,
            delegatedFromUserId: r.from,
          })),
        )
        .execute();
      await ctx.trx
        .updateTable('approvalRequests')
        .set({ currentStepId: step.id, currentPosition: step.position, version: sql`version + 1` })
        .where('id', '=', req.id)
        .execute();
      const requesterName = await displayName(ctx, req.requesterUserId);
      for (const r of rows) {
        await notifier.notify(ctx, {
          userId: r.userId,
          event: 'approval.assigned',
          vars: { requester: requesterName, entity: req.title },
          link: link(req.id),
          data: { requestId: req.id },
        });
      }
      return;
    }
    await finalize(ctx, req, 'approved', lastActor, null);
  };

  return {
    /** يقدّم طلباً جديداً ويفعّل أول خطوة؛ يعيد معرّف الطلب وحالته. */
    submit: async (ctx: Ctx, input: SubmitInput): Promise<{ id: string; status: string }> => {
      if (!getApprovalRequestType(input.requestType))
        throw bad('UNKNOWN_REQUEST_TYPE', `نوع الطلب غير معروف: ${input.requestType}`);
      const flow = await ctx.trx
        .selectFrom('approvalFlows')
        .select('id')
        .where('companyId', '=', ctx.companyId)
        .where('requestType', '=', input.requestType)
        .where('isActive', '=', true)
        .executeTakeFirst();
      if (!flow) throw bad('NO_FLOW', 'لا توجد سلسلة موافقة فعّالة لهذا النوع من الطلبات', 409);
      const row = await ctx.trx
        .insertInto('approvalRequests')
        .values({
          companyId: ctx.companyId,
          flowId: flow.id,
          requestType: input.requestType,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          title: input.title,
          requesterUserId: input.requesterUserId,
          payload: JSON.stringify(input.payload ?? {}),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(ctx, row.id, input.requesterUserId, 'submit');
      const req = await loadRequest(ctx, row.id);
      await advance(ctx, req, 0, input.requesterUserId);
      const after = await loadRequest(ctx, row.id, false);
      return { id: row.id, status: after.status };
    },

    /** إجراء معتمد (موافقة/رفض/إرجاع) من مستخدم مُسنَد إليه في الخطوة الحالية (أصالة أو تفويضاً). */
    act: async (
      ctx: Ctx,
      requestId: string,
      userId: string,
      input: { action: 'approve' | 'reject' | 'return'; note?: string | null },
    ): Promise<{ status: string }> => {
      const req = await loadRequest(ctx, requestId);
      if (req.status !== 'pending') throw bad('NOT_PENDING', 'الطلب ليس قيد الموافقة', 409);
      const mine = await ctx.trx
        .selectFrom('approvalRequestAssignees')
        .select(['id', 'stepId', 'position', 'delegatedFromUserId'])
        .where('requestId', '=', requestId)
        .where('position', '=', req.currentPosition as number)
        .where('userId', '=', userId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!mine) throw bad('NOT_ASSIGNED', 'هذا الطلب ليس بانتظار إجرائك', 403);
      const note = input.note?.trim() || null;
      if (input.action !== 'approve' && !note)
        throw bad('NOTE_REQUIRED', 'الملاحظة مطلوبة عند الرفض أو الإرجاع');

      await record(ctx, requestId, userId, input.action, {
        stepId: mine.stepId,
        position: mine.position,
        onBehalfOf: mine.delegatedFromUserId,
        note,
      });
      const seat = mine.delegatedFromUserId ?? userId;
      const cancelPending = (where: 'all' | 'seat') => {
        let q = ctx.trx
          .updateTable('approvalRequestAssignees')
          .set({ status: 'cancelled' })
          .where('requestId', '=', requestId)
          .where('position', '=', mine.position)
          .where('status', '=', 'pending');
        if (where === 'seat')
          q = q.where((eb) =>
            eb.or([eb('userId', '=', seat), eb('delegatedFromUserId', '=', seat)]),
          );
        return q.execute();
      };
      await ctx.trx
        .updateTable('approvalRequestAssignees')
        .set({ status: 'acted', actedAt: new Date() })
        .where('id', '=', mine.id)
        .execute();

      if (input.action === 'reject') {
        await cancelPending('all');
        await finalize(ctx, req, 'rejected', userId, note);
        return { status: 'rejected' };
      }
      if (input.action === 'return') {
        await cancelPending('all');
        await ctx.trx
          .updateTable('approvalRequests')
          .set({
            status: 'returned',
            currentStepId: null,
            currentPosition: null,
            finalNote: note,
            version: sql`version + 1`,
          })
          .where('id', '=', requestId)
          .execute();
        await notifier.notify(ctx, {
          userId: req.requesterUserId,
          event: 'approval.returned',
          vars: { entity: req.title, approver: await displayName(ctx, userId), reason: note ?? '' },
          link: link(requestId),
          data: { requestId },
        });
        return { status: 'returned' };
      }

      // موافقة: ألغِ بدائل المقعد نفسه (المفوِّض والنائب)
      await cancelPending('seat');
      const step = await ctx.trx
        .selectFrom('approvalSteps')
        .select('mode')
        .where('id', '=', mine.stepId as string)
        .executeTakeFirst();
      const pending = await ctx.trx
        .selectFrom('approvalRequestAssignees')
        .select('id')
        .where('requestId', '=', requestId)
        .where('position', '=', mine.position)
        .where('status', '=', 'pending')
        .execute();
      const done = (step?.mode ?? 'any') === 'any' || pending.length === 0;
      if (!done) return { status: 'pending' };
      await cancelPending('all');
      await advance(ctx, req, mine.position, userId);
      const after = await loadRequest(ctx, requestId, false);
      return { status: after.status };
    },

    /** يعيد طلباً مُرجَعاً من البداية (بعد تعديل العنوان/البيانات اختيارياً). */
    resubmit: async (
      ctx: Ctx,
      requestId: string,
      userId: string,
      input: { title?: string; payload?: Record<string, unknown> },
    ): Promise<{ status: string }> => {
      const req = await loadRequest(ctx, requestId);
      if (req.requesterUserId !== userId) throw bad('FORBIDDEN', 'مقدّم الطلب فقط', 403);
      if (req.status !== 'returned') throw bad('NOT_RETURNED', 'الطلب ليس مُرجَعاً', 409);
      const next = {
        ...req,
        title: input.title ?? req.title,
        payload: input.payload ?? req.payload,
      };
      await ctx.trx
        .updateTable('approvalRequests')
        .set({
          title: next.title,
          payload: JSON.stringify(next.payload),
          status: 'pending',
          finalNote: null,
          version: sql`version + 1`,
        })
        .where('id', '=', requestId)
        .execute();
      await record(ctx, requestId, userId, 'resubmit');
      await advance(ctx, next, 0, userId);
      const after = await loadRequest(ctx, requestId, false);
      return { status: after.status };
    },

    /** سحب الطلب من مقدّمه ما دام قيد الموافقة أو مُرجَعاً. */
    withdraw: async (
      ctx: Ctx,
      requestId: string,
      userId: string,
      note?: string | null,
    ): Promise<{ status: string }> => {
      const req = await loadRequest(ctx, requestId);
      if (req.requesterUserId !== userId) throw bad('FORBIDDEN', 'مقدّم الطلب فقط', 403);
      if (req.status !== 'pending' && req.status !== 'returned')
        throw bad('NOT_WITHDRAWABLE', 'لا يمكن سحب طلب منتهٍ', 409);
      await ctx.trx
        .updateTable('approvalRequestAssignees')
        .set({ status: 'cancelled' })
        .where('requestId', '=', requestId)
        .where('status', '=', 'pending')
        .execute();
      await record(ctx, requestId, userId, 'withdraw', { note: note?.trim() || null });
      await finalize(ctx, req, 'withdrawn', userId, note?.trim() || null);
      return { status: 'withdrawn' };
    },
  };
};
