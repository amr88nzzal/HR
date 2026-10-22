import express, { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  csvList,
  MAX_FILE_BYTES,
  leaveOverrideInput,
  leaveRequestInput,
  leaveRequestListQuery,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import {
  readStoredFile,
  saveStoredFile,
  validateUpload,
  type FileDeps,
} from '../../shared/stored-files.js';
import type { ApprovalEngine } from '../../approvals/index.js';
import { hasPermission, requirePermission } from '../identity/index.js';
import { calendarData } from './reports.js';
import { analyze, cancelRequest, overrideDays, previewDto, submitRequest } from './requests.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const calendarQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    departmentId: csvList(uuid),
    branchId: csvList(uuid),
  })
  .refine((v) => v.to >= v.from, { message: 'تاريخ النهاية قبل البداية', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'الفترة أطول من 62 يوماً',
    path: ['to'],
  });
const idParam = z.object({ id: uuid });

const employeeOfUser = async (ctx: Ctx, userId: string): Promise<string> => {
  const e = await ctx.trx
    .selectFrom('employees')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (!e) throw new AppError('NO_EMPLOYEE', 409, 'حسابك غير مرتبط بملف موظف');
  return e.id;
};

const baseSelect = (ctx: Ctx) =>
  ctx.trx
    .selectFrom('leaveRequests as r')
    .innerJoin('employees as e', 'e.id', 'r.employeeId')
    .innerJoin('leaveTypes as t', 't.id', 'r.leaveTypeId')
    .select((eb) => [
      'r.id',
      'r.employeeId',
      'e.fullNameAr as employeeName',
      'r.leaveTypeId',
      't.nameAr as leaveTypeNameAr',
      't.nameEn as leaveTypeNameEn',
      'r.startDate',
      'r.endDate',
      'r.firstDayHalf',
      'r.lastDayHalf',
      'r.reason',
      'r.days',
      'r.overrideDays',
      'r.overrideReason',
      eb.fn.coalesce('r.overrideDays', 'r.days').as('chargedDays'),
      'r.status',
      'r.approvalRequestId',
      'r.createdAt',
      'r.version',
    ])
    .where('r.companyId', '=', ctx.companyId);

/** من يرى الطلب: صاحبه، أو المعتمدون في سلسلته، أو من يملك عرض كل الإجازات / who may see a request: owner, approvers in its chain, or read_all */
const assertRequestVisible = async (
  ctx: Ctx,
  auth: NonNullable<Request['auth']>,
  r: { employeeId: string; approvalRequestId: string | null },
): Promise<void> => {
  let allowed = hasPermission(auth, 'leave.request.read_all');
  if (!allowed) {
    const owner = await ctx.trx
      .selectFrom('employees')
      .select('id')
      .where('id', '=', r.employeeId)
      .where('userId', '=', auth.userId)
      .executeTakeFirst();
    allowed = !!owner;
  }
  if (!allowed && r.approvalRequestId) {
    const a = await ctx.trx
      .selectFrom('approvalRequestAssignees')
      .select('id')
      .where('requestId', '=', r.approvalRequestId)
      .where('userId', '=', auth.userId)
      .executeTakeFirst();
    allowed = !!a;
  }
  if (!allowed) throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية عرض هذا الطلب');
};

const listAttachments = (ctx: Ctx, requestId: string) =>
  ctx.trx
    .selectFrom('leaveRequestAttachments as x')
    .innerJoin('storedFiles as f', 'f.id', 'x.fileId')
    .select(['x.id', 'f.originalName as name', 'f.mimeType', 'f.sizeBytes', 'x.createdAt'])
    .where('x.companyId', '=', ctx.companyId)
    .where('x.requestId', '=', requestId)
    .orderBy('x.createdAt')
    .execute();

const MAX_ATTACHMENTS = 5;
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const attachmentParams = z.object({ id: uuid, attId: uuid });

type ListQuery = z.infer<typeof leaveRequestListQuery>;

const listRequests = async (ctx: Ctx, q: ListQuery, employeeId?: string) => {
  const apply = <T extends ReturnType<typeof baseSelect>>(b: T): T => {
    let x = b as ReturnType<typeof baseSelect>;
    if (employeeId) x = x.where('r.employeeId', '=', employeeId);
    if (q.employeeId) x = x.where('r.employeeId', '=', q.employeeId);
    if (q.status) x = x.where('r.status', '=', q.status);
    if (q.from) x = x.where('r.endDate', '>=', q.from);
    if (q.to) x = x.where('r.startDate', '<=', q.to);
    return x as T;
  };
  const rows = await apply(baseSelect(ctx))
    .orderBy('r.startDate', 'desc')
    .orderBy('r.id', 'desc')
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .execute();
  const total = Number(
    (
      await apply(baseSelect(ctx))
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );
  return { rows, total };
};

/** طلبات الإجازة: المعاينة والتقديم والإلغاء والتجاوز. */
export const createLeaveRequestsRouter = (
  db: Db,
  authenticate: RequestHandler,
  engine: ApprovalEngine,
  files: FileDeps,
): Router => {
  const router = Router();
  const run = <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };
  router.use(authenticate);

  /** الموظف المقصود: نفسه، أو غيره بصلاحية الإدارة */
  const targetEmployee = async (req: Request, ctx: Ctx, wanted?: string): Promise<string> => {
    const auth = req.auth as NonNullable<Request['auth']>;
    const mine = await employeeOfUser(ctx, auth.userId).catch((e: unknown) => {
      if (wanted && hasPermission(auth, 'leave.request.manage')) return null;
      throw e;
    });
    if (!wanted || wanted === mine) return mine as string;
    if (!hasPermission(auth, 'leave.request.manage'))
      throw new AppError('FORBIDDEN', 403, 'التقديم نيابةً عن موظف آخر يتطلب صلاحية الإدارة');
    return wanted;
  };

  router.post('/preview', requirePermission('leave.request.submit'), async (req, res, next) => {
    try {
      const body = leaveRequestInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const employeeId = await targetEmployee(req, ctx, body.employeeId);
        return previewDto(await analyze(ctx, employeeId, body));
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('leave.request.submit'), async (req, res, next) => {
    try {
      const body = leaveRequestInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const employeeId = await targetEmployee(req, ctx, body.employeeId);
        const id = await submitRequest(ctx, engine, auth.userId, employeeId, body);
        return (await baseSelect(ctx).where('r.id', '=', id).executeTakeFirstOrThrow()) as unknown;
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const q = leaveRequestListQuery.parse(req.query);
      const { rows, total } = await run(req, async (ctx) =>
        listRequests(ctx, q, await employeeOfUser(ctx, (req.auth as { userId: string }).userId)),
      );
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', requirePermission('leave.request.read_all'), async (req, res, next) => {
    try {
      const q = leaveRequestListQuery.parse(req.query);
      const { rows, total } = await run(req, (ctx) => listRequests(ctx, q));
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/calendar', async (req, res, next) => {
    try {
      const q = calendarQuery.parse(req.query);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const all = hasPermission(auth, 'leave.request.read_all');
        const mine = await ctx.trx
          .selectFrom('employees')
          .select('id')
          .where('companyId', '=', ctx.companyId)
          .where('userId', '=', auth.userId)
          .executeTakeFirst();
        return calendarData(ctx, q, { all, employeeId: mine?.id ?? null });
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const r = await baseSelect(ctx).where('r.id', '=', id).executeTakeFirst();
        if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
        await assertRequestVisible(ctx, auth, r);
        const days = await ctx.trx
          .selectFrom('leaveRequestDays')
          .select(['dayDate', 'units', 'kind'])
          .where('requestId', '=', id)
          .orderBy('dayDate')
          .execute();
        const approval = r.approvalRequestId
          ? ((await ctx.trx
              .selectFrom('approvalRequests')
              .select(['id', 'status', 'currentPosition'])
              .where('id', '=', r.approvalRequestId)
              .executeTakeFirst()) ?? null)
          : null;
        const attachments = await listAttachments(ctx, id);
        const type = await ctx.trx
          .selectFrom('leaveTypes')
          .select('requiresAttachment')
          .where('id', '=', r.leaveTypeId)
          .executeTakeFirst();
        return {
          ...r,
          daysDetail: days,
          approval,
          attachments,
          requiresAttachment: type?.requiresAttachment ?? false,
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const { id } = idParam.parse(req.params);
      const { note } = z
        .object({ note: z.string().trim().max(300).nullish() })
        .parse(req.body ?? {});
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await cancelRequest(
          ctx,
          engine,
          id,
          { userId: auth.userId, canManage: hasPermission(auth, 'leave.request.manage') },
          note,
        );
        return baseSelect(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/:id/override',
    requirePermission('leave.request.manage'),
    async (req, res, next) => {
      try {
        const { id } = idParam.parse(req.params);
        const body = leaveOverrideInput.parse(req.body);
        const auth = req.auth as NonNullable<Request['auth']>;
        const data = await run(req, async (ctx) => {
          await overrideDays(ctx, id, auth.userId, body.days, body.reason);
          return baseSelect(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
        });
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ───── المرفقات (اختيارية دائماً؛ التنبيه في الواجهة عند «يتطلب مرفقاً») ─────
  /** المرفقات تُعدَّل لصاحب الطلب أثناء الانتظار، ولمن يملك الإدارة حتى بعد الاعتماد */
  const assertCanEditAttachments = async (
    ctx: Ctx,
    auth: NonNullable<Request['auth']>,
    requestId: string,
  ) => {
    const r = await baseSelect(ctx).where('r.id', '=', requestId).executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
    const manage = hasPermission(auth, 'leave.request.manage');
    if (!manage) {
      const owner = await ctx.trx
        .selectFrom('employees')
        .select('id')
        .where('id', '=', r.employeeId)
        .where('userId', '=', auth.userId)
        .executeTakeFirst();
      if (!owner) throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية تعديل مرفقات هذا الطلب');
    }
    const open = manage ? ['pending', 'approved'] : ['pending'];
    if (!open.includes(r.status))
      throw new AppError('REQUEST_CLOSED', 409, 'لا تُعدَّل مرفقات هذا الطلب في حالته الحالية');
    return r;
  };

  router.get('/:id/attachments', async (req, res, next) => {
    try {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const r = await baseSelect(ctx).where('r.id', '=', id).executeTakeFirst();
        if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
        await assertRequestVisible(ctx, auth, r);
        return listAttachments(ctx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/:id/attachments',
    express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
    async (req, res, next) => {
      try {
        const { id } = idParam.parse(req.params);
        const auth = req.auth as NonNullable<Request['auth']>;
        const body = req.body as unknown;
        const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
        const mime = validateUpload(buf, ATTACHMENT_TYPES);
        // الاسم من X-File-Name (مرمَّز URI من عميل الويب) أو ?name / name from X-File-Name or ?name
        const header = req.header('x-file-name');
        const rawName = header ? decodeURIComponent(header) : (req.query['name'] ?? 'attachment');
        const name = z.string().trim().min(1).max(200).parse(rawName);
        const data = await run(req, async (ctx) => {
          await assertCanEditAttachments(ctx, auth, id);
          const n = await ctx.trx
            .selectFrom('leaveRequestAttachments')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('companyId', '=', ctx.companyId)
            .where('requestId', '=', id)
            .executeTakeFirstOrThrow();
          if (Number(n.n) >= MAX_ATTACHMENTS)
            throw new AppError(
              'TOO_MANY_ATTACHMENTS',
              409,
              `الحد الأقصى ${MAX_ATTACHMENTS} مرفقات للطلب`,
            );
          const file = await saveStoredFile(ctx, files, {
            buffer: buf,
            mime,
            originalName: name,
            purpose: 'leave_request',
            encrypt: !!files.crypto,
          });
          return ctx.trx
            .insertInto('leaveRequestAttachments')
            .values({
              companyId: ctx.companyId,
              requestId: id,
              fileId: file.id,
              uploadedBy: ctx.userId ?? null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        });
        res.status(201).json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:id/attachments/:attId/content', async (req, res, next) => {
    try {
      const { id, attId } = attachmentParams.parse(req.params);
      const auth = req.auth as NonNullable<Request['auth']>;
      const file = await run(req, async (ctx) => {
        const r = await baseSelect(ctx).where('r.id', '=', id).executeTakeFirst();
        if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
        await assertRequestVisible(ctx, auth, r);
        const f = await ctx.trx
          .selectFrom('leaveRequestAttachments as x')
          .innerJoin('storedFiles as f', 'f.id', 'x.fileId')
          .selectAll('f')
          .where('x.companyId', '=', ctx.companyId)
          .where('x.requestId', '=', id)
          .where('x.id', '=', attId)
          .executeTakeFirst();
        if (!f) throw new AppError('NOT_FOUND', 404, 'المرفق غير موجود');
        // مرفقات طبية حساسة: كل تنزيل يُسجَّل / sensitive medical files: every download is logged
        await ctx.trx
          .insertInto('auditLogs')
          .values({
            companyId: ctx.companyId,
            userId: ctx.userId,
            entityType: 'leave_request_attachments',
            entityId: attId,
            action: 'download',
            changes: JSON.stringify({ requestId: id }),
            requestId: ctx.requestId,
            ip: req.ip ?? null,
          })
          .execute();
        return f;
      });
      const bytes = await readStoredFile(files, file);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id/attachments/:attId', async (req, res, next) => {
    try {
      const { id, attId } = attachmentParams.parse(req.params);
      const auth = req.auth as NonNullable<Request['auth']>;
      await run(req, async (ctx) => {
        await assertCanEditAttachments(ctx, auth, id);
        const r = await ctx.trx
          .deleteFrom('leaveRequestAttachments')
          .where('companyId', '=', ctx.companyId)
          .where('requestId', '=', id)
          .where('id', '=', attId)
          .executeTakeFirst();
        if (!r.numDeletedRows) throw new AppError('NOT_FOUND', 404, 'المرفق غير موجود');
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
