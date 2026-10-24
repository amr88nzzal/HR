import { clearSnapshotCache } from '../identity/permissions.service.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { jwtVerify, SignJWT } from 'jose';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { checkPasswordPolicy } from '../identity/index.js';
import { provisionCompanyAdmin } from './provision.js';

export type PlatformDeps = {
  /** مفتاح مدير المنصة من البيئة؛ غيابه = الواجهة غير مفعّلة / platform key from env; absent = disabled */
  adminKey: string;
  jwtSecret: string;
  limit: boolean;
};

const SESSION_HOURS = 2;
const AUDIENCE = 'platform';

// مفتاح توقيع مشتق ومنفصل عن توكنات المستخدمين، وبجمهور (aud) خاص
// A derived signing key, separate from user tokens, with its own audience
const signingKey = (secret: string) => new TextEncoder().encode(`${secret}:platform`);

const digest = (v: string) => createHash('sha256').update(v).digest();

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
// أسماء محجوزة كي لا تتعارض مع مسارات/نطاقات النظام / reserved so they never clash with system paths/hosts
const RESERVED = new Set(['default', 'api', 'www', 'admin', 'platform', 'app', 'static', 'assets']);

const validTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const companyFields = {
  nameAr: z.string().trim().min(2).max(200),
  nameEn: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  timezone: z.string().refine(validTimezone, 'منطقة زمنية غير صالحة'),
  defaultLocale: z.enum(['ar', 'en']),
};

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG, 'رمز الشركة: أحرف إنجليزية صغيرة وأرقام وشرطة فقط')
    .refine((s) => !RESERVED.has(s), 'هذا الرمز محجوز'),
  ...companyFields,
  timezone: companyFields.timezone.default('Asia/Riyadh'),
  defaultLocale: companyFields.defaultLocale.default('ar'),
  admin: z.object({
    email: z.string().trim().toLowerCase().email().max(200),
    name: z.string().trim().min(2).max(200),
  }),
});

const updateSchema = z.object({
  ...companyFields,
  status: z.enum(['active', 'suspended']),
  version: z.number().int().positive(),
});

/** كلمة مرور مؤقتة تستوفي سياسة الكلمات؛ تُعرض مرة واحدة ويُجبر المدير على تغييرها */
const temporaryPassword = (email: string): string => {
  for (;;) {
    const pw = randomBytes(15).toString('base64url');
    if (!checkPasswordPolicy(pw, { email })) return pw;
  }
};

type CompanyRow = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  timezone: string;
  defaultLocale: string;
  status: string;
  version: number;
  createdAt: Date;
  userCount: number;
  employeeCount: number;
};

const wrap =
  (h: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    h(req, res).catch(next);
  };

export const createPlatformRouter = (db: Db, deps: PlatformDeps): Router => {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  if (deps.limit)
    router.use(
      '/session',
      rateLimit({
        windowMs: 60_000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) =>
          next(new AppError('RATE_LIMITED', 429, 'محاولات كثيرة، حاول بعد قليل')),
      }),
    );

  router.post(
    '/session',
    wrap(async (req, res) => {
      const { key } = z.object({ key: z.string().min(1).max(500) }).parse(req.body);
      // مقارنة بزمن ثابت على البصمات / constant-time comparison on digests
      if (!timingSafeEqual(digest(key), digest(deps.adminKey)))
        throw new AppError('INVALID_CREDENTIALS', 401, 'مفتاح غير صحيح');
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('platform-admin')
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${SESSION_HOURS}h`)
        .sign(signingKey(deps.jwtSecret));
      res.json({ data: { token, expiresIn: SESSION_HOURS * 3600 } });
    }),
  );

  const guard: RequestHandler = (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول'));
    jwtVerify(token, signingKey(deps.jwtSecret), { algorithms: ['HS256'], audience: AUDIENCE })
      .then(() => next())
      .catch(() => next(new AppError('UNAUTHORIZED', 401, 'انتهت الجلسة')));
  };

  const list = async (): Promise<CompanyRow[]> => {
    const { rows } = await sql<CompanyRow>`select * from platform_list_companies()`.execute(db);
    return rows;
  };

  router.get(
    '/companies',
    guard,
    wrap(async (_req, res) => {
      res.json({ data: await list() });
    }),
  );

  router.post(
    '/companies',
    guard,
    wrap(async (req, res) => {
      const body = createSchema.parse(req.body);
      const password = temporaryPassword(body.admin.email);
      const requestId = req.requestId ?? '';
      // كل شيء في معاملة واحدة: فشل أي خطوة (مثل slug مكرر) لا يترك شركة ناقصة
      // Everything in one transaction: a failure (e.g. duplicate slug) never leaves a half-built company
      const companyId = await db.transaction().execute(async (trx) => {
        const { rows } = await sql<{ id: string }>`
          select platform_create_company(${body.slug}, ${body.nameAr}, ${body.nameEn},
                                         ${body.timezone}, ${body.defaultLocale}) as id`.execute(
          trx,
        );
        const id = rows[0]!.id;
        await sql`select set_config('app.company_id', ${id}, true),
                         set_config('app.user_id', '', true),
                         set_config('app.request_id', ${requestId}, true)`.execute(trx);
        const ctx: Ctx = { trx, companyId: id, userId: null, requestId };
        const { userId } = await provisionCompanyAdmin(ctx, {
          email: body.admin.email,
          displayName: body.admin.name,
          password,
          mustChangePassword: true,
        });
        await trx
          .insertInto('auditLogs')
          .values({
            companyId: id,
            userId: null,
            entityType: 'companies',
            entityId: id,
            action: 'platform_create',
            changes: JSON.stringify({ slug: body.slug, adminUserId: userId }),
            requestId,
            ip: req.ip ?? null,
          })
          .execute();
        return id;
      });
      const company = (await list()).find((c) => c.id === companyId);
      res.status(201).json({
        data: { company, admin: { email: body.admin.email, temporaryPassword: password } },
      });
    }),
  );

  router.patch(
    '/companies/:id',
    guard,
    wrap(async (req, res) => {
      const id = z.string().uuid().parse(req.params['id']);
      const b = updateSchema.parse(req.body);
      const { rows } = await sql<{ v: number | null }>`
        select platform_update_company(${id}, ${b.nameAr}, ${b.nameEn}, ${b.status},
                                       ${b.timezone}, ${b.defaultLocale}, ${b.version}) as v`.execute(
        db,
      );
      if (rows[0]?.v == null) {
        const exists = (await list()).some((c) => c.id === id);
        throw exists
          ? new AppError('VERSION_CONFLICT', 409, 'تغيّرت بيانات الشركة، حدّث الصفحة وأعد المحاولة')
          : new AppError('NOT_FOUND', 404, 'الشركة غير موجودة');
      }
      // التعليق يُنهي كل الجلسات القائمة (والتحقق من حالة الشركة عند التحديث والطلب يمنع العودة)
      // Suspending ends every live session (company-status checks on refresh and per request block any return)
      if (b.status === 'suspended') {
        await sql`select platform_revoke_company_sessions(${id})`.execute(db);
        clearSnapshotCache(); // لا تبقى لقطة صلاحيات مخزّنة لمستخدمي الشركة / no cached grants survive
      }
      res.json({ data: (await list()).find((c) => c.id === id) });
    }),
  );

  return router;
};
