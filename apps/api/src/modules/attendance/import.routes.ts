import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { importHeldDiscardInput, importHeldResolveInput, importProfileInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { companyTimezone } from './days.js';
import {
  analyzeFile,
  applyImport,
  discardHeld,
  IMPORT_MAX_BYTES,
  loadProfile,
  reportOf,
  resolveHeld,
  revertBatch,
} from './import.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const profileColumns = [
  'id',
  'code',
  'nameAr',
  'nameEn',
  'delimiter',
  'encoding',
  'hasHeader',
  'columns',
  'dateOrder',
  'directionMode',
  'inValues',
  'outValues',
  'systemKey',
  'isDefault',
  'isActive',
  'version',
] as const;

/** /attendance-import — ملفات الاستيراد، رفع البصمات (معاينة ثم تنفيذ)، الدفعات، والمحجوز. */
export const createAttendanceImportRouter = (db: Db, authenticate: RequestHandler): Router => {
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
  const userId = (req: Request) => (req.auth as NonNullable<Request['auth']>).userId;

  // ───── ملفات الاستيراد ─────
  const updateSchema = importProfileInput.and(z.object({ version: z.number().int().min(1) }));

  /** ملف افتراضي واحد فقط: يُنزل السابق قبل الكتابة (فهرس فريد جزئي). */
  const clearOtherDefaults = async (ctx: Ctx, keepId: string | null) => {
    let q = ctx.trx
      .updateTable('importProfiles')
      .set({ isDefault: false })
      .where('companyId', '=', ctx.companyId)
      .where('isDefault', '=', true);
    if (keepId) q = q.where('id', '<>', keepId);
    await q.execute();
  };

  router.get(
    '/profiles',
    requirePermission('attendance.import_profile.read'),
    wrap(async (req, res) => {
      const data = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('importProfiles')
          .select([...profileColumns])
          .where('companyId', '=', ctx.companyId)
          .orderBy('code')
          .execute(),
      );
      res.json({ data });
    }),
  );

  router.post(
    '/profiles',
    requirePermission('attendance.import_profile.create'),
    wrap(async (req, res) => {
      const b = importProfileInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        if (b.isDefault) await clearOtherDefaults(ctx, null);
        try {
          const row = await ctx.trx
            .insertInto('importProfiles')
            .values({
              companyId: ctx.companyId,
              ...b,
              nameEn: b.nameEn ?? null,
              columns: JSON.stringify(b.columns),
            })
            .returning([...profileColumns])
            .executeTakeFirstOrThrow();
          return row;
        } catch (err) {
          if ((err as { code?: string }).code === '23505')
            throw new AppError('DUPLICATE', 409, 'رمز ملف الاستيراد مستخدم');
          throw err;
        }
      });
      res.status(201).json({ data });
    }),
  );

  router.patch(
    '/profiles/:id',
    requirePermission('attendance.import_profile.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { version, ...b } = updateSchema.parse(req.body);
      const data = await run(req, async (ctx) => {
        if (b.isDefault) await clearOtherDefaults(ctx, id);
        try {
          const r = await ctx.trx
            .updateTable('importProfiles')
            .set({
              ...b,
              nameEn: b.nameEn ?? null,
              columns: JSON.stringify(b.columns),
              version: sql`version + 1`,
            })
            .where('id', '=', id)
            .where('version', '=', version)
            .executeTakeFirst();
          if (r.numUpdatedRows === 0n) {
            const exists = await ctx.trx
              .selectFrom('importProfiles')
              .select('id')
              .where('id', '=', id)
              .executeTakeFirst();
            if (!exists) throw new AppError('NOT_FOUND', 404, 'ملف الاستيراد غير موجود');
            throw new AppError(
              'VERSION_CONFLICT',
              409,
              'تم تعديل السجل من مستخدم آخر، أعد التحميل',
            );
          }
        } catch (err) {
          if ((err as { code?: string }).code === '23505')
            throw new AppError('DUPLICATE', 409, 'رمز ملف الاستيراد مستخدم');
          throw err;
        }
        return ctx.trx
          .selectFrom('importProfiles')
          .select([...profileColumns])
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
      });
      res.json({ data });
    }),
  );

  router.delete(
    '/profiles/:id',
    requirePermission('attendance.import_profile.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const r = await ctx.trx
          .deleteFrom('importProfiles')
          .where('id', '=', id)
          .executeTakeFirst();
        if (r.numDeletedRows === 0n)
          throw new AppError('NOT_FOUND', 404, 'ملف الاستيراد غير موجود');
      });
      res.status(204).end();
    }),
  );

  // ───── الرفع: ?dryRun=true للمعاينة ─────
  router.post(
    '/',
    requirePermission('attendance.import.create'),
    express.raw({ type: () => true, limit: IMPORT_MAX_BYTES }),
    wrap(async (req, res) => {
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0)
        throw new AppError('INVALID_FILE', 400, 'لم يُرفق ملف');
      const q = z
        .object({
          profileId: uuid.optional(),
          dryRun: z.enum(['true', 'false']).default('false'),
          fileName: z.string().max(200).optional(),
        })
        .parse(req.query);
      const data = await run(req, async (ctx) => {
        const profile = await loadProfile(ctx, q.profileId);
        const analysis = await analyzeFile(ctx, body, profile);
        const tz = await companyTimezone(ctx);
        const report = reportOf(analysis, tz);
        if (q.dryRun === 'true') return { ...report, applied: false as const };
        const r = await applyImport(ctx, analysis, profile, q.fileName ?? null, userId(req));
        return { ...report, applied: true as const, batchId: r.batchId, inserted: r.inserted };
      });
      res.status(q.dryRun === 'true' ? 200 : 201).json({ data });
    }),
  );

  // ───── الدفعات ─────
  router.get(
    '/batches',
    requirePermission('attendance.import.read'),
    wrap(async (req, res) => {
      const data = await run(req, (ctx) =>
        sql`select b.id, b.file_name, b.status, b.total_rows, b.inserted, b.duplicates, b.held,
                   b.errors, b.employees, b.date_from::text as date_from, b.date_to::text as date_to,
                   b.created_at, p.code as profile_code,
                   (select count(*)::int from import_held_rows h
                     where h.batch_id = b.id and h.status = 'held') as held_open
              from import_batches b left join import_profiles p on p.id = b.profile_id
             where b.company_id = ${ctx.companyId}
             order by b.created_at desc limit 100`
          .execute(ctx.trx)
          .then((r) => r.rows),
      );
      res.json({ data });
    }),
  );

  router.post(
    '/batches/:id/revert',
    requirePermission('attendance.import.manage'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const data = await run(req, (ctx) => revertBatch(ctx, userId(req), id));
      res.json({ data });
    }),
  );

  // ───── المحجوز ─────
  router.get(
    '/held/summary',
    requirePermission('attendance.import.read'),
    wrap(async (req, res) => {
      const data = await run(req, (ctx) =>
        sql`select device_code, reason, count(*)::int as rows,
                   min(punched_at) as first_at, max(punched_at) as last_at,
                   array_agg(distinct device_branch) filter (where device_branch is not null) as branches
              from import_held_rows
             where company_id = ${ctx.companyId} and status = 'held'
             group by device_code, reason
             order by count(*) desc, device_code limit 500`
          .execute(ctx.trx)
          .then((r) => r.rows),
      );
      res.json({ data });
    }),
  );

  router.post(
    '/held/resolve',
    requirePermission('attendance.import.manage'),
    wrap(async (req, res) => {
      const b = importHeldResolveInput.parse(req.body);
      const data = await run(req, (ctx) => resolveHeld(ctx, userId(req), b));
      res.json({ data });
    }),
  );

  router.post(
    '/held/discard',
    requirePermission('attendance.import.manage'),
    wrap(async (req, res) => {
      const b = importHeldDiscardInput.parse(req.body);
      const data = await run(req, (ctx) => discardHeld(ctx, userId(req), b.deviceCode));
      res.json({ data });
    }),
  );

  return router;
};
