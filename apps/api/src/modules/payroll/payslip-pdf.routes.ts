import { Router, type Request, type RequestHandler, type Response } from 'express';
import PizZip from 'pizzip';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { employeeScope } from '../employees/index.js';
import { requirePermission } from '../identity/index.js';
import type { Renderer } from '../letters/index.js';
import { loadPayslipDoc, type Lang, type PayslipDoc } from './payslip-doc.js';
import { buildPayslipHtml } from './payslip-html.js';
import { makeRun } from './setup.routes.js';

type Row = Record<string, unknown>;
const uuid = z.string().uuid();
const langQuery = z.object({ lang: z.enum(['ar', 'en']).optional() });
const SLIP = 'payroll.payslip.read';
const MAX_ZIP = 500;
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const notFound = () => new AppError('NOT_FOUND', 404, 'القسيمة غير موجودة');

export type PdfDeps = { files: FileDeps; render: Renderer | undefined };

const needRender = (deps: PdfDeps): Renderer => {
  if (!deps.render) throw new AppError('RENDER_NOT_CONFIGURED', 503, 'خدمة تحويل PDF غير مهيّأة');
  return deps.render;
};

const sendPdf = (res: Response, pdf: Buffer, name: string) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
};

const fileName = (d: PayslipDoc) =>
  `payslip-${(d.employeeNo ?? d.employeeId).replace(/[^A-Za-z0-9_-]/g, '_')}-${d.year}-${String(d.month).padStart(2, '0')}.pdf`;

/** PDF القسيمة يُولَّد عند الطلب (لا يُخزَّن) فيطابق دائماً الأرقام الحالية والترويسة الحالية. */
const pdfOf = async (ctx: Ctx, deps: PdfDeps, d: PayslipDoc, lang?: Lang): Promise<Buffer> =>
  needRender(deps)(await buildPayslipHtml(ctx, deps.files, d, lang));

/** HR: /payroll/payslips/:id/pdf و/payroll/periods/:id/payslips.zip */
export const createPayslipPdfRouter = (
  db: Db,
  authenticate: RequestHandler,
  deps: PdfDeps,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/payslips/:id/pdf',
    requirePermission(`${SLIP}`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = langQuery.parse(req.query);
      const auth = req.auth as NonNullable<Request['auth']>;
      const out = await run(req, async (ctx) => {
        const scope = employeeScope(auth, SLIP);
        if (scope) {
          const ok =
            await sql`select 1 from payslips s join employees on employees.id = s.employee_id
                       where s.id = ${id} and ${scope}`.execute(ctx.trx);
          if (!ok.rows.length) throw notFound();
        }
        const d = await loadPayslipDoc(ctx, id);
        const pdf = await pdfOf(ctx, deps, d, q.lang);
        return { pdf, name: fileName(d) };
      });
      sendPdf(res, out.pdf, out.name);
    }),
  );

  router.get(
    '/periods/:id/payslips.zip',
    requirePermission(SLIP),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = langQuery.parse(req.query);
      const auth = req.auth as NonNullable<Request['auth']>;
      const zipBuf = await run(req, async (ctx) => {
        const scope = employeeScope(auth, SLIP);
        const { rows } = await sql<Row>`
          select s.id from payslips s join employees on employees.id = s.employee_id
           where s.period_id = ${id} and s.company_id = ${ctx.companyId} and s.status = 'calculated'
             ${scope ? sql`and ${scope}` : sql``} order by employees.employee_no`.execute(ctx.trx);
        if (!rows.length) throw new AppError('NOT_FOUND', 404, 'لا قسائم في الدورة');
        if (rows.length > MAX_ZIP)
          throw new AppError('TOO_MANY', 409, `الحد الأقصى ${MAX_ZIP} قسيمة في الملف الواحد`);
        const zip = new PizZip();
        const used = new Set<string>();
        for (const r of rows) {
          const d = await loadPayslipDoc(ctx, r.id as string);
          let name = fileName(d);
          for (let n = 2; used.has(name); n++) name = name.replace(/(\.pdf)$/, `-${n}$1`);
          used.add(name);
          zip.file(name, await pdfOf(ctx, deps, d, q.lang));
        }
        return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="payslips.zip"');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(zipBuf);
    }),
  );
  return router;
};

/** الموظف: /me/payslips — قسائمه هو فقط وبعد قفل الدورة (لا صلاحية خاصة، كبقية مسارات /me). */
export const createMyPayslipsRouter = (
  db: Db,
  authenticate: RequestHandler,
  deps: PdfDeps,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  const myEmployee = async (ctx: Ctx, userId: string): Promise<string> => {
    const e = await ctx.trx
      .selectFrom('employees')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('userId', '=', userId)
      .executeTakeFirst();
    if (!e) throw new AppError('NO_EMPLOYEE', 409, 'حسابك غير مرتبط بملف موظف');
    return e.id;
  };
  /** يتأكد أن القسيمة له ودورتها مقفلة، وإلا 404 (لا يكشف وجود قسائم الآخرين) */
  const mine = async (ctx: Ctx, userId: string, slipId: string): Promise<PayslipDoc> => {
    const emp = await myEmployee(ctx, userId);
    const ok = await sql`
      select 1 from payslips s join payroll_periods p on p.id = s.period_id
       where s.id = ${slipId} and s.employee_id = ${emp} and s.company_id = ${ctx.companyId}
         and p.status = 'locked'`.execute(ctx.trx);
    if (!ok.rows.length) throw notFound();
    return loadPayslipDoc(ctx, slipId);
  };

  router.get(
    '/',
    wrap(async (req, res) => {
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const emp = await myEmployee(ctx, auth.userId);
        const { rows } = await sql<Row>`
          select s.id, p.year, p.month, s.currency, s.gross_amount::text as gross,
                 s.deductions_amount::text as deductions, s.net_amount::text as net,
                 s.loans_amount::text as loans, s.payable_amount::text as payable
            from payslips s join payroll_periods p on p.id = s.period_id
           where s.employee_id = ${emp} and s.company_id = ${ctx.companyId}
             and p.status = 'locked' and s.status = 'calculated'
           order by p.year desc, p.month desc`.execute(ctx.trx);
        return rows;
      });
      res.json({ data });
    }),
  );
  router.get(
    '/:id',
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => mine(ctx, auth.userId, id));
      res.json({ data });
    }),
  );
  router.get(
    '/:id/pdf',
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = langQuery.parse(req.query);
      const auth = req.auth as NonNullable<Request['auth']>;
      const out = await run(req, async (ctx) => {
        const d = await mine(ctx, auth.userId, id);
        return {
          pdf: await pdfOf(ctx, deps, d, q.lang),
          name: fileName(d),
        };
      });
      sendPdf(res, out.pdf, out.name);
    }),
  );
  return router;
};
