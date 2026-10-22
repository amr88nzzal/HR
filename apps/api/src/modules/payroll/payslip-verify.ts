import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { sql } from 'kysely';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { AppError } from '../../shared/errors.js';
import type { PayslipDoc } from './payslip-doc.js';

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

const maskName = (name: string): string =>
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

/**
 * GET /public/verify/payslip/:token — بلا جلسة. عند التطابق: الشركة والشهر واسم الموظف مقنّعاً فقط (بلا مبالغ).
 * عند عدم التطابق لا نعيد أي بيانات (التزوير والتعديل بعد الطباعة غير متمايزين).
 * No session. On match: company, month and the masked name only (no amounts). On mismatch nothing is returned.
 */
export const createPublicPayslipVerifyRouter = (db: Db, limit: boolean, secret: string): Router => {
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
      const token = tokenShape.safeParse(req.params['token']);
      if (!token.success) throw new AppError('NOT_FOUND', 404, 'القسيمة غير موجودة');
      const [hex, sig] = token.data.split('.') as [string, string];
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const { rows } = await sql<{
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
      }>`select * from verify_payslip(${id}::uuid)`.execute(db);
      const r = rows[0];
      res.setHeader('Cache-Control', 'no-store');
      const expected = r ? fingerprint(secret, { ...r, id }) : '';
      const ok = !!r && timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'));
      if (!r || !ok) {
        res.json({ data: { valid: false, status: 'mismatch' } });
        return;
      }
      const en = r.defaultLocale === 'en';
      res.json({
        data: {
          valid: true,
          status: 'valid',
          language: en ? 'en' : 'ar',
          company: en ? (r.companyNameEn ?? r.companyNameAr) : r.companyNameAr,
          holder: maskName(en ? (r.employeeNameEn ?? r.employeeNameAr) : r.employeeNameAr),
          year: r.year,
          month: r.month,
        },
      });
    }),
  );
  return router;
};
