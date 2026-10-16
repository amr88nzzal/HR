import { z } from 'zod';
import { sql } from 'kysely';
import { createNotifier } from '../../notifications/index.js';
import { defineJob } from '../../jobs/types.js';
import { deleteStoredBytes, saveStoredFile, type FileDeps } from '../../shared/stored-files.js';
import { loadGrants } from '../identity/index.js';
import { iterateRows, parseFilters, pickColumns, requireReport } from './engine.js';
import { buildExport, MIME, type ExportFormat, type Lang } from './export.js';
import { outName } from './naming.js';

export const REPORT_FILE_TTL_HOURS = 24;

type RunRow = {
  userId: string;
  reportCode: string;
  format: ExportFormat;
  filters: Record<string, string>;
  columns: string[];
  lang: Lang;
};

/** تصدير تقرير كبير (CSV/Excel) كمهمة خلفية: يكتب الملف على دفعات ثم يُشعر صاحب الطلب بالرابط */
export const reportJobs = (files: FileDeps, publicUrl?: string) => [
  defineJob({
    name: 'reports.export',
    queue: 'bulk',
    parse: (d) => z.object({ runId: z.string().uuid() }).strict().parse(d),
    handle: async (ctx, { runId }, info) => {
      const { rows: found } = await sql<RunRow>`
        select user_id, report_code, format, filters, columns, lang from report_runs
         where id = ${runId} and status in ('queued', 'running') for update`.execute(ctx.trx);
      const run = found[0];
      if (!run) return { skipped: true };
      await sql`update report_runs set status = 'running' where id = ${runId}`.execute(ctx.trx);
      // الصلاحيات تُقرأ لحظة التنفيذ: من سُحبت صلاحيته بعد الطلب لا يحصل على الملف
      const auth = {
        userId: run.userId,
        companyId: ctx.companyId,
        permissionsVersion: 0,
        grants: await loadGrants(ctx, run.userId),
      };
      const def = requireReport(auth, run.reportCode);
      const cols = pickColumns(auth, def.manifest, run.columns);
      const filters = parseFilters(def.manifest, run.filters);
      const built = await buildExport(
        run.format,
        cols,
        iterateRows(ctx, auth, def, filters, cols),
        {
          title: def.manifest[run.lang === 'en' ? 'titleEn' : 'titleAr'],
          lang: run.lang,
          filtersText: '',
        },
      );
      const file = await saveStoredFile(ctx, files, {
        buffer: built.buffer,
        mime: MIME[run.format].split(';')[0]!,
        originalName: outName(def.manifest.code, run.format),
        purpose: 'report',
        encrypt: Boolean(files.crypto),
      });
      await sql`
        update report_runs set status = 'done', row_count = ${built.rows}, file_id = ${file.id},
               finished_at = now(), expires_at = now() + make_interval(hours => ${REPORT_FILE_TTL_HOURS})
         where id = ${runId}`.execute(ctx.trx);
      await createNotifier(info.queue).notify(ctx, {
        userId: run.userId,
        event: 'reports.export_ready',
        vars: {
          report: def.manifest[run.lang === 'en' ? 'titleEn' : 'titleAr'],
          link: `${(publicUrl ?? '').replace(/\/$/, '')}/reports?runs=1`,
        },
        link: '/reports?runs=1',
      });
      return { rows: built.rows };
    },
    onFailure: async (ctx, { runId }, error, info) => {
      const { rows } = await sql<{ userId: string; reportCode: string }>`
        update report_runs set status = 'failed', error = ${error.slice(0, 500)}, finished_at = now()
         where id = ${runId} returning user_id, report_code`.execute(ctx.trx);
      const r = rows[0];
      if (r)
        await createNotifier(info.queue).notify(ctx, {
          userId: r.userId,
          event: 'reports.export_failed',
          vars: { report: r.reportCode, error: error.slice(0, 200) },
        });
    },
  }),
  /** حذف ملفات التقارير المنتهية (الرابط مؤقت) */
  defineJob({
    name: 'reports.cleanup',
    queue: 'bulk',
    parse: (d) =>
      z
        .object({})
        .strict()
        .parse(d ?? {}) as Record<string, never>,
    handle: async (ctx) => {
      const { rows } = await sql<{ id: string; fileId: string; storageKey: string }>`
        select r.id, f.id as file_id, f.storage_key from report_runs r
          join stored_files f on f.id = r.file_id
         where r.expires_at < now()`.execute(ctx.trx);
      for (const r of rows) {
        await sql`update report_runs set file_id = null where id = ${r.id}`.execute(ctx.trx);
        await sql`delete from stored_files where id = ${r.fileId}`.execute(ctx.trx);
      }
      await deleteStoredBytes(
        files,
        rows.map((r) => r.storageKey),
      );
      return { deleted: rows.length };
    },
  }),
];
