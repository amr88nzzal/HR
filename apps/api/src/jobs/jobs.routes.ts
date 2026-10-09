import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { jobListQuery, type ApiEnvelope, type JobRunDto } from '@hrms/shared';
import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import { AppError } from '../shared/errors.js';
import { requirePermission } from '../modules/identity/index.js';
import type { JobQueue } from './queue.js';

const READ = 'system.job.read';
const RETRY = 'system.job.retry';

const notFound = () => new AppError('NOT_FOUND', 404, 'المهمة غير موجودة');
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type RunRow = {
  id: string;
  jobName: string;
  queue: JobRunDto['queue'];
  status: JobRunDto['status'];
  attempt: number;
  maxAttempts: number;
  error: string | null;
  retryOf: string | null;
  scheduledFor: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

const toDto = (r: RunRow): JobRunDto => ({
  id: r.id,
  jobName: r.jobName,
  queue: r.queue,
  status: r.status,
  attempt: r.attempt,
  maxAttempts: r.maxAttempts,
  error: r.error,
  retryOf: r.retryOf,
  scheduledFor: iso(r.scheduledFor),
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt),
  createdAt: r.createdAt.toISOString(),
});

const COLUMNS = [
  'id',
  'jobName',
  'queue',
  'status',
  'attempt',
  'maxAttempts',
  'error',
  'retryOf',
  'scheduledFor',
  'startedAt',
  'finishedAt',
  'createdAt',
] as const;

/** مراقب المهام الخلفية: قائمة وتفاصيل وإحصاءات وإعادة تشغيل الفاشلة. */
export const createJobsRouter = (
  db: Db,
  authenticate: RequestHandler,
  queue?: JobQueue,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };

  router.get('/', requirePermission(READ), async (req, res, next) => {
    try {
      const q = jobListQuery.parse(req.query);
      const out = await run(req, async (ctx) => {
        const build = () => {
          let b = ctx.trx.selectFrom('jobRuns').where('companyId', '=', ctx.companyId);
          if (q.status) b = b.where('status', '=', q.status);
          if (q.queue) b = b.where('queue', '=', q.queue);
          if (q.jobName) b = b.where('jobName', '=', q.jobName);
          return b;
        };
        const rows = await build()
          .select([...COLUMNS])
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute();
        const total = Number(
          (
            await build()
              .select(sql<string>`count(*)`.as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        return { rows, total };
      });
      const body: ApiEnvelope<JobRunDto[]> = {
        data: out.rows.map(toDto),
        meta: { page: q.page, pageSize: q.pageSize, total: out.total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // عدد التشغيلات بحسب الحالة خلال آخر 24 ساعة (لبطاقات المراقب)
  router.get('/stats', requirePermission(READ), async (req, res, next) => {
    try {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('jobRuns')
          .select(['status', sql<string>`count(*)`.as('n')])
          .where('companyId', '=', ctx.companyId)
          .where(sql<boolean>`created_at > now() - interval '24 hours'`)
          .groupBy('status')
          .execute(),
      );
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.status] = Number(r.n);
      res.json({ data: counts });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission(READ), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const row = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('jobRuns')
          .select([...COLUMNS, 'payload', 'result'])
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', id)
          .executeTakeFirst(),
      );
      if (!row) throw notFound();
      res.json({ data: { ...toDto(row), payload: row.payload, result: row.result } });
    } catch (err) {
      next(err);
    }
  });

  // إعادة تشغيل مهمة فاشلة: تشغيل جديد بالحمولة نفسها يرتبط بالأصل
  router.post('/:id/retry', requirePermission(RETRY), async (req, res, next) => {
    try {
      if (!queue) throw new AppError('JOBS_UNAVAILABLE', 503, 'خدمة المهام الخلفية غير مفعّلة');
      const id = idOf(req.params['id']);
      const newId = await run(req, async (ctx) => {
        const row = await ctx.trx
          .selectFrom('jobRuns')
          .select(['id', 'jobName', 'status', 'payload'])
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!row) throw notFound();
        if (row.status !== 'failed')
          throw new AppError('INVALID_STATE', 409, 'يمكن إعادة تشغيل المهام الفاشلة فقط');
        const created = await queue.enqueue(ctx, row.jobName, row.payload);
        if (!created) throw new AppError('INVALID_STATE', 409, 'المهمة قيد التشغيل بالفعل');
        await ctx.trx
          .updateTable('jobRuns')
          .set({ retryOf: id })
          .where('id', '=', created)
          .execute();
        await ctx.trx
          .insertInto('auditLogs')
          .values({
            companyId: ctx.companyId,
            userId: ctx.userId,
            entityType: 'job_runs',
            entityId: id,
            action: 'retry',
            changes: JSON.stringify({ newRunId: created }),
            requestId: ctx.requestId,
            ip: null,
          })
          .execute();
        return created;
      });
      res.status(202).json({ data: { id: newId } });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
