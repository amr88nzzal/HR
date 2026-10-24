import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import QRCode from 'qrcode';
import { z } from 'zod';
import { SETTING_DEFS, num } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import type { MailProvider, TelegramProvider } from '../../notifications/index.js';
import { AppError } from '../../shared/errors.js';
import { loadPayslipDoc, type PayslipDoc } from './payslip-doc.js';

/**
 * التحقق من قسيمة الراتب برمز QR بلا تخزين: الرمز = معرّف القسيمة + بصمة HMAC لأرقامها المطبوعة.
 * عند المسح نعيد حساب البصمة من الأرقام الحالية في قاعدة البيانات: أي تعديل بعد الطباعة (أو تزوير) يُسقط التطابق.
 * Stateless payslip verification: token = payslip id + HMAC fingerprint of its printed figures.
 * On scan we recompute the fingerprint from the current DB figures: any change after printing (or forgery) breaks the match.
 */
export type VerifyDeps = { publicUrl: string | undefined; secret: string };

type Figures = {
  companyId: string;
  id: string;
  year: number;
  month: number;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
};

const fingerprint = (secret: string, f: Figures): string =>
  createHmac('sha256', `${secret}:payslip-verify`)
    .update(
      [f.companyId, f.id, f.year, f.month, f.gross, f.deductions, f.net, f.loans, f.payable].join(
        '|',
      ),
    )
    .digest('hex')
    .slice(0, 32);

/** الرمز: 32 خانة hex لمعرّف القسيمة + نقطة + 32 خانة بصمة (يقرأها الماسح كرابط قصير). */
export const payslipVerifyToken = (secret: string, companyId: string, d: PayslipDoc): string =>
  `${d.id.replace(/-/g, '')}.${fingerprint(secret, { companyId, ...d })}`;

export const payslipVerifyUrl = (
  deps: VerifyDeps,
  companyId: string,
  d: PayslipDoc,
): string | null =>
  deps.publicUrl
    ? `${deps.publicUrl.replace(/\/$/, '')}/verify/payslip/${payslipVerifyToken(deps.secret, companyId, d)}`
    : null;

export const payslipQrDataUrl = (url: string): Promise<string> =>
  QRCode.toDataURL(url, { margin: 0, width: 220, errorCorrectionLevel: 'M' });

export const maskName = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => `${Array.from(w).slice(0, 2).join('')}***`)
    .join(' ');

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const tokenShape = z.string().regex(/^[0-9a-f]{32}\.[0-9a-f]{32}$/);

type VerifyRow = {
  companyId: string;
  companyNameAr: string;
  companyNameEn: string | null;
  defaultLocale: string;
  employeeNameAr: string;
  employeeNameEn: string | null;
  year: number;
  month: number;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
};

/** يحلّل الرمز ويتحقق من بصمته؛ null = غير موجود/غير مطابق. / Parse the token and check its fingerprint; null = unknown/mismatch. */
const resolveToken = async (
  db: Db,
  secret: string,
  raw: unknown,
): Promise<{ id: string; r: VerifyRow } | null> => {
  const token = tokenShape.safeParse(raw);
  if (!token.success) return null;
  const [hex, sig] = token.data.split('.') as [string, string];
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const { rows } = await sql<VerifyRow>`select * from verify_payslip(${id}::uuid)`.execute(db);
  const r = rows[0];
  if (!r) return null;
  const expected = fingerprint(secret, { ...r, id });
  const ok = timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'));
  return ok ? { id, r } : null;
};

type VerifyOptions = z.infer<(typeof SETTING_DEFS)['payslipVerify']['schema']>;

const loadOptions = async (ctx: Ctx): Promise<VerifyOptions> => {
  const row = await ctx.trx
    .selectFrom('settings')
    .select('value')
    .where('companyId', '=', ctx.companyId)
    .where('scopeType', '=', 'company')
    .where('key', '=', 'payslipVerify')
    .executeTakeFirst();
  const p = SETTING_DEFS.payslipVerify.schema.safeParse(row?.value);
  return p.success ? p.data : SETTING_DEFS.payslipVerify.default;
};

/** وجهات OTP المتاحة لموظف القسيمة (دون كشفها كاملة). / The OTP destinations available for the payslip's employee (never shown in full). */
const loadDestinations = async (ctx: Ctx, payslipId: string) => {
  const { rows } = await sql<{
    userId: string | null;
    employeeId: string;
    userEmail: string | null;
  }>`
    select e.user_id as "userId", e.id as "employeeId", u.email as "userEmail"
      from payslips s join employees e on e.id = s.employee_id left join users u on u.id = e.user_id
     where s.id = ${payslipId}`.execute(ctx.trx);
  const e = rows[0];
  if (!e) return { telegramChatId: null as string | null, email: null as string | null };
  const tg = e.userId
    ? await ctx.trx
        .selectFrom('telegramLinks')
        .select('chatId')
        .where('userId', '=', e.userId)
        .executeTakeFirst()
    : undefined;
  const mail = await ctx.trx
    .selectFrom('employeeContacts')
    .select('value')
    .where('employeeId', '=', e.employeeId)
    .where('type', '=', 'email')
    .orderBy('isPrimary', 'desc')
    .executeTakeFirst();
  return { telegramChatId: tg?.chatId ?? null, email: mail?.value ?? e.userEmail ?? null };
};

const maskEmail = (v: string): string => {
  const [u = '', d = ''] = v.split('@');
  return `${u.slice(0, 1)}***@${d}`;
};

/** القيمة السرية المخزّنة للموظف للمقارنة. / The employee's stored secret value to compare against. */
const loadSecret = async (
  ctx: Ctx,
  payslipId: string,
  o: VerifyOptions,
): Promise<string | null> => {
  if (o.secretField === 'none') return null;
  const { rows } = await sql<{ birthDate: string | null; custom: unknown }>`
    select e.birth_date::text as "birthDate",
           e.custom_fields -> ${o.secretCustomKey} as custom
      from payslips s join employees e on e.id = s.employee_id where s.id = ${payslipId}`.execute(
    ctx.trx,
  );
  const r = rows[0];
  if (!r) return null;
  if (o.secretField === 'birthDate') return r.birthDate;
  return r.custom === null || r.custom === undefined || r.custom === '' ? null : String(r.custom);
};

const norm = (v: string): string => v.replace(/[\s-]/g, '').toLowerCase();
const same = (a: string, b: string): boolean => {
  const x = Buffer.from(norm(a));
  const y = Buffer.from(norm(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** محاولات فاشلة لكل قسيمة: 5 ثم قفل 15 دقيقة (ذاكرة العملية؛ يكفي مع حدّ الطلبات للـ IP). */
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const fails = new Map<string, { n: number; until: number }>();
const assertNotLocked = (id: string): void => {
  const f = fails.get(id);
  if (f && f.until > Date.now() && f.n >= MAX_FAILS)
    throw new AppError('VERIFY_LOCKED', 429, 'محاولات خاطئة كثيرة، حاول بعد 15 دقيقة');
};
const recordFail = (id: string): void => {
  const f = fails.get(id);
  const live = f && f.until > Date.now() ? f : { n: 0, until: 0 };
  fails.set(id, { n: live.n + 1, until: Date.now() + LOCK_MS });
};
const clearFails = (id: string): void => void fails.delete(id);

export const hashOtp = (secret: string, id: string, code: string): string =>
  createHash('sha256').update(`${secret}:otp:${id}:${code}`).digest('hex');

export type PublicVerifyDeps = { telegram?: TelegramProvider; mail?: MailProvider };

/**
 * راوتر التحقق العام بلا جلسة:
 * - GET /:token: مطابقة البصمة؛ الشركة والشهر والاسم (مقنّع أو كامل بحسب إعداد الشركة) وطرق التحقق المتاحة، بلا مبالغ.
 * - POST /:token/check: مطابقة الأرقام المطبوعة (صح/خطأ فقط).
 * - POST /:token/otp: إرسال رمز لتلغرام/بريد الموظف. POST /:token/reveal: الرمز أو القيمة السرية ← القسيمة كاملة.
 * Public router, no session; see the list above. Amounts are only ever revealed after the OTP or the secret value.
 */
export const createPublicPayslipVerifyRouter = (
  db: Db,
  limit: boolean,
  secret: string,
  deps: PublicVerifyDeps = {},
): Router => {
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
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const notFound = () => new AppError('NOT_FOUND', 404, 'القسيمة غير موجودة');
  const scope = (req: Request, companyId: string) => ({
    companyId,
    requestId: req.requestId,
  });

  router.get(
    '/:token',
    wrap(async (req, res) => {
      if (!tokenShape.safeParse(req.params['token']).success) throw notFound();
      const t = await resolveToken(db, secret, req.params['token']);
      if (!t) {
        res.json({ data: { valid: false, status: 'mismatch' } });
        return;
      }
      const { r, id } = t;
      const en = r.defaultLocale === 'en';
      const info = await withTenant(db, scope(req, r.companyId), async (ctx) => {
        const o = await loadOptions(ctx);
        const d = await loadDestinations(ctx, id);
        return {
          o,
          telegram: o.otpTelegram && !!d.telegramChatId && !!deps.telegram,
          email: o.otpEmail && !!d.email && !!deps.mail,
          secret: o.secretField !== 'none' && (await loadSecret(ctx, id, o)) !== null,
        };
      });
      const full = en ? (r.employeeNameEn ?? r.employeeNameAr) : r.employeeNameAr;
      res.json({
        data: {
          valid: true,
          status: 'valid',
          language: en ? 'en' : 'ar',
          company: en ? (r.companyNameEn ?? r.companyNameAr) : r.companyNameAr,
          holder: info.o.fullName ? full : maskName(full),
          year: r.year,
          month: r.month,
          methods: {
            figures: info.o.figures,
            otpTelegram: info.telegram,
            otpEmail: info.email,
            secret: info.secret ? info.o.secretField : null,
          },
        },
      });
    }),
  );

  const checkBody = z.object({
    gross: z.string().trim().min(1).max(30),
    deductions: z.string().trim().min(1).max(30),
    payable: z.string().trim().min(1).max(30),
  });
  router.post(
    '/:token/check',
    wrap(async (req, res) => {
      const t = await resolveToken(db, secret, req.params['token']);
      if (!t) throw notFound();
      const b = checkBody.parse(req.body);
      const o = await withTenant(db, scope(req, t.r.companyId), loadOptions);
      if (!o.figures) throw new AppError('METHOD_DISABLED', 403, 'هذه الطريقة غير مفعّلة');
      assertNotLocked(t.id);
      const eq = (a: string, c: string): boolean => {
        try {
          return num(a.replace(/,/g, '')).equals(num(c));
        } catch {
          return false;
        }
      };
      const match =
        eq(b.gross, t.r.gross) && eq(b.deductions, t.r.deductions) && eq(b.payable, t.r.payable);
      if (match) clearFails(t.id);
      else recordFail(t.id);
      res.json({ data: { match } });
    }),
  );

  const otpBody = z.object({ channel: z.enum(['telegram', 'email']) });
  router.post(
    '/:token/otp',
    wrap(async (req, res) => {
      const t = await resolveToken(db, secret, req.params['token']);
      if (!t) throw notFound();
      const { channel } = otpBody.parse(req.body);
      assertNotLocked(t.id);
      const out = await withTenant(db, scope(req, t.r.companyId), async (ctx) => {
        const o = await loadOptions(ctx);
        if (!(channel === 'telegram' ? o.otpTelegram : o.otpEmail))
          throw new AppError('METHOD_DISABLED', 403, 'هذه الطريقة غير مفعّلة');
        const d = await loadDestinations(ctx, t.id);
        // حدّ الإرسال: واحد كل 60 ثانية و5 في الساعة لكل قسيمة / send limits: one per 60s and 5 per hour per payslip
        const recent = await ctx.trx
          .selectFrom('payslipVerifyOtps')
          .select('createdAt')
          .where('payslipId', '=', t.id)
          .where('createdAt', '>', new Date(Date.now() - 3_600_000))
          .orderBy('createdAt', 'desc')
          .execute();
        const last = recent[0];
        if ((last && Date.now() - last.createdAt.getTime() < 60_000) || recent.length >= 5)
          throw new AppError('RATE_LIMITED', 429, 'انتظر قليلاً قبل طلب رمز جديد');
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const text =
          t.r.defaultLocale === 'en'
            ? `Payslip verification code: ${code} (valid for 10 minutes). Share it only with the party verifying your payslip.`
            : `رمز التحقق من قسيمة راتبك: ${code} (صالح 10 دقائق). لا تشاركه إلا مع الجهة التي تتحقق من قسيمتك.`;
        let hint: string;
        if (channel === 'telegram') {
          const sender = await deps.telegram?.(ctx);
          if (!d.telegramChatId || !sender)
            throw new AppError('CHANNEL_UNAVAILABLE', 409, 'القناة غير متاحة لهذا الموظف');
          await sender.send(d.telegramChatId, text);
          hint = 'Telegram';
        } else {
          const transport = await deps.mail?.(ctx);
          if (!d.email || !transport)
            throw new AppError('CHANNEL_UNAVAILABLE', 409, 'القناة غير متاحة لهذا الموظف');
          const subject =
            t.r.defaultLocale === 'en' ? 'Payslip verification code' : 'رمز التحقق من القسيمة';
          await transport.send({
            to: d.email,
            subject,
            text,
            html: `<div dir="${t.r.defaultLocale === 'en' ? 'ltr' : 'rtl'}" style="font-family:sans-serif"><p>${text}</p><p style="font-size:28px;letter-spacing:6px"><b>${code}</b></p></div>`,
          });
          hint = maskEmail(d.email);
        }
        await ctx.trx
          .insertInto('payslipVerifyOtps')
          .values({
            companyId: ctx.companyId,
            payslipId: t.id,
            channel,
            codeHash: hashOtp(secret, t.id, code),
            expiresAt: new Date(Date.now() + 10 * 60_000),
          })
          .execute();
        return hint;
      });
      res.json({ data: { sent: true, hint: out } });
    }),
  );

  const revealBody = z
    .object({
      otp: z
        .string()
        .trim()
        .regex(/^\d{6}$/)
        .optional(),
      secret: z.string().trim().min(1).max(100).optional(),
    })
    .refine((b) => (b.otp ? 1 : 0) + (b.secret ? 1 : 0) === 1, 'أرسل الرمز أو القيمة السرية');
  router.post(
    '/:token/reveal',
    wrap(async (req, res) => {
      const t = await resolveToken(db, secret, req.params['token']);
      if (!t) throw notFound();
      const b = revealBody.parse(req.body);
      assertNotLocked(t.id);
      const wrongCode = () => new AppError('VERIFY_FAILED', 401, 'الرمز أو القيمة غير صحيحة');
      const out = await withTenant(db, scope(req, t.r.companyId), async (ctx) => {
        const o = await loadOptions(ctx);
        let ok = false;
        if (b.otp) {
          if (!o.otpTelegram && !o.otpEmail)
            throw new AppError('METHOD_DISABLED', 403, 'هذه الطريقة غير مفعّلة');
          const row = await ctx.trx
            .selectFrom('payslipVerifyOtps')
            .select(['id', 'codeHash', 'attempts'])
            .where('payslipId', '=', t.id)
            .where('usedAt', 'is', null)
            .where('expiresAt', '>', new Date())
            .orderBy('createdAt', 'desc')
            .forUpdate()
            .executeTakeFirst();
          if (row && row.attempts < 5) {
            const a = Buffer.from(row.codeHash);
            const c = Buffer.from(hashOtp(secret, t.id, b.otp));
            ok = a.length === c.length && timingSafeEqual(a, c);
            await ctx.trx
              .updateTable('payslipVerifyOtps')
              .set(ok ? { usedAt: new Date() } : { attempts: row.attempts + 1 })
              .where('id', '=', row.id)
              .execute();
          }
        } else if (b.secret) {
          if (o.secretField === 'none')
            throw new AppError('METHOD_DISABLED', 403, 'هذه الطريقة غير مفعّلة');
          const stored = await loadSecret(ctx, t.id, o);
          ok = stored !== null && same(stored, b.secret);
        }
        if (!ok) return null;
        return loadPayslipDoc(ctx, t.id);
      });
      if (!out) {
        recordFail(t.id);
        throw wrongCode();
      }
      clearFails(t.id);
      const en = t.r.defaultLocale === 'en';
      const pick = (l: { nameAr: string; nameEn: string | null; amount: string }) => ({
        name: en ? (l.nameEn ?? l.nameAr) : l.nameAr,
        amount: l.amount,
      });
      res.json({
        data: {
          holder: en ? (t.r.employeeNameEn ?? t.r.employeeNameAr) : t.r.employeeNameAr,
          employeeNo: out.employeeNo,
          year: out.year,
          month: out.month,
          currency: out.currency,
          earnings: out.earnings.map(pick),
          deductions: out.deductionLines.map(pick),
          loans: out.loanItems.map((l) => ({
            name: en ? l.typeNameEn : l.typeNameAr,
            amount: l.amount,
          })),
          gross: out.gross,
          deductionsTotal: out.deductions,
          net: out.net,
          loansTotal: out.loans,
          payable: out.payable,
        },
      });
    }),
  );
  return router;
};
