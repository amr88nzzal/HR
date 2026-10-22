import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { payslipConfigSchema, payslipTemplateInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { AppError } from '../../shared/errors.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { employeeScope } from '../employees/index.js';
import { requirePermission } from '../identity/index.js';
import { loadPayslipDoc, type PayslipDoc } from './payslip-doc.js';
import { buildPayslipHtml } from './payslip-html.js';
import { payslipQrDataUrl, type VerifyDeps } from './payslip-verify.js';
import { renderPayslipBody, resolveLang, type PayslipExtras } from './payslip-render.js';
import { companyLang } from './payslip-doc.js';
import { wrapLetterHtml } from '@hrms/shared';
import { loadLetterhead } from '../brand/index.js';
import { makeRun } from './setup.routes.js';

const READ = 'payroll.payslip_template.read';
const MANAGE = 'payroll.payslip_template.manage';
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const toDto = (r: {
  id: string;
  nameAr: string;
  nameEn: string | null;
  config: unknown;
  isDefault: boolean;
  version: number;
  updatedAt: Date;
}) => ({
  id: r.id,
  nameAr: r.nameAr,
  nameEn: r.nameEn,
  config: r.config,
  isDefault: r.isDefault,
  version: r.version,
  updatedAt: r.updatedAt,
});

/** قسيمة تجريبية للمعاينة عند عدم اختيار قسيمة حقيقية / sample payslip for previews without a real one */
const SAMPLE: PayslipDoc = {
  id: '00000000-0000-0000-0000-000000000000',
  employeeId: '00000000-0000-0000-0000-000000000000',
  employeeNo: 'E-1024',
  nameAr: 'نور الدين الجبور',
  nameEn: 'Nour Aldeen Jbour',
  year: 2026,
  month: 10,
  currency: 'JOD',
  periodStatus: 'locked',
  gross: '620.000',
  deductions: '181.500',
  net: '438.500',
  loans: '46.000',
  payable: '392.500',
  earnings: [
    { code: 'BASIC', nameAr: 'الراتب الأساسي', nameEn: 'Basic salary', amount: '500.000' },
    { code: 'HOUSING', nameAr: 'بدل سكن', nameEn: 'Housing allowance', amount: '100.000' },
    { code: 'OT', nameAr: 'عمل إضافي', nameEn: 'Overtime', amount: '20.000' },
    { code: 'BONUS', nameAr: 'مكافآت', nameEn: 'Bonus', amount: '0.000' },
  ],
  deductionLines: [
    { code: 'SSC', nameAr: 'الضمان الاجتماعي', nameEn: 'Social security', amount: '46.500' },
    { code: 'TAX', nameAr: 'ضريبة الدخل', nameEn: 'Income tax', amount: '135.000' },
    { code: 'LATE', nameAr: 'خصم تأخير', nameEn: 'Late deduction', amount: '0.000' },
  ],
  loanItems: [{ amount: '46.000', overCap: false, no: 3, count: 10 }],
};
const SAMPLE_EXTRAS: PayslipExtras = {
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  department: { ar: 'المالية', en: 'Finance' },
  branch: { ar: 'عمّان', en: 'Amman' },
  hireDate: '2022-03-01',
  basicSalary: '500.000',
  ytd: { gross: '6200.000', deductions: '1815.000', net: '4385.000' },
  printedAt: '21/10/2026, 03:11',
  qr: null,
};

const SAMPLE_QR_URL = 'https://example.com/verify/payslip/sample';

const previewInput = z.object({
  config: payslipConfigSchema,
  payslipId: uuid.optional(),
  lang: z.enum(['ar', 'en']).optional(),
});

/** /payroll/payslip-templates: قوالب تصميم القسيمة (إدارة + معاينة) */
export const createPayslipTemplatesRouter = (
  db: Db,
  authenticate: RequestHandler,
  files: FileDeps,
  verify?: VerifyDeps,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/',
    requirePermission(READ),
    wrap(async (req, res) => {
      const data = await run(req, async (ctx) => {
        const rows = await ctx.trx
          .selectFrom('payslipTemplates')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .orderBy('isDefault', 'desc')
          .orderBy('nameAr')
          .execute();
        return rows.map(toDto);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const b = payslipTemplateInput.parse(req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .insertInto('payslipTemplates')
          .values({
            companyId: ctx.companyId,
            nameAr: b.nameAr,
            nameEn: b.nameEn,
            config: JSON.stringify(b.config),
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
      res.status(201).json({ data: toDto(row) });
    }),
  );

  // معاينة حيّة: HTML كامل بإعدادات غير محفوظة (قسيمة حقيقية بنطاقها أو عيّنة)
  // Live preview: full HTML with unsaved settings (a real payslip within scope, or a sample)
  router.post(
    '/preview',
    requirePermission(READ),
    wrap(async (req, res) => {
      const b = previewInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const html = await run(req, async (ctx) => {
        if (b.payslipId) {
          const scope = employeeScope(auth, 'payroll.payslip.read');
          const ok =
            await sql`select 1 from payslips s join employees on employees.id = s.employee_id
                                where s.id = ${b.payslipId} and s.company_id = ${ctx.companyId}
                                  ${scope ? sql`and ${scope}` : sql``}`.execute(ctx.trx);
          if (!ok.rows.length) throw new AppError('NOT_FOUND', 404, 'القسيمة غير موجودة');
          const d = await loadPayslipDoc(ctx, b.payslipId);
          return buildPayslipHtml(ctx, files, d, b.lang, b.config, verify);
        }
        const lang = resolveLang(b.config, b.lang, await companyLang(ctx));
        const lh = await loadLetterhead(ctx, files, lang);
        // رمز تجريبي ليرى المصمِّم موضعه (لا يُفحص)؛ sample QR so the designer sees its placement (not scannable-valid)
        const qr = b.config.sections.includes('qr')
          ? {
              url: SAMPLE_QR_URL,
              dataUrl: await payslipQrDataUrl(SAMPLE_QR_URL),
            }
          : null;
        return wrapLetterHtml(
          renderPayslipBody(SAMPLE, { ...SAMPLE_EXTRAS, qr }, b.config, lang),
          lang,
          lh,
        );
      });
      // هوامش الصفحة (@page) لا تعمل داخل iframe: نحاكيها في المعاينة فقط كي تطابق الطباعة
      // @page margins do not apply inside an iframe: emulate them in the preview only so it matches print
      res.json({
        data: { html: html.replace('</head>', '<style>body{padding:22mm 20mm}</style></head>') },
      });
    }),
  );

  router.put(
    '/:id',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = payslipTemplateInput
        .extend({ version: z.number().int().positive() })
        .parse(req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .updateTable('payslipTemplates')
          .set({
            nameAr: b.nameAr,
            nameEn: b.nameEn,
            config: JSON.stringify(b.config),
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .where('version', '=', b.version)
          .returningAll()
          .executeTakeFirst(),
      );
      if (!row) {
        const exists = await run(req, (ctx) =>
          ctx.trx
            .selectFrom('payslipTemplates')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst(),
        );
        throw exists
          ? new AppError('VERSION_CONFLICT', 409, 'تم تعديل القالب من مستخدم آخر، أعد التحميل')
          : new AppError('NOT_FOUND', 404, 'القالب غير موجود');
      }
      res.json({ data: toDto(row) });
    }),
  );

  router.post(
    '/:id/default',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      await run(req, async (ctx) => {
        const found = await ctx.trx
          .selectFrom('payslipTemplates')
          .select('id')
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!found) throw new AppError('NOT_FOUND', 404, 'القالب غير موجود');
        // الفهرس الفريد يسمح بافتراضي واحد: نُلغي القديم أولاً داخل نفس المعاملة
        await ctx.trx
          .updateTable('payslipTemplates')
          .set({ isDefault: false })
          .where('companyId', '=', ctx.companyId)
          .where('isDefault', '=', true)
          .execute();
        await ctx.trx
          .updateTable('payslipTemplates')
          .set({ isDefault: true })
          .where('id', '=', id)
          .execute();
      });
      res.status(204).end();
    }),
  );

  // العودة للتصميم المدمج (بلا قالب افتراضي) / back to the built-in design (no default template)
  router.post(
    '/use-builtin',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      await run(req, (ctx) =>
        ctx.trx
          .updateTable('payslipTemplates')
          .set({ isDefault: false })
          .where('companyId', '=', ctx.companyId)
          .where('isDefault', '=', true)
          .execute(),
      );
      res.status(204).end();
    }),
  );

  router.delete(
    '/:id',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const r = await run(req, (ctx) =>
        ctx.trx
          .deleteFrom('payslipTemplates')
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst(),
      );
      if (!r.numDeletedRows) throw new AppError('NOT_FOUND', 404, 'القالب غير موجود');
      res.status(204).end();
    }),
  );

  return router;
};
