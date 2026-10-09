import { z } from 'zod';
import { sql } from 'kysely';
import { defineJob, type JobDefinition, type PeriodicJob } from './types.js';

/** تنظيف دوري: سجلات المهام المنتهية القديمة، والرموز المنتهية */
const cleanup = defineJob({
  name: 'system.cleanup',
  queue: 'bulk',
  parse: (d) =>
    z
      .object({})
      .strict()
      .parse(d ?? {}) as Record<string, never>,
  handle: async (ctx) => {
    const runs = await sql`
      delete from job_runs
      where company_id = ${ctx.companyId} and finished_at < now() - interval '90 days'`.execute(
      ctx.trx,
    );
    const tokens = await sql`
      delete from refresh_tokens
      where company_id = ${ctx.companyId} and expires_at < now() - interval '30 days'`.execute(
      ctx.trx,
    );
    const resets = await sql`
      delete from password_resets
      where company_id = ${ctx.companyId} and expires_at < now() - interval '30 days'`.execute(
      ctx.trx,
    );
    return {
      jobRuns: Number(runs.numAffectedRows ?? 0),
      refreshTokens: Number(tokens.numAffectedRows ?? 0),
      passwordResets: Number(resets.numAffectedRows ?? 0),
    };
  },
});

/** المهام المعرَّفة للنظام؛ المراحل اللاحقة تضيف مهامها هنا (الإشعارات، الأرشيف...). */
export const SYSTEM_JOBS: JobDefinition[] = [cleanup];

/** المهام الدورية (cron بتوقيت UTC). مرجعها الكود، ويزامنها العامل عند الإقلاع. */
export const PERIODIC_JOBS: PeriodicJob[] = [{ job: 'system.cleanup', cron: '30 2 * * *' }];
