import express, { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  documentInput,
  documentListQuery,
  documentUpdateInput,
  MAX_FILE_BYTES,
  reminderListQuery,
  reminderUpdateInput,
  revealFieldInput,
  supersedeInput,
  type ApiEnvelope,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import {
  deleteStoredBytes,
  readStoredFile,
  saveStoredFile,
  validateUpload,
  type FileDeps,
} from '../../shared/stored-files.js';
import { requirePermission, type AuthContext } from '../identity/index.js';
import { decryptValue, maskValues, prepareValues, type FieldDef } from './field-values.js';
import { documentScope, resolveOwner } from './scope.js';

type Row = Record<string, unknown>;
const notFound = (what = 'الوثيقة') => new AppError('NOT_FOUND', 404, `${what} غير موجودة`);
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};
const MAX_FILES_PER_DOCUMENT = 50;

const READ = 'archive.document.read';
const CREATE = 'archive.document.create';
const UPDATE = 'archive.document.update';
const DELETE = 'archive.document.delete';
const REVEAL = 'archive.document.reveal';

const loadFields = async (ctx: Ctx, typeId: string): Promise<FieldDef[]> =>
  (await ctx.trx
    .selectFrom('documentTypeFields')
    .select([
      'key',
      'labelAr',
      'dataType',
      'isRequired',
      'isSensitive',
      'isUnique',
      'options',
      'isActive',
    ])
    .where('documentTypeId', '=', typeId)
    .where('companyId', '=', ctx.companyId)
    .execute()) as FieldDef[];

const audit = (ctx: Ctx, entityId: string, action: string, changes: unknown, ip?: string) =>
  ctx.trx
    .insertInto('auditLogs')
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      entityType: 'documents',
      entityId,
      action,
      changes: JSON.stringify(changes),
      requestId: ctx.requestId,
      ip: ip ?? null,
    })
    .execute();

/** يزامن تذكيرات الوثيقة مع قيم حقول «تاريخ تذكيري» (تاريخ جديد يعيد التذكير إلى قيد الانتظار). */
const syncReminders = async (ctx: Ctx, documentId: string, wanted: Map<string, string>) => {
  const existing = await ctx.trx
    .selectFrom('documentReminders')
    .select(['id', 'fieldKey'])
    .where('documentId', '=', documentId)
    .execute();
  const drop = existing.filter((e) => !wanted.has(e.fieldKey)).map((e) => e.id);
  if (drop.length) await ctx.trx.deleteFrom('documentReminders').where('id', 'in', drop).execute();
  for (const [fieldKey, dueDate] of wanted) {
    await ctx.trx
      .insertInto('documentReminders')
      .values({ companyId: ctx.companyId, documentId, fieldKey, dueDate })
      .onConflict((oc) =>
        oc.columns(['documentId', 'fieldKey']).doUpdateSet({
          dueDate,
          status: sql<'pending' | 'done' | 'dismissed'>`case
            when document_reminders.due_date <> excluded.due_date then 'pending'
            else document_reminders.status end`,
          version: sql<number>`document_reminders.version + 1`,
        }),
      )
      .execute();
  }
};

const present = (doc: Row): Row => {
  const out = { ...doc };
  delete out['companyId'];
  out['values'] = maskValues(doc['values'] as Row);
  return out;
};

export const createDocumentsRouter = (
  db: Db,
  authenticate: RequestHandler,
  deps: FileDeps,
  crypto: FieldCrypto | undefined,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

  const loadDoc = async (ctx: Ctx, auth: AuthContext, id: string, code: string) => {
    const row = await ctx.trx
      .selectFrom('documents')
      .selectAll()
      .where('id', '=', id)
      .where('companyId', '=', ctx.companyId)
      .where(documentScope(auth, code))
      .executeTakeFirst();
    if (!row) throw notFound();
    return row;
  };

  // ---- القائمة ----
  router.get('/', requirePermission(READ), async (req, res, next) => {
    try {
      const q = documentListQuery.parse(req.query);
      const out = await run(req, async (ctx, auth) => {
        const build = () => {
          let b = ctx.trx
            .selectFrom('documents')
            .innerJoin('documentTypes as t', 't.id', 'documents.documentTypeId')
            .where('documents.companyId', '=', ctx.companyId)
            .where('documents.status', '=', q.status)
            .where(documentScope(auth, READ));
          if (q.documentTypeId) b = b.where('documents.documentTypeId', '=', q.documentTypeId);
          if (q.ownerType) b = b.where('documents.ownerType', '=', q.ownerType);
          if (q.ownerId) b = b.where('documents.ownerId', '=', q.ownerId);
          return b;
        };
        const rows = await build()
          .selectAll('documents')
          .select(['t.nameAr as typeNameAr', 't.nameEn as typeNameEn'])
          .select(
            sql<number>`(select count(*)::int from document_files f where f.document_id = documents.id)`.as(
              'fileCount',
            ),
          )
          .orderBy('documents.createdAt', 'desc')
          .orderBy('documents.id')
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
      const body: ApiEnvelope<Row[]> = {
        data: out.rows.map(present),
        meta: { page: q.page, pageSize: q.pageSize, total: out.total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // ---- إنشاء ----
  router.post('/', requirePermission(CREATE), async (req, res, next) => {
    try {
      const input = documentInput.parse(req.body);
      const row = await run(req, async (ctx, auth) => {
        const type = await ctx.trx
          .selectFrom('documentTypes')
          .selectAll()
          .where('id', '=', input.documentTypeId)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!type) throw new AppError('INVALID_REFERENCE', 400, 'نوع الوثيقة غير موجود');
        if (!type.isActive) throw new AppError('TYPE_INACTIVE', 400, 'نوع الوثيقة معطّل');
        const ownerId = await resolveOwner(ctx, auth, type.ownerType, input.ownerId, CREATE);
        const defs = await loadFields(ctx, type.id);
        const prepared = await prepareValues(ctx, crypto, type.id, defs, input.values, {}, null);
        const doc = await ctx.trx
          .insertInto('documents')
          .values({
            companyId: ctx.companyId,
            documentTypeId: type.id,
            ownerType: type.ownerType,
            ownerId,
            values: JSON.stringify(prepared.values),
            createdBy: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await syncReminders(ctx, doc.id, prepared.reminders);
        return doc;
      });
      res.status(201).json({ data: present(row) });
    } catch (err) {
      next(err);
    }
  });

  // ---- قراءة وثيقة (مع ملفاتها وتذكيراتها) ----
  router.get('/:id', requirePermission(READ), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const out = await run(req, async (ctx, auth) => {
        const doc = await loadDoc(ctx, auth, id, READ);
        const files = await ctx.trx
          .selectFrom('documentFiles as df')
          .innerJoin('storedFiles as f', 'f.id', 'df.fileId')
          .select([
            'df.id',
            'df.fileId',
            'df.fieldKey',
            'df.pageNo',
            'f.originalName',
            'f.mimeType',
            'f.sizeBytes',
            'df.createdAt',
          ])
          .where('df.documentId', '=', id)
          .orderBy('df.fieldKey')
          .orderBy('df.pageNo')
          .orderBy('df.createdAt')
          .execute();
        const reminders = await ctx.trx
          .selectFrom('documentReminders')
          .select(['id', 'fieldKey', 'dueDate', 'status', 'version'])
          .where('documentId', '=', id)
          .execute();
        return { ...present(doc), files, reminders };
      });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  // ---- تعديل القيم ----
  router.patch('/:id', requirePermission(UPDATE), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const input = documentUpdateInput.parse(req.body);
      const row = await run(req, async (ctx, auth) => {
        const doc = await loadDoc(ctx, auth, id, UPDATE);
        if (doc.status !== 'active')
          throw new AppError('DOCUMENT_SUPERSEDED', 409, 'الوثيقة مستبدلة ولا تُعدَّل');
        const defs = await loadFields(ctx, doc.documentTypeId);
        const prepared = await prepareValues(
          ctx,
          crypto,
          doc.documentTypeId,
          defs,
          input.values,
          doc.values,
          doc.id,
        );
        const updated = await ctx.trx
          .updateTable('documents')
          .set({ values: JSON.stringify(prepared.values), version: sql<number>`version + 1` })
          .where('id', '=', id)
          .where('version', '=', input.version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        await syncReminders(ctx, id, prepared.reminders);
        return updated;
      });
      res.json({ data: present(row) });
    } catch (err) {
      next(err);
    }
  });

  // ---- استبدال: نسخة جديدة والقديمة تبقى للتاريخ ----
  router.post('/:id/supersede', requirePermission(UPDATE), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const input = supersedeInput.parse(req.body);
      const row = await run(req, async (ctx, auth) => {
        const old = await loadDoc(ctx, auth, id, UPDATE);
        if (old.status !== 'active')
          throw new AppError('DOCUMENT_SUPERSEDED', 409, 'الوثيقة مستبدلة مسبقاً');
        const defs = await loadFields(ctx, old.documentTypeId);
        // تُغلق القديمة أولاً حتى لا يتعارض فحص الفريد معها
        await ctx.trx
          .updateTable('documents')
          .set({
            status: 'superseded',
            supersededAt: sql<string>`now()`,
            version: sql<number>`version + 1`,
          })
          .where('id', '=', id)
          .execute();
        const prepared = await prepareValues(
          ctx,
          crypto,
          old.documentTypeId,
          defs,
          input.values,
          old.values,
          null,
        );
        const created = await ctx.trx
          .insertInto('documents')
          .values({
            companyId: ctx.companyId,
            documentTypeId: old.documentTypeId,
            ownerType: old.ownerType,
            ownerId: old.ownerId,
            values: JSON.stringify(prepared.values),
            versionNo: old.versionNo + 1,
            createdBy: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await ctx.trx
          .updateTable('documents')
          .set({ supersededBy: created.id })
          .where('id', '=', id)
          .execute();
        await ctx.trx.deleteFrom('documentReminders').where('documentId', '=', id).execute();
        await syncReminders(ctx, created.id, prepared.reminders);
        await audit(ctx, id, 'supersede', { newDocumentId: created.id });
        return created;
      });
      res.status(201).json({ data: present(row) });
    } catch (err) {
      next(err);
    }
  });

  // ---- حذف (بما فيه ملفاته) ----
  router.delete('/:id', requirePermission(DELETE), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const keys: string[] = [];
      await run(req, async (ctx, auth) => {
        await loadDoc(ctx, auth, id, DELETE);
        const files = await ctx.trx
          .selectFrom('documentFiles as df')
          .innerJoin('storedFiles as f', 'f.id', 'df.fileId')
          .select(['f.id', 'f.storageKey'])
          .where('df.documentId', '=', id)
          .execute();
        // الوثيقة المستبدلة تشير إليها نسخة لاحقة: نفكّ الإشارة قبل الحذف
        await ctx.trx
          .updateTable('documents')
          .set({ supersededBy: null })
          .where('supersededBy', '=', id)
          .execute();
        await ctx.trx.deleteFrom('documents').where('id', '=', id).execute();
        if (files.length)
          await ctx.trx
            .deleteFrom('storedFiles')
            .where(
              'id',
              'in',
              files.map((f) => f.id),
            )
            .execute();
        keys.push(...files.map((f) => f.storageKey));
        await audit(ctx, id, 'delete', { files: files.length });
      });
      await deleteStoredBytes(deps, keys);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ---- كشف قيمة حساسة ----
  router.post('/:id/reveal', requirePermission(REVEAL), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const { key } = revealFieldInput.parse(req.body);
      if (!crypto)
        throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
      const value = await run(req, async (ctx, auth) => {
        const doc = await loadDoc(ctx, auth, id, REVEAL);
        const plain = decryptValue(crypto, doc.documentTypeId, doc.values, key);
        await audit(ctx, id, 'reveal', { field: key }, req.ip);
        return plain;
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { key, value } });
    } catch (err) {
      next(err);
    }
  });

  // ---- الملفات ----
  router.post(
    '/:id/files',
    requirePermission(UPDATE),
    express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
    async (req, res, next) => {
      try {
        const id = idOf(req.params['id']);
        const q = z
          .object({
            fieldKey: z.string().max(40).optional(),
            pageNo: z.coerce.number().int().min(1).max(500).default(1),
            name: z.string().max(300).optional(),
          })
          .parse(req.query);
        const body = req.body as unknown;
        const buffer = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
        const mime = validateUpload(buffer);
        const headerName = req.get('x-file-name');
        let name = q.name ?? 'file';
        if (!q.name && headerName) {
          try {
            name = decodeURIComponent(headerName);
          } catch {
            name = 'file';
          }
        }
        const row = await run(req, async (ctx, auth) => {
          const doc = await loadDoc(ctx, auth, id, UPDATE);
          if (doc.status !== 'active')
            throw new AppError('DOCUMENT_SUPERSEDED', 409, 'الوثيقة مستبدلة ولا تُعدَّل');
          const defs = await loadFields(ctx, doc.documentTypeId);
          if (q.fieldKey) {
            const def = defs.find((d) => d.key === q.fieldKey);
            if (!def || def.dataType !== 'file' || !def.isActive)
              throw new AppError('DOCUMENT_FIELD_INVALID', 400, 'حقل الملف غير معرّف أو معطّل');
          }
          const count = await ctx.trx
            .selectFrom('documentFiles')
            .select(sql<string>`count(*)`.as('n'))
            .where('documentId', '=', id)
            .executeTakeFirstOrThrow();
          if (Number(count.n) >= MAX_FILES_PER_DOCUMENT)
            throw new AppError('TOO_MANY_FILES', 409, 'بلغت الوثيقة الحد الأقصى للملفات');
          // وثائق الأنواع ذات الحقول الحساسة تُحفظ ملفاتها مشفّرة
          const encrypt = defs.some((d) => d.isSensitive);
          const file = await saveStoredFile(ctx, deps, {
            buffer,
            mime,
            originalName: name,
            purpose: 'document',
            encrypt,
          });
          const link = await ctx.trx
            .insertInto('documentFiles')
            .values({
              companyId: ctx.companyId,
              documentId: id,
              fileId: file.id,
              fieldKey: q.fieldKey ?? null,
              pageNo: q.pageNo,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          return {
            id: link.id,
            fileId: file.id,
            fieldKey: link.fieldKey,
            pageNo: link.pageNo,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            isEncrypted: file.isEncrypted,
          };
        });
        res.status(201).json({ data: row });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:id/files/:fileLinkId/content', requirePermission(READ), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const linkId = idOf(req.params['fileLinkId']);
      const file = await run(req, async (ctx, auth) => {
        await loadDoc(ctx, auth, id, READ);
        const f = await ctx.trx
          .selectFrom('documentFiles as df')
          .innerJoin('storedFiles as f', 'f.id', 'df.fileId')
          .selectAll('f')
          .where('df.id', '=', linkId)
          .where('df.documentId', '=', id)
          .executeTakeFirst();
        if (!f) throw notFound('الملف');
        if (f.isEncrypted) await audit(ctx, id, 'download', { fileId: f.id }, req.ip);
        return f;
      });
      const bytes = await readStoredFile(deps, file);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id/files/:fileLinkId', requirePermission(UPDATE), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const linkId = idOf(req.params['fileLinkId']);
      const keys: string[] = [];
      await run(req, async (ctx, auth) => {
        const doc = await loadDoc(ctx, auth, id, UPDATE);
        if (doc.status !== 'active')
          throw new AppError('DOCUMENT_SUPERSEDED', 409, 'الوثيقة مستبدلة ولا تُعدَّل');
        const link = await ctx.trx
          .selectFrom('documentFiles as df')
          .innerJoin('storedFiles as f', 'f.id', 'df.fileId')
          .select(['df.id', 'f.id as fileId', 'f.storageKey'])
          .where('df.id', '=', linkId)
          .where('df.documentId', '=', id)
          .executeTakeFirst();
        if (!link) throw notFound('الملف');
        await ctx.trx.deleteFrom('documentFiles').where('id', '=', linkId).execute();
        await ctx.trx.deleteFrom('storedFiles').where('id', '=', link.fileId).execute();
        keys.push(link.storageKey);
      });
      await deleteStoredBytes(deps, keys);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/** /document-reminders — تذكيرات التواريخ (للمهمة اليومية والواجهة) */
export const createRemindersRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

  router.get('/', requirePermission(READ), async (req, res, next) => {
    try {
      const q = reminderListQuery.parse(req.query);
      const out = await run(req, async (ctx, auth) => {
        const build = () => {
          let b = ctx.trx
            .selectFrom('documentReminders as r')
            .innerJoin('documents', 'documents.id', 'r.documentId')
            .innerJoin('documentTypes as t', 't.id', 'documents.documentTypeId')
            .where('r.companyId', '=', ctx.companyId)
            .where('r.status', '=', q.status)
            .where('documents.status', '=', 'active')
            .where(documentScope(auth, READ));
          if (q.dueBefore) b = b.where('r.dueDate', '<=', q.dueBefore);
          return b;
        };
        const rows = await build()
          .select([
            'r.id',
            'r.documentId',
            'r.fieldKey',
            'r.dueDate',
            'r.status',
            'r.version',
            'documents.ownerType',
            'documents.ownerId',
            'documents.documentTypeId',
            't.nameAr as typeNameAr',
            't.nameEn as typeNameEn',
          ])
          .orderBy('r.dueDate')
          .orderBy('r.id')
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
      res.json({
        data: out.rows,
        meta: { page: q.page, pageSize: q.pageSize, total: out.total },
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(UPDATE), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const { version, status } = reminderUpdateInput.parse(req.body);
      if (!status) throw new AppError('VALIDATION_ERROR', 400, 'الحالة مطلوبة');
      const row = await run(req, async (ctx, auth) => {
        const visible = await ctx.trx
          .selectFrom('documentReminders as r')
          .innerJoin('documents', 'documents.id', 'r.documentId')
          .select('r.id')
          .where('r.id', '=', id)
          .where(documentScope(auth, UPDATE))
          .executeTakeFirst();
        if (!visible) throw notFound('التذكير');
        const updated = await ctx.trx
          .updateTable('documentReminders')
          .set({ status, version: sql<number>`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        return updated;
      });
      const rest: Row = { ...row };
      delete rest['companyId'];
      res.json({ data: rest });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
