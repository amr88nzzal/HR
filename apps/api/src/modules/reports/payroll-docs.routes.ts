import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { wrapLetterHtml } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { loadLetterhead } from '../brand/index.js';
import { BANK_IBAN_AAD, employeeScope } from '../employees/index.js';
import { requirePermission, type AuthContext } from '../identity/index.js';
import type { Renderer } from '../letters/index.js';
import { fmtAmount, makeRun } from '../payroll/index.js';
import { buildExport, MIME, type ExportFormat, type Lang } from './export.js';
import type { ReportColumn, Row } from './types.js';

/**
 * مستندات الرواتب المطبوعة/المصدَّرة لدورة واحدة: ملف البنك، كشف الإدارة للتوقيع، وقيد المحاسبة.
 * Per-period payroll documents: bank transfer file, management sign-off sheet, accounting journal.
 */
export type PayrollDocsDeps = {
  files: FileDeps;
  render: Renderer | undefined;
  crypto: FieldCrypto | undefined;
};

const uuid = z.string().uuid();
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const query = z.object({
  lang: z.enum(['ar', 'en']).default('ar'),
  format: z.string().optional(),
});

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Period = { id: string; year: number; month: number; currency: string; status: string };
const loadPeriod = async (ctx: Ctx, id: string): Promise<Period> => {
  const { rows } = await sql<Period>`
    select id, year, month, currency, status from payroll_periods
     where id = ${id} and company_id = ${ctx.companyId}`.execute(ctx.trx);
  const p = rows[0];
  if (!p) throw new AppError('NOT_FOUND', 404, 'الدورة غير موجودة');
  return p;
};
const ym = (p: Period) => `${p.year}-${String(p.month).padStart(2, '0')}`;

const col = (
  key: string,
  ar: string,
  en: string,
  type: ReportColumn['type'] = 'text',
): ReportColumn => ({ key, labelAr: ar, labelEn: en, type });

const send = (res: Response, buf: Buffer, format: ExportFormat, name: string) => {
  res.setHeader('Content-Type', MIME[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
};

const once = async function* (rows: Row[]): AsyncIterable<Row[]> {
  yield rows;
};

const pickFormat = (v: string | undefined, allowed: ExportFormat[]): ExportFormat => {
  const f = (v ?? allowed[0]) as ExportFormat;
  if (!allowed.includes(f))
    throw new AppError('VALIDATION_ERROR', 400, `الصيغة المسموحة: ${allowed.join(' / ')}`);
  return f;
};

const T = {
  ar: {
    title: 'كشف رواتب',
    period: 'الدورة',
    no: '#',
    empNo: 'الرقم الوظيفي',
    name: 'الاسم',
    gross: 'الإجمالي',
    ded: 'الاستقطاعات',
    net: 'الصافي',
    loans: 'السلف',
    payable: 'المستحق',
    dept: 'القسم',
    subtotal: 'مجموع القسم',
    total: 'المجموع الكلي',
    count: 'عدد الموظفين',
    draft: 'مسودة — غير معتمدة بعد',
    prepared: 'أعدّه',
    reviewed: 'راجعه',
    approved: 'اعتمده',
    date: 'التاريخ',
    sign: 'التوقيع',
    none: '—',
  },
  en: {
    title: 'Payroll sheet',
    period: 'Period',
    no: '#',
    empNo: 'Emp. No.',
    name: 'Name',
    gross: 'Gross',
    ded: 'Deductions',
    net: 'Net',
    loans: 'Loans',
    payable: 'Payable',
    dept: 'Department',
    subtotal: 'Department subtotal',
    total: 'Grand total',
    count: 'Employees',
    draft: 'DRAFT — not approved yet',
    prepared: 'Prepared by',
    reviewed: 'Reviewed by',
    approved: 'Approved by',
    date: 'Date',
    sign: 'Signature',
    none: '—',
  },
} as const;

type SheetRow = {
  dept: string;
  empNo: string;
  name: string;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
};

const sum = (
  rows: SheetRow[],
  k: keyof Pick<SheetRow, 'gross' | 'deductions' | 'net' | 'loans' | 'payable'>,
) => rows.reduce((a, r) => a + Number(r[k]), 0).toFixed(4);

/** HTML كشف الإدارة: جدول حسب القسم مع مجاميع وأسطر توقيع / management sheet HTML: per-department table, totals, sign-off lines */
export const sheetBody = (p: Period, rows: SheetRow[], lang: Lang): string => {
  const t = T[lang];
  const cell = 'padding:3px 6px;border:1px solid #bbb';
  const num = (v: string) =>
    `<span dir="ltr" style="unicode-bidi:isolate">${esc(fmtAmount(v))}</span>`;
  const depts = [...new Set(rows.map((r) => r.dept))];
  let n = 0;
  const totalRow = (label: string, list: SheetRow[], strong = false) =>
    `<tr style="background:#f1f1f1;font-weight:${strong ? 'bold' : '600'}"><td colspan="3" style="${cell}">${esc(label)} (${list.length})</td>${(
      ['gross', 'deductions', 'net', 'loans', 'payable'] as const
    )
      .map((k) => `<td style="${cell};text-align:end">${num(sum(list, k))}</td>`)
      .join('')}</tr>`;
  const body = depts
    .map((d) => {
      const list = rows.filter((r) => r.dept === d);
      return `<tr><td colspan="8" style="${cell};background:#e6efec;font-weight:bold">${esc(d)}</td></tr>${list
        .map(
          (r) =>
            `<tr><td style="${cell}">${++n}</td><td style="${cell}">${esc(r.empNo)}</td><td style="${cell}">${esc(r.name)}</td>${(
              ['gross', 'deductions', 'net', 'loans', 'payable'] as const
            )
              .map((k) => `<td style="${cell};text-align:end">${num(r[k])}</td>`)
              .join('')}</tr>`,
        )
        .join('')}${totalRow(t.subtotal, list)}`;
    })
    .join('');
  const sign = (label: string) =>
    `<td style="width:33%;padding:30px 10px 0;vertical-align:bottom"><div style="border-top:1px solid #444;padding-top:4px">${label}<br/><span style="font-size:0.85em;color:#555">${t.date}: ____ / ____ / ________</span></div></td>`;
  return `<div style="font-size:9pt">
<h2 style="text-align:center;margin:0 0 4px">${t.title}</h2>
<div style="text-align:center;margin-bottom:8px">${t.period}: <span dir="ltr" style="unicode-bidi:isolate">${ym(p)}</span> · <span dir="ltr" style="unicode-bidi:isolate">${esc(p.currency)}</span></div>
${p.status === 'draft' ? `<div style="text-align:center;color:#b42318;font-weight:bold;margin-bottom:6px">${t.draft}</div>` : ''}
<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#0f766e;color:#fff">${[
    t.no,
    t.empNo,
    t.name,
    t.gross,
    t.ded,
    t.net,
    t.loans,
    t.payable,
  ]
    .map((h) => `<th style="${cell}">${h}</th>`)
    .join('')}</tr></thead><tbody>${body}${totalRow(t.total, rows, true)}</tbody></table>
<table style="width:100%;border-collapse:collapse;margin-top:34px"><tbody><tr>${sign(t.prepared)}${sign(t.reviewed)}${sign(t.approved)}</tr></tbody></table>
</div>`;
};

export const createPayrollDocsRouter = (
  db: Db,
  authenticate: RequestHandler,
  deps: PayrollDocsDeps,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  const authOf = (req: Request) => req.auth as AuthContext;

  // ───── ملف تحويل البنك ─────
  router.get(
    '/:id/bank-transfer',
    requirePermission('payroll.bank_transfer.export'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = query.parse(req.query);
      const check = q.format === 'check';
      const format = pickFormat(check ? 'xlsx' : q.format, ['xlsx', 'csv']);
      const includePaid = req.query['includePaid'] === '1';
      if (!deps.crypto)
        throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
      const crypto = deps.crypto;
      const out = await run(req, async (ctx) => {
        const p = await loadPeriod(ctx, id);
        if (p.status === 'draft')
          throw new AppError('PERIOD_NOT_APPROVED', 409, 'اعتمد الدورة قبل تصدير ملف البنك');
        const { rows } = await sql<Row>`
          select e.employee_no, pm.amount::text as amount, pm.currency,
                 b.bank_name, b.account_holder, b.iban_enc, e.full_name_ar as name
            from payments pm
            join employees e on e.id = pm.employee_id
            left join lateral (
              select * from employee_bank_accounts a
               where a.employee_id = e.id and a.valid_to is null
               order by a.is_primary desc, a.created_at limit 1) b on true
           where pm.period_id = ${id} and pm.company_id = ${ctx.companyId} and pm.kind = 'payslip'
             and pm.amount > 0 ${includePaid ? sql`` : sql`and pm.status = 'pending'`}
           order by e.employee_no nulls last, e.full_name_ar`.execute(ctx.trx);
        const lines: Row[] = [];
        const missing: { employeeNo: unknown; name: unknown }[] = [];
        let skipped = 0;
        let total = 0;
        for (const r of rows) {
          if (!r.ibanEnc) {
            skipped++;
            missing.push({ employeeNo: r.employeeNo ?? '', name: r.name });
            continue;
          }
          total += Number(r.amount);
          lines.push({
            seq: lines.length + 1,
            employeeNo: r.employeeNo ?? '',
            beneficiary: (r.accountHolder as string | null) || r.name,
            bank: r.bankName,
            iban: check ? '' : crypto.decrypt(r.ibanEnc as string, BANK_IBAN_AAD),
            amount: r.amount,
            currency: r.currency,
            reference: `PAY-${ym(p)}-${r.employeeNo ?? lines.length + 1}`,
          });
        }
        // الفحص لا يفكّ التشفير ولا يُسجَّل؛ أما التصدير فيكشف IBAN كاملاً فيُسجَّل دائماً
        // The check never reveals IBANs and is not logged; an export reveals full IBANs so it is always audited
        if (check) return { p, lines: [], skipped, missing, total, count: lines.length };
        await ctx.trx
          .insertInto('auditLogs')
          .values({
            companyId: ctx.companyId,
            userId: ctx.userId,
            entityType: 'payroll_periods',
            entityId: id,
            action: 'export_bank_file',
            changes: JSON.stringify({ rows: lines.length, skippedNoIban: skipped, format }),
            requestId: ctx.requestId,
            ip: req.ip ?? null,
          })
          .execute();
        return { p, lines, skipped, missing, total, count: lines.length };
      });
      if (check) {
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          data: {
            rows: out.count,
            total: out.total.toFixed(4),
            currency: out.p.currency,
            missing: out.missing,
          },
        });
        return;
      }
      const cols = [
        col('seq', '#', '#', 'number'),
        col('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        col('beneficiary', 'المستفيد', 'Beneficiary'),
        col('bank', 'البنك', 'Bank'),
        col('iban', 'IBAN', 'IBAN'),
        col('amount', 'المبلغ', 'Amount', 'money'),
        col('currency', 'العملة', 'Currency'),
        col('reference', 'المرجع', 'Reference'),
      ];
      const built = await buildExport(format, cols, once(out.lines), {
        title: pick(q.lang, 'ملف تحويل الرواتب', 'Bank transfer file'),
        lang: q.lang,
        filtersText: '',
      });
      res.setHeader('X-Rows', String(out.lines.length));
      res.setHeader('X-Skipped-No-Iban', String(out.skipped));
      send(res, built.buffer, format, `bank-transfer-${ym(out.p)}.${format}`);
    }),
  );

  // ───── كشف الإدارة للتوقيع ─────
  router.get(
    '/:id/management-sheet',
    requirePermission('payroll.payslip.read'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = query.parse(req.query);
      const format = pickFormat(q.format, ['pdf', 'xlsx']);
      const auth = authOf(req);
      const out = await run(req, async (ctx) => {
        const p = await loadPeriod(ctx, id);
        const scope = employeeScope(auth, 'payroll.payslip.read');
        const { rows } = await sql<Row>`
          select coalesce(d.name_ar, '—') as dept, coalesce(employees.employee_no, '') as emp_no,
                 employees.full_name_ar as name, s.gross_amount::text as gross,
                 s.deductions_amount::text as deductions, s.net_amount::text as net,
                 s.loans_amount::text as loans, s.payable_amount::text as payable
            from payslips s
            join employees on employees.id = s.employee_id
            join payroll_periods p on p.id = s.period_id
            left join lateral (
              select * from employments m
               where m.employee_id = employees.id and m.valid_from <= p.end_date
                 and (m.valid_to is null or m.valid_to >= p.start_date)
               order by m.valid_from desc limit 1) em on true
            left join departments d on d.id = em.department_id
           where s.period_id = ${id} and s.company_id = ${ctx.companyId} and s.status = 'calculated'
             ${scope ? sql`and ${scope}` : sql``}
           order by d.name_ar nulls last, employees.employee_no nulls last`.execute(ctx.trx);
        const letterhead =
          format === 'pdf' ? await loadLetterhead(ctx, deps.files, q.lang) : undefined;
        return { p, rows: rows as unknown as SheetRow[], letterhead };
      });
      if (!out.rows.length)
        throw new AppError('NOT_FOUND', 404, 'لا توجد قسائم محتسبة في هذه الدورة');
      let buf: Buffer;
      if (format === 'pdf') {
        if (!deps.render)
          throw new AppError('RENDER_NOT_CONFIGURED', 503, 'خدمة تحويل PDF غير مهيّأة');
        buf = await deps.render(
          wrapLetterHtml(sheetBody(out.p, out.rows, q.lang), q.lang, out.letterhead),
        );
      } else {
        const cols = [
          col('dept', 'القسم', 'Department'),
          col('empNo', 'الرقم الوظيفي', 'Employee No.'),
          col('name', 'الاسم', 'Name'),
          col('gross', 'الإجمالي', 'Gross', 'money'),
          col('deductions', 'الاستقطاعات', 'Deductions', 'money'),
          col('net', 'الصافي', 'Net', 'money'),
          col('loans', 'السلف', 'Loans', 'money'),
          col('payable', 'المستحق', 'Payable', 'money'),
        ];
        buf = (
          await buildExport('xlsx', cols, once(out.rows as unknown as Row[]), {
            title: pick(q.lang, 'كشف الرواتب', 'Payroll sheet'),
            lang: q.lang,
            filtersText: '',
          })
        ).buffer;
      }
      send(res, buf, format, `payroll-sheet-${ym(out.p)}.${format}`);
    }),
  );

  // ───── قيد المحاسبة ─────
  router.get(
    '/:id/journal',
    requirePermission('payroll.accounting.read'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = query.parse(req.query);
      const check = q.format === 'check';
      const format = pickFormat(check ? 'xlsx' : q.format, ['xlsx', 'csv']);
      const out = await run(req, async (ctx) => {
        const p = await loadPeriod(ctx, id);
        if (p.status === 'draft')
          throw new AppError('PERIOD_NOT_APPROVED', 409, 'اعتمد الدورة قبل تصدير القيد');
        const en = q.lang === 'en';
        const { rows } = await sql<Row>`
          with base as (
            select s.id as slip_id, s.loans_amount, s.payable_amount, l.kind, l.code, l.amount,
                   pc.gl_account, pc.gl_offset_account,
                   case when ${en} then coalesce(l.name_en, l.name_ar) else l.name_ar end as descr,
                   coalesce(cc.code, d.name_ar, '—') as dim
              from payslips s
              join payroll_periods p on p.id = s.period_id
              join payslip_lines l on l.payslip_id = s.id
              left join pay_components pc on pc.id = l.component_id
              left join lateral (
                select * from employments m
                 where m.employee_id = s.employee_id and m.valid_from <= p.end_date
                   and (m.valid_to is null or m.valid_to >= p.start_date)
                 order by m.valid_from desc limit 1) em on true
              left join cost_centers cc on cc.id = em.cost_center_id
              left join departments d on d.id = em.department_id
             where s.period_id = ${id} and s.company_id = ${ctx.companyId} and s.status = 'calculated'
          ), slips as (
            select s.id, s.loans_amount, s.payable_amount from payslips s
             where s.period_id = ${id} and s.company_id = ${ctx.companyId} and s.status = 'calculated'
          ), gs as (
            select * from payroll_gl_settings where company_id = ${ctx.companyId}
          )
          select 'debit' as side, 1 as ord,
                 coalesce(b.gl_account, (select default_expense from gs), 'UNMAPPED') as account,
                 b.dim, b.descr, sum(b.amount)::text as amount
            from base b where b.kind in ('earning', 'employer')
           group by 3, b.dim, b.code, b.descr having sum(b.amount) <> 0
          union all
          select 'credit', 2, coalesce(b.gl_offset_account, 'UNMAPPED'), '', b.descr, sum(b.amount)::text
            from base b where b.kind = 'employer'
           group by 3, b.code, b.descr having sum(b.amount) <> 0
          union all
          select 'credit', 3, coalesce(b.gl_account, 'UNMAPPED'), '', b.descr, sum(b.amount)::text
            from base b where b.kind = 'deduction'
           group by 3, b.code, b.descr having sum(b.amount) <> 0
          union all
          select 'credit', 4, coalesce((select loans_receivable from gs), 'UNMAPPED'), '',
                 ${en ? 'Loan installments' : 'أقساط السلف'}, sum(loans_amount)::text
            from slips having sum(loans_amount) <> 0
          union all
          select 'credit', 5, coalesce((select salaries_payable from gs), 'UNMAPPED'), '',
                 ${en ? 'Net salaries payable' : 'صافي الرواتب المستحقة'}, sum(payable_amount)::text
            from slips having sum(payable_amount) <> 0
          order by 2, 3, 4`.execute(ctx.trx);
        return { p, rows };
      });
      const date = new Date(Date.UTC(out.p.year, out.p.month, 0)).toISOString().slice(0, 10);
      let debit = 0;
      let credit = 0;
      let unmapped = 0;
      const lines: Row[] = out.rows.map((r) => {
        const amt = Number(r.amount);
        if (r.side === 'debit') debit += amt;
        else credit += amt;
        if (r.account === 'UNMAPPED') unmapped++;
        return {
          date,
          reference: `PAYROLL-${ym(out.p)}`,
          account: r.account,
          costCenter: r.dim,
          description: r.descr,
          debit: r.side === 'debit' ? r.amount : null,
          credit: r.side === 'credit' ? r.amount : null,
        };
      });
      const cols = [
        col('date', 'التاريخ', 'Date', 'date'),
        col('reference', 'المرجع', 'Reference'),
        col('account', 'الحساب', 'Account'),
        col('costCenter', 'مركز التكلفة / القسم', 'Cost center / Dept'),
        col('description', 'البيان', 'Description'),
        col('debit', 'مدين', 'Debit', 'money'),
        col('credit', 'دائن', 'Credit', 'money'),
      ];
      if (check) {
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          data: {
            debit: debit.toFixed(4),
            credit: credit.toFixed(4),
            balanced: Math.abs(debit - credit) < 0.00005,
            unmapped: out.rows
              .filter((r) => r.account === 'UNMAPPED')
              .map((r) => ({ side: r.side, description: r.descr })),
            currency: out.p.currency,
          },
        });
        return;
      }
      const built = await buildExport(format, cols, once(lines), {
        title: pick(q.lang, 'قيد رواتب', 'Payroll journal'),
        lang: q.lang,
        filtersText: '',
      });
      res.setHeader('X-Debit-Total', debit.toFixed(4));
      res.setHeader('X-Credit-Total', credit.toFixed(4));
      res.setHeader('X-Balanced', String(Math.abs(debit - credit) < 0.00005));
      res.setHeader('X-Unmapped', String(unmapped));
      send(res, built.buffer, format, `payroll-journal-${ym(out.p)}.${format}`);
    }),
  );
  return router;
};

const pick = (l: Lang, ar: string, en: string) => (l === 'en' ? en : ar);
