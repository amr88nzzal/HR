import { CompiledQuery } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Ctx, Trx } from '../db/tenant.js';
import { AppError } from '../shared/errors.js';
import { QUEUE_OPTIONS } from './queues.js';
import type { JobPayload, JobRegistry } from './types.js';

export type EnqueueOptions = {
  /** تأخير التنفيذ: تاريخ أو عدد ثوانٍ */
  startAfter?: Date | number;
  /** يمنع التكرار: مهمة واحدة نشطة لكل مفتاح */
  singletonKey?: string;
  /** استثناء لسياسة الطابور (للاختبارات خصوصاً) */
  retryLimit?: number;
  retryDelay?: number;
};

export type JobQueue = {
  /**
   * يُدرج المهمة داخل معاملة العمل نفسها (ctx.trx): إن تراجع العمل تراجعت المهمة،
   * فالطابور يقوم بدور Outbox. يعيد معرّف تشغيل job_runs، أو null إن رُفضت لتكرار المفتاح.
   */
  enqueue: (
    ctx: Ctx,
    name: string,
    data: unknown,
    options?: EnqueueOptions,
  ) => Promise<string | null>;
};

/** يعرض معاملة Kysely كواجهة قاعدة بيانات لـ pg-boss ليعمل الإدراج ضمنها */
export const bossDbFromTrx = (trx: Trx) => ({
  executeSql: async (text: string, values: unknown[] = []) => {
    const res = await trx.executeQuery(CompiledQuery.raw(text, values));
    return { rows: res.rows as never[] };
  },
});

export const createJobQueue = (boss: PgBoss, registry: JobRegistry): JobQueue => ({
  enqueue: async (ctx, name, data, options = {}) => {
    const def = registry.get(name);
    if (!def) throw new AppError('UNKNOWN_JOB', 500, `مهمة غير معرّفة: ${name}`);
    const parsed = def.parse(data);
    const qo = QUEUE_OPTIONS[def.queue];
    const retryLimit = options.retryLimit ?? qo.retryLimit ?? 0;
    const startAfter = options.startAfter instanceof Date ? options.startAfter : undefined;

    const run = await ctx.trx
      .insertInto('jobRuns')
      .values({
        companyId: ctx.companyId,
        jobName: name,
        queue: def.queue,
        maxAttempts: retryLimit + 1,
        payload: JSON.stringify(parsed ?? {}),
        requestedBy: ctx.userId,
        scheduledFor: startAfter ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const payload: JobPayload = {
      job: name,
      companyId: ctx.companyId,
      runId: run.id,
      userId: ctx.userId,
      requestId: ctx.requestId,
      data: parsed,
    };
    const bossId = await boss.send(def.queue, payload, {
      db: bossDbFromTrx(ctx.trx),
      retryLimit,
      ...(options.retryDelay !== undefined ? { retryDelay: options.retryDelay } : {}),
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
    });
    if (!bossId) {
      await ctx.trx.deleteFrom('jobRuns').where('id', '=', run.id).execute();
      return null;
    }
    await ctx.trx
      .updateTable('jobRuns')
      .set({ bossJobId: bossId })
      .where('id', '=', run.id)
      .execute();
    return run.id;
  },
});
