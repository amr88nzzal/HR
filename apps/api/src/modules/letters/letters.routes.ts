import { createHash } from 'node:crypto';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  LETTER_VARIABLES,
  checkTemplateHtml,
  issueDocumentInput,
  issuedListQuery,
  letterPreviewInput,
  letterTemplateInput,
  letterTemplateUpdate,
  letterVersionInput,
  renderLetterBody,
  revokeDocumentInput,
  wrapLetterHtml,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { DOCX_MIME, fillDocx, inspectDocx, sha256 } from './docx.js';
import { readStoredFile, saveStoredFile, type FileDeps } from '../../shared/stored-files.js';
import { requirePermission } from '../identity/index.js';
import { maskName, newVerifyToken, nextDocNumber, qrDataUrl, verifyUrlOf } from './numbering.js';
import type { Renderer } from './render.js';
import { loadLetterValues } from './values.js';

const idParam = z.object({ id: z.string().uuid() });
const verParam = z.object({ id: z.string().uuid(), versionId: z.string().uuid() });
const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const assertHtml = (html: string) => {
  const problems = checkTemplateHtml(html);
  if (problems.length) throw new AppError('INVALID_TEMPLATE', 400, 'القالب غير صالح', { problems });
};

const makeRun =
  (db: Db) =>
  <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };

const loadTemplate = async (ctx: Ctx, id: string) => {
  const t = await ctx.trx
    .selectFrom('letterTemplates')
    .selectAll()
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND', 404, 'القالب غير موجود');
  return t;
};

const DOCX_MAX_BYTES = 5 * 1024 * 1024;

const readDocxBody = (req: Request): Buffer => {
  const body = req.body as unknown;
  if (!Buffer.isBuffer(body) || body.length === 0)
    throw new AppError('INVALID_FILE', 400, 'لم يُرفق ملف');
  inspectDocx(body);
  return body;
};

const sendFile = (res: Response, bytes: Buffer, mime: string, name: string) => {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.send(bytes);
};

const nextVersionNo = async (ctx: Ctx, templateId: string): Promise<number> => {
  const r = await ctx.trx
    .selectFrom('letterTemplateVersions')
    .select((eb) => eb.fn.max('versionNo').as('n'))
    .where('templateId', '=', templateId)
    .executeTakeFirst();
  return Number(r?.n ?? 0) + 1;
};

const activate = async (ctx: Ctx, templateId: string, versionId: string) => {
  await ctx.trx
    .updateTable('letterTemplateVersions')
    .set({ status: 'archived' })
    .where('templateId', '=', templateId)
    .where('status', '=', 'active')
    .execute();
  await ctx.trx
    .updateTable('letterTemplateVersions')
    .set({ status: 'active', activatedAt: new Date() })
    .where('id', '=', versionId)
    .execute();
  await ctx.trx
    .updateTable('letterTemplates')
    .set({ activeVersionId: versionId })
    .where('id', '=', templateId)
    .execute();
};

/** مدير القوالب: قوالب HTML بإصدارات (مسودة ← مفعّل ← مؤرشف) وتراجع بتفعيل إصدار سابق. */
export const createLetterTemplatesRouter = (
  db: Db,
  authenticate: RequestHandler,
  files: FileDeps,
  publicUrl?: string,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get('/variables', (_req, res) => {
    res.json({ data: LETTER_VARIABLES });
  });

  router.get(
    '/',
    requirePermission('letters.template.read'),
    wrap(async (req, res) => {
      const data = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('letterTemplates as t')
          .leftJoin('letterTemplateVersions as v', 'v.id', 't.activeVersionId')
          .select([
            't.id',
            't.code',
            't.nameAr',
            't.nameEn',
            't.language',
            't.format',
            't.category',
            't.isActive',
            't.version',
            't.activeVersionId',
            'v.versionNo as activeVersionNo',
          ])
          .where('t.companyId', '=', ctx.companyId)
          .orderBy('t.code')
          .execute(),
      );
      res.json({ data });
    }),
  );

  router.post(
    '/',
    requirePermission('letters.template.create'),
    wrap(async (req, res) => {
      const body = letterTemplateInput.parse(req.body);
      assertHtml(body.bodyHtml);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        let id: string;
        try {
          id = (
            await ctx.trx
              .insertInto('letterTemplates')
              .values({
                companyId: ctx.companyId,
                code: body.code,
                nameAr: body.nameAr,
                nameEn: body.nameEn ?? null,
                language: body.language,
                category: body.category,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new AppError('DUPLICATE_CODE', 409, 'رمز القالب مستعمل');
          throw e;
        }
        const v = await ctx.trx
          .insertInto('letterTemplateVersions')
          .values({
            companyId: ctx.companyId,
            templateId: id,
            versionNo: 1,
            bodyHtml: body.bodyHtml,
            contentHash: hashOf(body.bodyHtml),
            createdBy: auth.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await activate(ctx, id, v.id);
        return loadTemplate(ctx, id);
      });
      res.status(201).json({ data });
    }),
  );

  const docxUpload = express.raw({ type: () => true, limit: DOCX_MAX_BYTES });
  const docxName = (q: unknown) =>
    z.object({ fileName: z.string().max(200).optional() }).parse(q).fileName ?? 'template.docx';

  router.post(
    '/docx',
    requirePermission('letters.template.create'),
    docxUpload,
    wrap(async (req, res) => {
      const body = letterTemplateInput.omit({ bodyHtml: true }).parse(req.query);
      const buf = readDocxBody(req);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        let id: string;
        try {
          id = (
            await ctx.trx
              .insertInto('letterTemplates')
              .values({
                companyId: ctx.companyId,
                code: body.code,
                nameAr: body.nameAr,
                nameEn: body.nameEn || null,
                language: body.language,
                category: body.category,
                format: 'docx',
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new AppError('DUPLICATE_CODE', 409, 'رمز القالب مستعمل');
          throw e;
        }
        const file = await saveStoredFile(ctx, files, {
          buffer: buf,
          mime: DOCX_MIME,
          originalName: docxName(req.query),
          purpose: 'letter_template',
          encrypt: false,
        });
        const v = await ctx.trx
          .insertInto('letterTemplateVersions')
          .values({
            companyId: ctx.companyId,
            templateId: id,
            versionNo: 1,
            docxFileId: file.id,
            contentHash: sha256(buf),
            createdBy: auth.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await activate(ctx, id, v.id);
        return loadTemplate(ctx, id);
      });
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/:id/versions/docx',
    requirePermission('letters.template.update'),
    docxUpload,
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const note = z.object({ note: z.string().trim().max(300).optional() }).parse(req.query).note;
      const buf = readDocxBody(req);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const t = await loadTemplate(ctx, id);
        if (t.format !== 'docx') throw new AppError('WRONG_FORMAT', 409, 'هذا القالب من نوع HTML');
        const file = await saveStoredFile(ctx, files, {
          buffer: buf,
          mime: DOCX_MIME,
          originalName: docxName(req.query),
          purpose: 'letter_template',
          encrypt: false,
        });
        return ctx.trx
          .insertInto('letterTemplateVersions')
          .values({
            companyId: ctx.companyId,
            templateId: id,
            versionNo: await nextVersionNo(ctx, id),
            docxFileId: file.id,
            contentHash: sha256(buf),
            note: note ?? null,
            createdBy: auth.userId,
          })
          .returning(['id', 'versionNo', 'status'])
          .executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/:id/versions/:versionId/docx',
    requirePermission('letters.template.read'),
    wrap(async (req, res) => {
      const { id, versionId } = verParam.parse(req.params);
      const file = await run(req, async (ctx) => {
        const f = await ctx.trx
          .selectFrom('letterTemplateVersions as v')
          .innerJoin('storedFiles as f', 'f.id', 'v.docxFileId')
          .selectAll('f')
          .where('v.id', '=', versionId)
          .where('v.templateId', '=', id)
          .executeTakeFirst();
        if (!f) throw new AppError('NOT_FOUND', 404, 'الملف غير موجود');
        return f;
      });
      sendFile(res, await readStoredFile(files, file), DOCX_MIME, file.originalName);
    }),
  );

  router.get(
    '/:id',
    requirePermission('letters.template.read'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const data = await run(req, async (ctx) => {
        const t = await loadTemplate(ctx, id);
        const versions = await ctx.trx
          .selectFrom('letterTemplateVersions')
          .select([
            'id',
            'versionNo',
            'bodyHtml',
            'docxFileId',
            'contentHash',
            'status',
            'note',
            'createdAt',
            'activatedAt',
          ])
          .where('templateId', '=', id)
          .orderBy('versionNo', 'desc')
          .execute();
        return { ...t, versions };
      });
      res.json({ data });
    }),
  );

  router.patch(
    '/:id',
    requirePermission('letters.template.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = letterTemplateUpdate.parse(req.body);
      const data = await run(req, async (ctx) => {
        await loadTemplate(ctx, id);
        await ctx.trx
          .updateTable('letterTemplates')
          .set({
            ...(body.nameAr !== undefined && { nameAr: body.nameAr }),
            ...(body.nameEn !== undefined && { nameEn: body.nameEn ?? null }),
            ...(body.category !== undefined && { category: body.category }),
            ...(body.isActive !== undefined && { isActive: body.isActive }),
          })
          .where('id', '=', id)
          .execute();
        return loadTemplate(ctx, id);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/:id/versions',
    requirePermission('letters.template.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = letterVersionInput.parse(req.body);
      assertHtml(body.bodyHtml);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const t = await loadTemplate(ctx, id);
        if (t.format !== 'html')
          throw new AppError('WRONG_FORMAT', 409, 'هذا القالب من نوع DOCX؛ ارفع ملف DOCX');
        return ctx.trx
          .insertInto('letterTemplateVersions')
          .values({
            companyId: ctx.companyId,
            templateId: id,
            versionNo: await nextVersionNo(ctx, id),
            bodyHtml: body.bodyHtml,
            contentHash: hashOf(body.bodyHtml),
            note: body.note ?? null,
            createdBy: auth.userId,
          })
          .returning(['id', 'versionNo', 'status'])
          .executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/:id/versions/:versionId/activate',
    requirePermission('letters.template.update'),
    wrap(async (req, res) => {
      const { id, versionId } = verParam.parse(req.params);
      const data = await run(req, async (ctx) => {
        await loadTemplate(ctx, id);
        const v = await ctx.trx
          .selectFrom('letterTemplateVersions')
          .select('id')
          .where('id', '=', versionId)
          .where('templateId', '=', id)
          .executeTakeFirst();
        if (!v) throw new AppError('NOT_FOUND', 404, 'الإصدار غير موجود');
        await activate(ctx, id, versionId);
        return loadTemplate(ctx, id);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/:id/preview',
    requirePermission('letters.template.read'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = letterPreviewInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const t = await loadTemplate(ctx, id);
        if (t.format !== 'html')
          throw new AppError('PREVIEW_UNSUPPORTED', 409, 'المعاينة لقوالب HTML فقط؛ نزّل ملف DOCX');
        let html = body.bodyHtml;
        if (html === undefined) {
          // (إصدارات HTML فقط)
          const v = await ctx.trx
            .selectFrom('letterTemplateVersions')
            .select('bodyHtml')
            .where('templateId', '=', id)
            .where('id', '=', (body.versionId ?? t.activeVersionId) as string)
            .executeTakeFirst();
          if (!v) throw new AppError('NOT_FOUND', 404, 'الإصدار غير موجود');
          html = v.bodyHtml ?? '';
        }
        assertHtml(html);
        const values = await loadLetterValues(ctx, body.employeeId, t.language);
        // معاينة: رقم وQR تجريبيان (لا يُستهلك رقم حقيقي)
        const url = verifyUrlOf(publicUrl, 'preview');
        values['document.number'] =
          `${t.code}-${(values['document.today'] ?? '').slice(0, 4)}-XXXXXX`;
        values['document.verifyUrl'] = url;
        values['document.qr'] = url ? await qrDataUrl(url) : null;
        return { html: wrapLetterHtml(renderLetterBody(html, values), t.language) };
      });
      res.json({ data });
    }),
  );

  router.delete(
    '/:id',
    requirePermission('letters.template.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        await loadTemplate(ctx, id);
        const used = await ctx.trx
          .selectFrom('issuedDocuments')
          .select('id')
          .where('templateId', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (used)
          throw new AppError('TEMPLATE_IN_USE', 409, 'صدرت وثائق بهذا القالب؛ عطّله بدل حذفه');
        await ctx.trx
          .updateTable('letterTemplates')
          .set({ activeVersionId: null })
          .where('id', '=', id)
          .execute();
        await ctx.trx.deleteFrom('letterTemplates').where('id', '=', id).execute();
      });
      res.status(204).end();
    }),
  );
  return router;
};

/** إصدار الوثائق لموظف (PDF مخزَّن بلقطة القيم وبصمة القالب) وسجلها. */
export const createIssuedDocumentsRouter = (
  db: Db,
  authenticate: RequestHandler,
  files: FileDeps,
  render: Renderer | undefined,
  publicUrl?: string,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  const select = (ctx: Ctx) =>
    ctx.trx
      .selectFrom('issuedDocuments as d')
      .innerJoin('employees as e', 'e.id', 'd.employeeId')
      .innerJoin('letterTemplates as t', 't.id', 'd.templateId')
      .innerJoin('letterTemplateVersions as v', 'v.id', 'd.templateVersionId')
      .select([
        'd.id',
        'd.employeeId',
        'e.fullNameAr as employeeName',
        'd.templateId',
        't.nameAr as templateNameAr',
        'v.versionNo as templateVersionNo',
        'd.language',
        'd.title',
        'd.docNumber',
        'd.fileId',
        'd.docxFileId',
        'd.createdAt',
        'd.revokedAt',
        'd.revokeReason',
      ])
      .where('d.companyId', '=', ctx.companyId);

  router.post(
    '/',
    requirePermission('letters.document.issue'),
    wrap(async (req, res) => {
      const body = issueDocumentInput.parse(req.body);
      if (!render) throw new AppError('RENDER_NOT_CONFIGURED', 503, 'خدمة تحويل PDF غير مهيّأة');
      const data = await run(req, async (ctx) => {
        const t = await loadTemplate(ctx, body.templateId);
        if (!t.isActive) throw new AppError('TEMPLATE_INACTIVE', 409, 'القالب معطّل');
        if (!t.activeVersionId)
          throw new AppError('NO_ACTIVE_VERSION', 409, 'لا إصدار مفعّل للقالب');
        const v = await ctx.trx
          .selectFrom('letterTemplateVersions')
          .select(['id', 'bodyHtml', 'docxFileId', 'contentHash'])
          .where('id', '=', t.activeVersionId)
          .executeTakeFirstOrThrow();
        const values = await loadLetterValues(ctx, body.employeeId, t.language);
        const docNumber = await nextDocNumber(ctx, t.code);
        const token = newVerifyToken();
        const url = verifyUrlOf(publicUrl, token);
        values['document.number'] = docNumber;
        values['document.verifyUrl'] = url;
        const name = values['employee.fullName'] ?? body.employeeId;
        const title = `${t.language === 'en' ? (t.nameEn ?? t.nameAr) : t.nameAr} — ${name}`;
        const base = `${t.code}-${values['employee.employeeNo'] ?? 'doc'}`;
        let pdf: Buffer;
        let docxFileId: string | null = null;
        if (t.format === 'docx') {
          if (!render.docxToPdf)
            throw new AppError('RENDER_NOT_CONFIGURED', 503, 'تحويل DOCX إلى PDF غير مهيّأ');
          const src = await ctx.trx
            .selectFrom('storedFiles')
            .selectAll()
            .where('id', '=', v.docxFileId as string)
            .executeTakeFirstOrThrow();
          const filled = fillDocx(await readStoredFile(files, src), values);
          pdf = await render.docxToPdf(filled);
          const df = await saveStoredFile(ctx, files, {
            buffer: filled,
            mime: DOCX_MIME,
            originalName: `${base}.docx`,
            purpose: 'issued_document',
            encrypt: false,
          });
          docxFileId = df.id;
        } else {
          values['document.qr'] = url ? await qrDataUrl(url) : null;
          const html = wrapLetterHtml(renderLetterBody(v.bodyHtml ?? '', values), t.language);
          pdf = await render(html);
        }
        const file = await saveStoredFile(ctx, files, {
          buffer: pdf,
          mime: 'application/pdf',
          originalName: `${base}.pdf`,
          purpose: 'issued_document',
          encrypt: false,
        });
        const row = await ctx.trx
          .insertInto('issuedDocuments')
          .values({
            companyId: ctx.companyId,
            employeeId: body.employeeId,
            templateId: t.id,
            templateVersionId: v.id,
            language: t.language,
            title,
            // لا نحفظ صورة QR في اللقطة (تُعاد من الرمز)
            data: JSON.stringify({ ...values, 'document.qr': null }),
            docNumber,
            verifyToken: token,
            templateHash: v.contentHash,
            fileId: file.id,
            docxFileId,
            issuedBy: ctx.userId ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return select(ctx).where('d.id', '=', row.id).executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/',
    requirePermission('letters.document.read'),
    wrap(async (req, res) => {
      const q = issuedListQuery.parse(req.query);
      const { rows, total } = await run(req, async (ctx) => {
        const apply = <T extends ReturnType<typeof select>>(b: T): T => {
          let x = b as ReturnType<typeof select>;
          if (q.employeeId) x = x.where('d.employeeId', '=', q.employeeId);
          if (q.templateId) x = x.where('d.templateId', '=', q.templateId);
          return x as T;
        };
        const rows = await apply(select(ctx))
          .orderBy('d.createdAt', 'desc')
          .orderBy('d.id', 'desc')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute();
        const total = Number(
          (
            await apply(select(ctx))
              .clearSelect()
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        return { rows, total };
      });
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    }),
  );

  router.post(
    '/:id/revoke',
    requirePermission('letters.document.revoke'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { reason } = revokeDocumentInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const d = await ctx.trx
          .selectFrom('issuedDocuments')
          .select(['id', 'revokedAt'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!d) throw new AppError('NOT_FOUND', 404, 'الوثيقة غير موجودة');
        if (d.revokedAt) throw new AppError('ALREADY_REVOKED', 409, 'الوثيقة مُبطلة مسبقاً');
        await ctx.trx
          .updateTable('issuedDocuments')
          .set({ revokedAt: new Date(), revokedBy: ctx.userId ?? null, revokeReason: reason })
          .where('id', '=', id)
          .execute();
        return select(ctx).where('d.id', '=', id).executeTakeFirstOrThrow();
      });
      res.json({ data });
    }),
  );

  router.get(
    '/:id/content',
    requirePermission('letters.document.read'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const file = await run(req, async (ctx) => {
        const f = await ctx.trx
          .selectFrom('issuedDocuments as d')
          .innerJoin('storedFiles as f', 'f.id', 'd.fileId')
          .selectAll('f')
          .where('d.id', '=', id)
          .executeTakeFirst();
        if (!f) throw new AppError('NOT_FOUND', 404, 'الوثيقة غير موجودة');
        return f;
      });
      sendFile(res, await readStoredFile(files, file), 'application/pdf', file.originalName);
    }),
  );

  router.get(
    '/:id/docx',
    requirePermission('letters.document.read'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const file = await run(req, async (ctx) => {
        const f = await ctx.trx
          .selectFrom('issuedDocuments as d')
          .innerJoin('storedFiles as f', 'f.id', 'd.docxFileId')
          .selectAll('f')
          .where('d.id', '=', id)
          .executeTakeFirst();
        if (!f) throw new AppError('NOT_FOUND', 404, 'لا توجد نسخة DOCX لهذه الوثيقة');
        return f;
      });
      sendFile(res, await readStoredFile(files, file), DOCX_MIME, file.originalName);
    }),
  );
  return router;
};

/** التحقق العام (بلا جلسة) برمز QR: صحة الوثيقة ونوعها ورقمها وتاريخها واسم الموظف مقنّعاً فقط. */
export const createPublicVerifyRouter = (db: Db, limit: boolean): Router => {
  const router = Router();
  if (limit)
    router.use(
      rateLimit({
        windowMs: 60_000,
        limit: 30,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) =>
          next(new AppError('RATE_LIMITED', 429, 'محاولات كثيرة، حاول بعد قليل')),
      }),
    );
  router.get(
    '/:token',
    wrap(async (req, res) => {
      const token = z
        .string()
        .regex(/^[A-Za-z0-9_-]{20,64}$/)
        .safeParse(req.params['token']);
      const notFound = () => new AppError('NOT_FOUND', 404, 'الوثيقة غير موجودة');
      if (!token.success) throw notFound();
      const { rows } = await sql<{
        docNumber: string;
        language: 'ar' | 'en';
        templateNameAr: string;
        templateNameEn: string | null;
        employeeNameAr: string;
        employeeNameEn: string | null;
        companyNameAr: string;
        companyNameEn: string | null;
        issuedAt: Date;
        revokedAt: Date | null;
        fileSha256: string | null;
      }>`select * from verify_issued_document(${token.data})`.execute(db);
      const r = rows[0];
      if (!r) throw notFound();
      const en = r.language === 'en';
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        data: {
          valid: !r.revokedAt,
          status: r.revokedAt ? 'revoked' : 'valid',
          number: r.docNumber,
          language: r.language,
          type: en ? (r.templateNameEn ?? r.templateNameAr) : r.templateNameAr,
          holder: maskName(en ? (r.employeeNameEn ?? r.employeeNameAr) : r.employeeNameAr),
          company: en ? (r.companyNameEn ?? r.companyNameAr) : r.companyNameAr,
          issuedAt: r.issuedAt.toISOString().slice(0, 10),
          fileSha256: r.fileSha256,
        },
      });
    }),
  );
  return router;
};
