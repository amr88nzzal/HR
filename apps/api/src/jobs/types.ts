import type { JobQueueName } from '@hrms/shared';
import type { Ctx } from '../db/tenant.js';

export type JobInfo = { runId: string; attempt: number; maxAttempts: number };

/** تعريف مهمة: يُسجَّل في سجل واحد يستعمله العامل والإدراج. */
export type JobDefinition<T = unknown> = {
  name: string;
  queue: JobQueueName;
  /** يتحقق من الحمولة (عادةً Zod.parse) عند الإدراج وعند التنفيذ */
  parse: (data: unknown) => T;
  /** يعمل داخل معاملة الشركة (RLS)؛ الإخفاق = رمي استثناء فتُعاد المحاولة */
  handle: (ctx: Ctx, data: T, info: JobInfo) => Promise<unknown>;
  /** يُستدعى مرة واحدة بعد استنفاد المحاولات، في معاملة مستقلة (لتسجيل الفشل على الكيان) */
  onFailure?: (ctx: Ctx, data: T, error: string, info: JobInfo) => Promise<void>;
};

export type JobRegistry = ReadonlyMap<string, JobDefinition>;

/** المهمة الدورية: cron بتوقيت UTC، وتُنفَّذ لكل شركة نشطة (تتفرّع عند الاستحقاق). */
export type PeriodicJob = { job: string; cron: string };

/** ما يُخزَّن في حمولة pg-boss */
export type JobPayload = {
  job: string;
  companyId: string;
  runId: string;
  userId: string | null;
  requestId: string;
  data: unknown;
};

/** حمولة الاستحقاق الدوري (بلا شركة بعد) */
export type TickPayload = { tick: string };

/** يعرّف مهمة بحمولة منمَّطة (T تُستنتج من parse) ويمحو النوع لتسجيلها في السجل */
export const defineJob = <T>(def: JobDefinition<T>): JobDefinition => def as JobDefinition;

export const makeRegistry = (defs: JobDefinition[]): JobRegistry =>
  new Map(defs.map((d) => [d.name, d]));
