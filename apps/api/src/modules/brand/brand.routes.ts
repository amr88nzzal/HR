import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  BRAND_SLOTS,
  MAX_BRAND_IMAGE_BYTES,
  brandPreviewInput,
  brandUpdateInput,
  wrapLetterHtml,
  type BrandSlot,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import {
  deleteStoredBytes,
  readStoredFile,
  saveStoredFile,
  sniffFileType,
  type FileDeps,
} from '../../shared/stored-files.js';
import { requirePermission } from '../identity/index.js';
import { emptyBrandText, loadBrand, loadLetterhead, loadSlotImage, SLOT_COLUMN } from './brand.js';
import { checkSvg, looksLikeSvg } from './svg.js';

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const slotOf = (v: unknown): BrandSlot => {
  const r = z.enum(BRAND_SLOTS).safeParse(v);
  if (!r.success) throw new AppError('NOT_FOUND', 404, 'خانة غير معروفة');
  return r.data;
};
const READ = 'org.brand.read';
const WRITE = 'org.brand.update';

/** تطبيع الصورة إلى PNG آمن (يزيل البيانات الوصفية ويحوّل SVG بعد فحصه). */
const normalize = async (input: Buffer, slot: BrandSlot): Promise<Buffer> => {
  if (input.length === 0) throw new AppError('FILE_REQUIRED', 400, 'لم يُرسل ملف');
  if (input.length > MAX_BRAND_IMAGE_BYTES)
    throw new AppError('FILE_TOO_LARGE', 413, 'حجم الصورة يتجاوز 1 ميغابايت');
  let source = input;
  if (looksLikeSvg(input)) {
    const problems = checkSvg(input);
    if (problems.length) throw new AppError('INVALID_SVG', 400, 'ملف SVG غير آمن', { problems });
  } else {
    const mime = input.length >= 12 ? sniffFileType(input) : null;
    if (mime !== 'image/png' && mime !== 'image/jpeg')
      throw new AppError('FILE_TYPE_NOT_ALLOWED', 415, 'الصيغ المقبولة: PNG وJPG وSVG');
    source = input;
  }
  const box = slot === 'stamp' ? 600 : 1200;
  const h = slot === 'stamp' ? 600 : 400;
  try {
    return await sharp(source, { limitInputPixels: 40_000_000, density: 300 })
      .rotate()
      .resize(box, h, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new AppError('INVALID_IMAGE', 400, 'تعذّرت معالجة الصورة');
  }
};

/** /company-brand — الهوية البصرية (للقراءة: أي مستخدم للشعار فقط، والباقي بالصلاحية) */
export const createBrandRouter = (db: Db, authenticate: RequestHandler, deps: FileDeps): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };
  const sendImage = (res: Response, img: { bytes: Buffer; mime: string; sha256: string }) => {
    res.setHeader('Content-Type', img.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', `"${img.sha256}"`);
    res.send(img.bytes);
  };

  /** شعار للتطبيق (شريط/دخول): لغة وسمة مع رجوع تلقائي — لأي مستخدم مسجّل */
  router.get(
    '/logo',
    wrap(async (req, res) => {
      const q = z
        .object({
          theme: z.enum(['light', 'dark']).default('light'),
          lang: z.enum(['ar', 'en']).default('ar'),
        })
        .parse(req.query);
      const img = await run(req, async (ctx) => {
        const b = await loadBrand(ctx);
        if (!b) return null;
        const other = q.lang === 'ar' ? 'en' : 'ar';
        const order: BrandSlot[] =
          q.theme === 'dark'
            ? [`logo_dark_${q.lang}`, `logo_dark_${other}`, `logo_${q.lang}`, `logo_${other}`]
            : [`logo_${q.lang}`, `logo_${other}`];
        for (const s of order) {
          const i = await loadSlotImage(ctx, deps, b.files[s]);
          if (i) return i;
        }
        return null;
      });
      if (!img) throw new AppError('NOT_FOUND', 404, 'لا يوجد شعار');
      sendImage(res, img);
    }),
  );

  /** ترويسة الطباعة (اسم الشركة وبيانات التواصل) لأي مستخدم مسجّل؛ بلا أرقام ضريبية أو تسجيل. */
  router.get(
    '/print-header',
    wrap(async (req, res) => {
      const data = await run(req, async (ctx) => {
        const b = await loadBrand(ctx);
        const c = await ctx.trx
          .selectFrom('companies')
          .select(['nameAr', 'nameEn'])
          .where('id', '=', ctx.companyId)
          .executeTakeFirstOrThrow();
        return {
          nameAr: b?.legalNameAr ?? c.nameAr,
          nameEn: b?.legalNameEn ?? c.nameEn ?? c.nameAr,
          addressAr: b?.addressAr ?? null,
          addressEn: b?.addressEn ?? null,
          phone: b?.phone ?? null,
          email: b?.email ?? null,
          website: b?.website ?? null,
        };
      });
      res.json({ data });
    }),
  );

  router.get(
    '/',
    requirePermission(READ),
    wrap(async (req, res) => {
      const data = await run(req, async (ctx) => {
        const b = (await loadBrand(ctx)) ?? {
          ...emptyBrandText(),
          version: 0,
          files: {
            logo_ar: null,
            logo_en: null,
            logo_dark_ar: null,
            logo_dark_en: null,
            stamp: null,
          },
        };
        const { files, ...rest } = b;
        return {
          ...rest,
          slots: Object.fromEntries(BRAND_SLOTS.map((s) => [s, files[s] !== null])),
        };
      });
      res.json({ data });
    }),
  );

  router.put(
    '/',
    requirePermission(WRITE),
    wrap(async (req, res) => {
      const b = brandUpdateInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const cur = await loadBrand(ctx);
        if (cur && b.version !== undefined && b.version !== cur.version)
          throw new AppError('VERSION_CONFLICT', 409, 'عُدّلت الهوية من مستخدم آخر؛ أعد التحميل');
        const { version: _v, ...fields } = b;
        void _v;
        await ctx.trx
          .insertInto('companyBrand')
          .values({ companyId: ctx.companyId, ...fields })
          .onConflict((oc) =>
            oc
              .column('companyId')
              .doUpdateSet({ ...fields, version: sql<number>`company_brand.version + 1` }),
          )
          .execute();
        return { version: (await loadBrand(ctx))!.version };
      });
      res.json({ data });
    }),
  );

  router.get(
    '/files/:slot',
    requirePermission(READ),
    wrap(async (req, res) => {
      const slot = slotOf(req.params['slot']);
      const img = await run(req, async (ctx) => {
        const b = await loadBrand(ctx);
        return loadSlotImage(ctx, deps, b?.files[slot] ?? null);
      });
      if (!img) throw new AppError('NOT_FOUND', 404, 'لا توجد صورة');
      sendImage(res, img);
    }),
  );

  router.put(
    '/files/:slot',
    requirePermission(WRITE),
    express.raw({ type: () => true, limit: MAX_BRAND_IMAGE_BYTES + 1024 }),
    wrap(async (req, res) => {
      const slot = slotOf(req.params['slot']);
      const body = req.body as unknown;
      const png = await normalize(Buffer.isBuffer(body) ? body : Buffer.alloc(0), slot);
      const stale: string[] = [];
      await run(req, async (ctx) => {
        const cur = await loadBrand(ctx);
        const file = await saveStoredFile(ctx, deps, {
          buffer: png,
          mime: 'image/png',
          originalName: `${slot}.png`,
          purpose: 'brand',
          encrypt: false,
        });
        const col = SLOT_COLUMN[slot];
        await ctx.trx
          .insertInto('companyBrand')
          .values({ companyId: ctx.companyId, [col]: file.id })
          .onConflict((oc) =>
            oc
              .column('companyId')
              .doUpdateSet({ [col]: file.id, version: sql<number>`company_brand.version + 1` }),
          )
          .execute();
        const old = cur?.files[slot];
        if (old) {
          const row = await ctx.trx
            .deleteFrom('storedFiles')
            .where('id', '=', old)
            .returning('storageKey')
            .executeTakeFirst();
          if (row) stale.push(row.storageKey);
        }
      });
      await deleteStoredBytes(deps, stale);
      res.json({ data: { slot } });
    }),
  );

  router.delete(
    '/files/:slot',
    requirePermission(WRITE),
    wrap(async (req, res) => {
      const slot = slotOf(req.params['slot']);
      const stale: string[] = [];
      await run(req, async (ctx) => {
        const cur = await loadBrand(ctx);
        const old = cur?.files[slot];
        if (!old) return;
        await ctx.trx
          .updateTable('companyBrand')
          .set({ [SLOT_COLUMN[slot]]: null, version: sql<number>`version + 1` })
          .where('companyId', '=', ctx.companyId)
          .execute();
        const row = await ctx.trx
          .deleteFrom('storedFiles')
          .where('id', '=', old)
          .returning('storageKey')
          .executeTakeFirst();
        if (row) stale.push(row.storageKey);
      });
      await deleteStoredBytes(deps, stale);
      res.status(204).end();
    }),
  );

  /** معاينة حيّة: ترويسة بنصوص غير محفوظة (اختيارياً) فوق الصور المحفوظة، بلغة محددة */
  router.post(
    '/preview',
    requirePermission(READ),
    wrap(async (req, res) => {
      const b = brandPreviewInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const lh = await loadLetterhead(ctx, deps, b.lang, b.fields);
        const sample =
          b.lang === 'ar'
            ? '<p>هذه معاينة لشكل الترويسة والتذييل في الوثائق الصادرة.</p>'
            : '<p>This is a preview of the letterhead and footer on issued documents.</p>';
        return { html: wrapLetterHtml(sample, b.lang, { header: lh.header, footer: lh.footer }) };
      });
      res.json({ data });
    }),
  );

  return router;
};

/** شعار الشركة لشاشة الدخول بلا جلسة (بالـ slug): الشعار وحده، بحد معدل */
export const createPublicBrandRouter = (
  db: Db,
  deps: FileDeps,
  limit: boolean,
  defaultSlug?: string,
): Router => {
  const router = Router();
  if (limit)
    router.use(
      rateLimit({
        windowMs: 60_000,
        limit: 60,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) =>
          next(new AppError('RATE_LIMITED', 429, 'محاولات كثيرة، حاول بعد قليل')),
      }),
    );
  router.get(
    '/:slug/logo',
    wrap(async (req, res) => {
      const slug = z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,60}$/)
        .safeParse(req.params['slug']);
      const q = z
        .object({
          theme: z.enum(['light', 'dark']).default('light'),
          lang: z.enum(['ar', 'en']).default('ar'),
        })
        .parse(req.query);
      if (!slug.success) throw new AppError('NOT_FOUND', 404, 'لا يوجد شعار');
      // «default» = شركة الدخول الافتراضية في الخادم
      const company = slug.data === 'default' ? (defaultSlug ?? slug.data) : slug.data;
      const other = q.lang === 'ar' ? 'en' : 'ar';
      const order =
        q.theme === 'dark'
          ? [`logo_dark_${q.lang}`, `logo_dark_${other}`, `logo_${q.lang}`, `logo_${other}`]
          : [`logo_${q.lang}`, `logo_${other}`];
      for (const s of order) {
        const { rows } = await sql<{ storageKey: string; mimeType: string; sha256: string }>`
          select * from public_brand_logo(${company}, ${s})`.execute(db);
        const r = rows[0];
        if (!r) continue;
        const bytes = await readStoredFile(deps, { storageKey: r.storageKey, isEncrypted: false });
        res.setHeader('Content-Type', r.mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('ETag', `"${r.sha256}"`);
        res.send(bytes);
        return;
      }
      throw new AppError('NOT_FOUND', 404, 'لا يوجد شعار');
    }),
  );
  return router;
};
