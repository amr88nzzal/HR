import { Router, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  documentFieldInput,
  documentFieldUpdateInput,
  documentTypeInput,
  documentTypeUpdateInput,
  ownerTypeEnum,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission, type AuthContext } from '../identity/index.js';

type Row = Record<string, unknown>;
const notFound = (what = 'السجل') => new AppError('NOT_FOUND', 404, `${what} غير موجود`);
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};
const strip = (row: Row): Row => {
  const rest = { ...row };
  delete rest['companyId'];
  return rest;
};
const definedOnly = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const makeRun =
  (db: Db) =>
  <T>(
    req: import('express').Request,
    fn: (ctx: Ctx, auth: AuthContext) => Promise<T>,
  ): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

const loadType = async (ctx: Ctx, id: string) => {
  const row = await ctx.trx
    .selectFrom('documentTypes')
    .selectAll()
    .where('id', '=', id)
    .where('companyId', '=', ctx.companyId)
    .executeTakeFirst();
  if (!row) throw notFound('نوع الوثيقة');
  return row;
};

/** /document-types (+ /:typeId/fields) — تعريف أنواع الوثائق وحقولها */
export const createDocumentTypesRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);
  const P = 'archive.document_type';

  router.get('/', requirePermission(`${P}.read`), async (req, res, next) => {
    try {
      const q = z
        .object({
          ownerType: ownerTypeEnum.optional(),
          isActive: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        })
        .parse(req.query);
      const rows = await run(req, (ctx) => {
        let b = ctx.trx
          .selectFrom('documentTypes')
          .selectAll()
          .where('companyId', '=', ctx.companyId);
        if (q.ownerType) b = b.where('ownerType', '=', q.ownerType);
        if (q.isActive !== undefined) b = b.where('isActive', '=', q.isActive);
        return b.orderBy('nameAr').execute();
      });
      res.json({ data: rows.map(strip), meta: { total: rows.length } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission(`${P}.read`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const out = await run(req, async (ctx) => {
        const type = await loadType(ctx, id);
        const fields = await ctx.trx
          .selectFrom('documentTypeFields')
          .selectAll()
          .where('documentTypeId', '=', id)
          .orderBy('sortOrder')
          .orderBy('key')
          .execute();
        return { ...strip(type), fields: fields.map(strip) };
      });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(`${P}.create`), async (req, res, next) => {
    try {
      const input = documentTypeInput.parse(req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .insertInto('documentTypes')
          .values({
            ...input,
            systemKey: input.systemKey ?? null,
            nameEn: input.nameEn ?? null,
            category: input.category ?? null,
            companyId: ctx.companyId,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
      res.status(201).json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(`${P}.update`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const { version, ...changes } = documentTypeUpdateInput.parse(req.body);
      const defined = definedOnly(changes);
      if (Object.keys(defined).length === 0)
        throw new AppError('VALIDATION_ERROR', 400, 'لا توجد تغييرات');
      const row = await run(req, async (ctx) => {
        await loadType(ctx, id);
        const updated = await ctx.trx
          .updateTable('documentTypes')
          .set({ ...defined, version: sql<number>`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        return updated;
      });
      res.json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(`${P}.delete`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const type = await loadType(ctx, id);
        if (type.systemKey) throw new AppError('SYSTEM_RECORD', 409, 'لا يمكن حذف نوع نظامي');
        try {
          await ctx.trx.deleteFrom('documentTypes').where('id', '=', id).execute();
        } catch (err) {
          if ((err as { code?: string }).code === '23503')
            throw new AppError('IN_USE', 409, 'للنوع وثائق مسجلة، عطّله بدلاً من حذفه');
          throw err;
        }
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ---- الحقول ----
  router.post('/:typeId/fields', requirePermission(`${P}.update`), async (req, res, next) => {
    try {
      const typeId = idOf(req.params['typeId']);
      const input = documentFieldInput.parse(req.body);
      const row = await run(req, async (ctx) => {
        await loadType(ctx, typeId);
        return ctx.trx
          .insertInto('documentTypeFields')
          .values({
            ...input,
            labelEn: input.labelEn ?? null,
            options: JSON.stringify(input.options),
            documentTypeId: typeId,
            companyId: ctx.companyId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      res.status(201).json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:typeId/fields/:id', requirePermission(`${P}.update`), async (req, res, next) => {
    try {
      const typeId = idOf(req.params['typeId']);
      const id = idOf(req.params['id']);
      const { version, ...changes } = documentFieldUpdateInput.parse(req.body);
      const defined = definedOnly(changes);
      if (Object.keys(defined).length === 0)
        throw new AppError('VALIDATION_ERROR', 400, 'لا توجد تغييرات');
      const row = await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('documentTypeFields')
          .selectAll()
          .where('id', '=', id)
          .where('documentTypeId', '=', typeId)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!cur) throw notFound('الحقل');
        const opts = changes.options;
        if (opts !== undefined) {
          if (cur.dataType === 'select' && !(Array.isArray(opts) && opts.length > 0))
            throw new AppError('VALIDATION_ERROR', 400, 'القائمة تحتاج خياراً واحداً');
          if (cur.dataType !== 'select' && Array.isArray(opts) && opts.length > 0)
            throw new AppError('VALIDATION_ERROR', 400, 'الخيارات خاصة بحقول القائمة');
        }
        if (changes.isUnique && cur.isSensitive)
          throw new AppError('VALIDATION_ERROR', 400, 'الحقل الحساس لا يكون فريداً');
        const updated = await ctx.trx
          .updateTable('documentTypeFields')
          .set({
            ...defined,
            ...(opts !== undefined ? { options: JSON.stringify(opts) } : {}),
            version: sql<number>`version + 1`,
          })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        return updated;
      });
      res.json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:typeId/fields/:id', requirePermission(`${P}.update`), async (req, res, next) => {
    try {
      const typeId = idOf(req.params['typeId']);
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('documentTypeFields')
          .select(['id', 'key', 'dataType'])
          .where('id', '=', id)
          .where('documentTypeId', '=', typeId)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!cur) throw notFound('الحقل');
        const used =
          cur.dataType === 'file'
            ? await sql<{ n: string }>`
                  select count(*)::text as n from document_files df
                    join documents d on d.id = df.document_id
                   where d.document_type_id = ${typeId} and df.field_key = ${cur.key}`.execute(
                ctx.trx,
              )
            : await sql<{ n: string }>`
                  select count(*)::text as n from documents
                   where document_type_id = ${typeId} and "values" ? ${cur.key}`.execute(ctx.trx);
        if (Number(used.rows[0]?.n ?? 0) > 0)
          throw new AppError('IN_USE', 409, 'للحقل بيانات مخزّنة، عطّله بدلاً من حذفه');
        await ctx.trx.deleteFrom('documentTypeFields').where('id', '=', id).execute();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
