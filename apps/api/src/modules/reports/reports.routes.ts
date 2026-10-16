import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import type { JobQueue } from '../../jobs/index.js';
import { AppError } from '../../shared/errors.js';
import { readStoredFile, type FileDeps } from '../../shared/stored-files.js';
import { loadLetterhead } from '../brand/index.js';
import { hasPermission } from '../identity/index.js';
import type { Renderer } from '../letters/index.js';
import { companyLang, makeRun } from '../payroll/index.js';
import {
  allowedColumns,
  countRows,
  fetchPage,
  iterateRows,
  manifestFor,
  parseFilters,
  pickColumns,
  requireReport,
  visibleReports,
} from './engine.js';
import {
  buildExport,
  DIRECT_ROWS_LIMIT,
  EXPORT_FORMATS,
  MAX_ROWS,
  MIME,
  type ExportFormat,
  type Lang,
} from './export.js';
import { filtersText, outName } from './naming.js';
import type { ReportDef, ReportColumn } from './types.js';
import type { AuthContext } from '../identity/index.js';

type Row = Record<string, unknown>;
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export type ReportsDeps = {
  files: FileDeps;
  render: Renderer | undefined;
  jobs: JobQueue | undefined;
};

const langParam = z.enum(['ar', 'en']).optional();
const columnsParam = (v: unknown): string[] | undefined => {
  if (typeof v !== 'string' || !v) return undefined;
  const keys = v.split(',').map((s) => s.trim());
  if (keys.length > 60 || keys.some((k) => !/^[A-Za-z0-9_]{1,40}$/.test(k)))
    throw new AppError('VALIDATION_ERROR', 400, 'قائمة الأعمدة غير صالحة');
  return keys;
};
const formatParam = z.enum(EXPORT_FORMATS);

const titleOf = (def: ReportDef, lang: Lang) =>
  lang === 'en' ? def.manifest.titleEn : def.manifest.titleAr;

export const createReportsRouter = (
  db: Db,
  authenticate: RequestHandler,
  deps: ReportsDeps,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  const authOf = (req: Request) => req.auth as AuthContext;

  const logRun = async (
    ctx: Ctx,
    v: {
      code: string;
      format: ExportFormat;
      mode: 'direct' | 'job';
      filters: object;
      columns: string[];
      lang: Lang;
      status: 'queued' | 'done';
      rows?: number;
    },
  ): Promise<string> => {
    const { rows } = await sql<{ id: string }>`
      insert into report_runs (company_id, user_id, report_code, format, mode, filters, columns, lang,
                               status, row_count, finished_at)
      values (${ctx.companyId}, ${ctx.userId}, ${v.code}, ${v.format}, ${v.mode},
              ${JSON.stringify(v.filters)}::jsonb, ${JSON.stringify(v.columns)}::jsonb, ${v.lang},
              ${v.status}, ${v.rows ?? null}, ${v.status === 'done' ? sql`now()` : null})
      returning id`.execute(ctx.trx);
    return rows[0]!.id;
  };

  // ───── فهرس التقارير ─────
  router.get('/', (req, res) => {
    const auth = authOf(req);
    res.json({ data: visibleReports(auth).map((r) => manifestFor(auth, r.manifest)) });
  });

  // ───── سجل التشغيل (قبل /:code) ─────
  router.get(
    '/runs',
    wrap(async (req, res) => {
      const auth = authOf(req);
      const all = req.query['all'] === '1';
      if (all && !hasPermission(auth, 'system.audit.read'))
        throw new AppError('FORBIDDEN', 403, 'ليست لديك صلاحية هذا الإجراء');
      const data = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select r.id, r.report_code, r.format, r.mode, r.status, r.row_count, r.error, r.created_at,
                 r.finished_at, r.expires_at, u.email as user_email,
                 (r.file_id is not null and r.expires_at > now()) as downloadable
            from report_runs r join users u on u.id = r.user_id
           where r.company_id = ${ctx.companyId} ${all ? sql`` : sql`and r.user_id = ${auth.userId}`}
           order by r.created_at desc limit 100`.execute(ctx.trx);
        return rows;
      });
      res.json({ data });
    }),
  );
  router.get(
    '/runs/:id/download',
    wrap(async (req, res) => {
      const auth = authOf(req);
      const id = uuid.parse(req.params['id']);
      const out = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select r.user_id, r.format, r.expires_at, f.storage_key, f.is_encrypted, f.original_name
            from report_runs r left join stored_files f on f.id = r.file_id
           where r.id = ${id} and r.company_id = ${ctx.companyId}`.execute(ctx.trx);
        const r = rows[0];
        if (!r || (r.userId !== auth.userId && !hasPermission(auth, 'system.audit.read')))
          throw new AppError('NOT_FOUND', 404, 'التشغيل غير موجود');
        if (!r.storageKey || (r.expiresAt && new Date(r.expiresAt as string) < new Date()))
          throw new AppError('EXPIRED', 410, 'انتهت صلاحية الملف؛ أعد التصدير');
        const bytes = await readStoredFile(deps.files, {
          storageKey: r.storageKey as string,
          isEncrypted: Boolean(r.isEncrypted),
        });
        return { bytes, format: r.format as ExportFormat, name: r.originalName as string };
      });
      res.setHeader('Content-Type', MIME[out.format]);
      res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(out.bytes);
    }),
  );
  router.delete(
    '/layouts/:id',
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const auth = authOf(req);
      await run(req, async (ctx) => {
        const r = await sql`delete from report_layouts where id = ${id} and user_id = ${auth.userId}
          and company_id = ${ctx.companyId}`.execute(ctx.trx);
        if (!Number(r.numAffectedRows ?? 0))
          throw new AppError('NOT_FOUND', 404, 'التخطيط غير موجود');
      });
      res.status(204).end();
    }),
  );

  // ───── تقرير واحد ─────
  router.get(
    '/:code',
    wrap(async (req, res) => {
      const auth = authOf(req);
      const def = requireReport(auth, String(req.params['code']));
      const layouts = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select id, name, columns, is_default from report_layouts
           where user_id = ${auth.userId} and report_code = ${def.manifest.code}
             and company_id = ${ctx.companyId} order by name`.execute(ctx.trx);
        return rows;
      });
      res.json({ data: { manifest: manifestFor(auth, def.manifest), layouts } });
    }),
  );

  const resolve = (req: Request, source: Record<string, unknown>) => {
    const auth = authOf(req);
    const def = requireReport(auth, String(req.params['code']));
    const filters = parseFilters(def.manifest, source);
    const cols = pickColumns(auth, def.manifest, columnsParam(source['columns']));
    return { auth, def, filters, cols };
  };

  router.get(
    '/:code/run',
    wrap(async (req, res) => {
      const { auth, def, filters, cols } = resolve(req, req.query);
      const q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(req.query);
      const out = await run(req, async (ctx) => {
        const total = await countRows(ctx, auth, def, filters);
        const rows = await fetchPage(
          ctx,
          auth,
          def,
          filters,
          cols,
          q.pageSize,
          (q.page - 1) * q.pageSize,
        );
        return { total, rows };
      });
      res.json({
        data: out.rows,
        meta: { page: q.page, pageSize: q.pageSize, total: out.total, columns: cols },
      });
    }),
  );

  /** تصدير مباشر للصغير؛ الكبير (CSV/Excel) يُرفض بـ 409 ليُطلب كمهمة */
  router.get(
    '/:code/export',
    wrap(async (req, res) => {
      const { auth, def, filters, cols } = resolve(req, req.query);
      const format = formatParam.parse(req.query['format']);
      const lang = langParam.parse(req.query['lang']);
      const out = await run(req, async (ctx) => {
        const l: Lang = lang ?? (await companyLang(ctx));
        const total = await countRows(ctx, auth, def, filters);
        if (total > MAX_ROWS[format])
          throw new AppError(
            'REPORT_TOO_LARGE',
            413,
            `الحد الأقصى لصيغة ${format.toUpperCase()} هو ${MAX_ROWS[format]} صف؛ ضيّق المرشحات`,
          );
        if ((format === 'csv' || format === 'xlsx') && total > DIRECT_ROWS_LIMIT)
          throw new AppError(
            'EXPORT_TOO_LARGE_FOR_DIRECT',
            409,
            'التقرير كبير؛ يُصدَّر كمهمة خلفية ويصلك إشعار بالرابط',
            { total },
          );
        const letterhead =
          format === 'html' || format === 'pdf'
            ? await loadLetterhead(ctx, deps.files, l)
            : undefined;
        const built = await buildExport(format, cols, iterateRows(ctx, auth, def, filters, cols), {
          title: titleOf(def, l),
          lang: l,
          filtersText: filtersText(def.manifest, filters, l),
          letterhead,
          render: deps.render,
        });
        await logRun(ctx, {
          code: def.manifest.code,
          format,
          mode: 'direct',
          filters,
          columns: cols.map((c) => c.key),
          lang: l,
          status: 'done',
          rows: built.rows,
        });
        return built;
      });
      res.setHeader('Content-Type', MIME[format]);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${outName(def.manifest.code, format)}"`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(out.buffer);
    }),
  );

  router.post(
    '/:code/export-jobs',
    wrap(async (req, res) => {
      const body = z
        .object({
          format: z.enum(['csv', 'xlsx']),
          filters: z.record(z.string(), z.unknown()).default({}),
          columns: z
            .array(z.string().regex(/^[A-Za-z0-9_]{1,40}$/))
            .max(60)
            .optional(),
          lang: langParam,
        })
        .parse(req.body);
      const auth = authOf(req);
      const def = requireReport(auth, String(req.params['code']));
      const filters = parseFilters(def.manifest, body.filters);
      const cols: ReportColumn[] = pickColumns(auth, def.manifest, body.columns);
      if (!deps.jobs) throw new AppError('JOBS_UNAVAILABLE', 503, 'طابور المهام غير متاح');
      const jobs = deps.jobs;
      const runId = await run(req, async (ctx) => {
        const total = await countRows(ctx, auth, def, filters);
        if (total > MAX_ROWS[body.format])
          throw new AppError(
            'REPORT_TOO_LARGE',
            413,
            `الحد الأقصى ${MAX_ROWS[body.format]} صف؛ ضيّق المرشحات`,
          );
        const id = await logRun(ctx, {
          code: def.manifest.code,
          format: body.format,
          mode: 'job',
          filters,
          columns: cols.map((c) => c.key),
          lang: body.lang ?? (await companyLang(ctx)),
          status: 'queued',
        });
        await jobs.enqueue(ctx, 'reports.export', { runId: id });
        return id;
      });
      res.status(202).json({ data: { runId } });
    }),
  );

  router.post(
    '/:code/layouts',
    wrap(async (req, res) => {
      const body = z
        .object({
          name: z.string().trim().min(1).max(80),
          columns: z
            .array(z.string().regex(/^[A-Za-z0-9_]{1,40}$/))
            .min(1)
            .max(60),
          isDefault: z.boolean().default(false),
        })
        .parse(req.body);
      const auth = authOf(req);
      const def = requireReport(auth, String(req.params['code']));
      const ok = new Set(allowedColumns(auth, def.manifest).map((c) => c.key));
      const cols = body.columns.filter((c) => ok.has(c));
      if (!cols.length) throw new AppError('VALIDATION_ERROR', 400, 'لا أعمدة صالحة في التخطيط');
      const data = await run(req, async (ctx) => {
        if (body.isDefault)
          await sql`update report_layouts set is_default = false where user_id = ${auth.userId}
            and report_code = ${def.manifest.code}`.execute(ctx.trx);
        const { rows } = await sql<Row>`
          insert into report_layouts (company_id, user_id, report_code, name, columns, is_default)
          values (${ctx.companyId}, ${auth.userId}, ${def.manifest.code}, ${body.name},
                  ${JSON.stringify(cols)}::jsonb, ${body.isDefault})
          on conflict (user_id, report_code, name)
          do update set columns = excluded.columns, is_default = excluded.is_default
          returning id, name, columns, is_default`.execute(ctx.trx);
        return rows[0];
      });
      res.status(201).json({ data });
    }),
  );
  return router;
};
