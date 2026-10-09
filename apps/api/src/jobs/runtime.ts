import { QUEUE_CONCURRENCY, QUEUE_OPTIONS } from './queues.js';
import type { PgBoss, JobWithMetadata } from 'pg-boss';
import { JOB_QUEUES } from '@hrms/shared';
import type { Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import type { Logger } from 'pino';
import type { Updateable } from 'kysely';
import type { JobRunsTable } from '../db/types.js';
import { createJobQueue } from './queue.js';
import type { JobPayload, JobRegistry, PeriodicJob, TickPayload } from './types.js';

export type WorkerDeps = {
  boss: PgBoss;
  /** اتصال التطبيق (hrms_app): ينفّذ المهام بسياق الشركة تحت RLS */
  db: Db;
  /** اتصال المالك: لسرد الشركات النشطة عند التفرّع الدوري فقط */
  adminDb: Db;
  registry: JobRegistry;
  periodic: PeriodicJob[];
  logger: Logger;
  /** فترة الاستعلام عن المهام (ثوانٍ)؛ الافتراضي 2 */
  pollSeconds?: number;
};

const truncate = (s: string, max = 2000) => (s.length > max ? `${s.slice(0, max)}…` : s);
const messageOf = (err: unknown) => truncate(err instanceof Error ? `${err.message}` : String(err));

type Job = JobWithMetadata<JobPayload & TickPayload>;

/** يزامن المهام الدورية مع الكود: يضيف الجديد ويحذف ما لم يعد معرَّفاً. */
export const syncSchedules = async (
  boss: PgBoss,
  registry: JobRegistry,
  periodic: PeriodicJob[],
): Promise<void> => {
  const wanted = new Map<string, PeriodicJob>();
  for (const p of periodic) {
    if (!registry.has(p.job)) throw new Error(`مهمة دورية غير معرّفة: ${p.job}`);
    wanted.set(p.job, p);
  }
  for (const p of wanted.values()) {
    const queue = registry.get(p.job)!.queue;
    await boss.schedule(queue, p.cron, { tick: p.job } satisfies TickPayload, { key: p.job });
  }
  for (const s of await boss.getSchedules()) {
    if (s.key && !wanted.has(s.key)) await boss.unschedule(s.name, s.key);
  }
};

/** يتفرّع الاستحقاق الدوري إلى مهمة لكل شركة نشطة (كل مهمة تظهر في المراقب) */
const fanOut = async (deps: WorkerDeps, tick: TickPayload): Promise<void> => {
  const queue = createJobQueue(deps.boss, deps.registry);
  const companies = await deps.adminDb
    .selectFrom('companies')
    .select('id')
    .where('status', '=', 'active')
    .execute();
  for (const c of companies) {
    await withTenant(deps.db, { companyId: c.id, requestId: `tick:${tick.tick}` }, async (ctx) => {
      // مفتاح فريد لكل شركة يمنع تراكم الاستحقاقات إن تأخر العامل
      await queue.enqueue(ctx, tick.tick, {}, { singletonKey: `${tick.tick}:${c.id}` });
    });
  }
};

const setRun = (deps: WorkerDeps, p: JobPayload, patch: Updateable<JobRunsTable>) =>
  withTenant(deps.db, { companyId: p.companyId, requestId: p.requestId }, (ctx) =>
    ctx.trx.updateTable('jobRuns').set(patch).where('id', '=', p.runId).execute(),
  );

const processJob = async (deps: WorkerDeps, job: Job): Promise<void> => {
  const data = job.data;
  if ('tick' in data && !('job' in data)) {
    await fanOut(deps, data);
    return;
  }
  const p = data;
  const attempt = job.retryCount + 1;
  const maxAttempts = job.retryLimit + 1;
  const def = deps.registry.get(p.job);
  if (!def) {
    // لا فائدة من إعادة المحاولة: تُسجَّل فاشلة نهائياً وتُكمل في الطابور
    await setRun(deps, p, {
      status: 'failed',
      error: `مهمة غير معرّفة: ${p.job}`,
      finishedAt: new Date(),
    });
    deps.logger.error({ job: p.job, runId: p.runId }, 'unknown job');
    return;
  }

  await setRun(deps, p, {
    status: 'running',
    attempt,
    maxAttempts,
    startedAt: new Date(),
    finishedAt: null,
  });
  try {
    const parsed = def.parse(p.data);
    const result = await withTenant(
      deps.db,
      { companyId: p.companyId, userId: p.userId, requestId: p.requestId },
      (ctx) => def.handle(ctx, parsed, { runId: p.runId, attempt, maxAttempts }),
    );
    await setRun(deps, p, {
      status: 'succeeded',
      result: JSON.stringify(result ?? null),
      error: null,
      finishedAt: new Date(),
    });
  } catch (err) {
    const final = attempt >= maxAttempts;
    await setRun(deps, p, {
      status: final ? 'failed' : 'retrying',
      error: messageOf(err),
      finishedAt: final ? new Date() : null,
    });
    if (final && def.onFailure) {
      try {
        const onFailure = def.onFailure;
        await withTenant(
          deps.db,
          { companyId: p.companyId, userId: p.userId, requestId: p.requestId },
          (ctx) =>
            onFailure(ctx, def.parse(p.data), messageOf(err), {
              runId: p.runId,
              attempt,
              maxAttempts,
            }),
        );
      } catch (hookErr) {
        deps.logger.error(
          { job: p.job, runId: p.runId, err: messageOf(hookErr) },
          'onFailure hook failed',
        );
      }
    }
    deps.logger.warn(
      { job: p.job, runId: p.runId, attempt, maxAttempts, err: messageOf(err) },
      final ? 'job failed permanently' : 'job failed, will retry',
    );
    throw err; // يعيد pg-boss المحاولة بتراجع أسّي أو يعلّمها فاشلة
  }
};

/** يسجّل عمّال الطوابير الأربعة. يعيد دالة إيقاف هادئ. */
export const startWorkers = async (deps: WorkerDeps): Promise<void> => {
  await syncSchedules(deps.boss, deps.registry, deps.periodic);
  for (const queue of JOB_QUEUES) {
    await deps.boss.work<JobPayload & TickPayload>(
      queue,
      {
        includeMetadata: true,
        batchSize: 1,
        localConcurrency: QUEUE_CONCURRENCY[queue],
        pollingIntervalSeconds: deps.pollSeconds ?? 2,
      },
      async (jobs) => {
        for (const job of jobs) await processJob(deps, job as Job);
      },
    );
  }
  deps.logger.info({ queues: Object.keys(QUEUE_OPTIONS) }, 'job workers started');
};
