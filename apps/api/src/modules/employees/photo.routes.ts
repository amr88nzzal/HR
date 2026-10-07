import express, { Router, type RequestHandler } from 'express';
import sharp from 'sharp';
import { MAX_FILE_BYTES } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { sql } from 'kysely';
import { AppError } from '../../shared/errors.js';
import {
  deleteStoredBytes,
  readStoredFile,
  saveStoredFile,
  validateUpload,
  type FileDeps,
} from '../../shared/stored-files.js';
import { requirePermission } from '../identity/index.js';
import { assertEmployeeVisible } from './access.js';
import { idOf, makeRun } from './children.routes.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const READ = 'employees.employee.read';
const WRITE = 'employees.employee.update';

/** /employees/:employeeId/photo — صورة الموظف (تُعاد ترميزها WebP وتُزال بياناتها الوصفية، مع مصغّرة 256px) */
export const createPhotoRouter = (db: Db, authenticate: RequestHandler, deps: FileDeps): Router => {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  const run = makeRun(db);

  router.get('/', requirePermission(READ), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const size = req.query['size'] === 'full' ? 'full' : 'thumb';
      const file = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, READ);
        const emp = await ctx.trx
          .selectFrom('employees')
          .select('photoFileId')
          .where('id', '=', employeeId)
          .executeTakeFirstOrThrow();
        if (!emp.photoFileId) throw new AppError('NOT_FOUND', 404, 'لا توجد صورة للموظف');
        const q = ctx.trx.selectFrom('storedFiles').selectAll();
        const row = await (
          size === 'full'
            ? q.where('id', '=', emp.photoFileId)
            : q.where('parentId', '=', emp.photoFileId).where('variant', '=', 'thumb')
        ).executeTakeFirst();
        if (!row) throw new AppError('NOT_FOUND', 404, 'لا توجد صورة للموظف');
        return row;
      });
      const bytes = await readStoredFile(deps, file);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('ETag', `"${file.sha256}"`);
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/',
    requirePermission(WRITE),
    express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
    async (req, res, next) => {
      try {
        const employeeId = idOf(req.params['employeeId']);
        const body = req.body as unknown;
        const input = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
        validateUpload(input, IMAGES);
        let full: Buffer;
        let thumb: Buffer;
        try {
          const base = () => sharp(input, { limitInputPixels: 50_000_000 }).rotate();
          full = await base()
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
          thumb = await base().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
        } catch {
          throw new AppError('INVALID_IMAGE', 400, 'تعذّرت معالجة الصورة');
        }
        const stale: string[] = [];
        const out = await run(req, async (ctx, auth) => {
          await assertEmployeeVisible(ctx, auth, employeeId, WRITE);
          const emp = await ctx.trx
            .selectFrom('employees')
            .select('photoFileId')
            .where('id', '=', employeeId)
            .executeTakeFirstOrThrow();
          const main = await saveStoredFile(ctx, deps, {
            buffer: full,
            mime: 'image/webp',
            originalName: 'photo.webp',
            purpose: 'employee_photo',
            encrypt: false,
          });
          await saveStoredFile(ctx, deps, {
            buffer: thumb,
            mime: 'image/webp',
            originalName: 'photo-thumb.webp',
            purpose: 'employee_photo',
            encrypt: false,
            parentId: main.id,
            variant: 'thumb',
          });
          await ctx.trx
            .updateTable('employees')
            .set({ photoFileId: main.id, version: sql<number>`version + 1` })
            .where('id', '=', employeeId)
            .execute();
          if (emp.photoFileId) await dropFiles(ctx.trx, emp.photoFileId, stale);
          return { photoFileId: main.id };
        });
        await deleteStoredBytes(deps, stale);
        res.json({ data: out });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/', requirePermission(WRITE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const stale: string[] = [];
      await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, WRITE);
        const emp = await ctx.trx
          .selectFrom('employees')
          .select('photoFileId')
          .where('id', '=', employeeId)
          .executeTakeFirstOrThrow();
        if (!emp.photoFileId) return;
        await ctx.trx
          .updateTable('employees')
          .set({ photoFileId: null, version: sql<number>`version + 1` })
          .where('id', '=', employeeId)
          .execute();
        await dropFiles(ctx.trx, emp.photoFileId, stale);
      });
      await deleteStoredBytes(deps, stale);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

type Trx = Parameters<Parameters<ReturnType<typeof makeRun>>[1]>[0]['trx'];

/** يحذف صف الملف الأصلي ومشتقاته (cascade) ويجمع مفاتيح بايتاته للحذف بعد نجاح المعاملة. */
const dropFiles = async (trx: Trx, fileId: string, keys: string[]): Promise<void> => {
  const rows = await trx
    .selectFrom('storedFiles')
    .select('storageKey')
    .where((eb) => eb.or([eb('id', '=', fileId), eb('parentId', '=', fileId)]))
    .execute();
  keys.push(...rows.map((r) => r.storageKey));
  await trx.deleteFrom('storedFiles').where('id', '=', fileId).execute();
};
