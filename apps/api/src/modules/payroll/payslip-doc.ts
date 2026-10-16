import { sql } from 'kysely';
import { num, wrapLetterHtml } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { loadLetterhead } from '../brand/index.js';

type Row = Record<string, unknown>;
export type Lang = 'ar' | 'en';

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const ltr = (s: string): string => `<span dir="ltr" style="unicode-bidi:isolate">${esc(s)}</span>`;

/** مبلغ بخانتين على الأقل وبلا أصفار زائدة بعدهما (لا تقريب يخفي الفلس). */
export const fmtAmount = (v: string): string => {
  const s = num(v).toFixed(4).replace(/0+$/, '');
  const [i, d = ''] = s.split('.');
  return `${i}.${d.padEnd(2, '0')}`;
};

const L = {
  ar: {
    title: 'قسيمة راتب',
    employee: 'الموظف',
    no: 'الرقم الوظيفي',
    period: 'الفترة',
    currency: 'العملة',
    earnings: 'الاستحقاقات',
    deductions: 'الاستقطاعات',
    item: 'البند',
    amount: 'المبلغ',
    gross: 'إجمالي الاستحقاقات',
    totalDed: 'إجمالي الاستقطاعات',
    net: 'صافي الراتب',
    loans: 'قسط السلفة',
    payable: 'المستحق للدفع',
    loanLine: 'السلفة',
    deferred: 'مؤجَّل لعدم كفاية الصافي',
    note: 'صدرت هذه القسيمة إلكترونياً.',
  },
  en: {
    title: 'Payslip',
    employee: 'Employee',
    no: 'Employee No.',
    period: 'Period',
    currency: 'Currency',
    earnings: 'Earnings',
    deductions: 'Deductions',
    item: 'Item',
    amount: 'Amount',
    gross: 'Gross earnings',
    totalDed: 'Total deductions',
    net: 'Net salary',
    loans: 'Loan installment',
    payable: 'Payable',
    loanLine: 'Loan',
    deferred: 'Deferred: insufficient net',
    note: 'This payslip was issued electronically.',
  },
} as const;

export type PayslipDoc = {
  id: string;
  employeeId: string;
  employeeNo: string | null;
  nameAr: string;
  nameEn: string | null;
  year: number;
  month: number;
  currency: string;
  periodStatus: string;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
  earnings: { code: string; nameAr: string; nameEn: string | null; amount: string }[];
  deductionLines: { code: string; nameAr: string; nameEn: string | null; amount: string }[];
  loanItems: { amount: string; overCap: boolean; no: number; count: number }[];
};

/** بيانات قسيمة للعرض أو الـ PDF (بلا بنود «تتحمّلها الشركة»). */
export const loadPayslipDoc = async (ctx: Ctx, slipId: string): Promise<PayslipDoc> => {
  const { rows } = await sql<Row>`
    select s.id, s.employee_id, e.employee_no, e.full_name_ar as name_ar, e.full_name_en as name_en,
           p.year, p.month, s.currency, p.status as period_status, s.status as slip_status,
           s.gross_amount::text as gross, s.deductions_amount::text as deductions, s.net_amount::text as net,
           s.loans_amount::text as loans, s.payable_amount::text as payable
      from payslips s join employees e on e.id = s.employee_id join payroll_periods p on p.id = s.period_id
     where s.id = ${slipId} and s.company_id = ${ctx.companyId}`.execute(ctx.trx);
  const r = rows[0];
  if (!r || r.slipStatus !== 'calculated')
    throw new AppError('NOT_FOUND', 404, 'القسيمة غير موجودة');
  const { rows: lines } = await sql<Row>`
    select code, name_ar, name_en, kind, amount::text as amount from payslip_lines
     where payslip_id = ${slipId} and kind <> 'employer' order by sort_order, code`.execute(
    ctx.trx,
  );
  const { rows: items } = await sql<Row>`
    select it.amount::text as amount, it.over_cap, i.no, l.installments_count as count
      from payslip_loan_items it join loan_installments i on i.id = it.installment_id
      join loans l on l.id = i.loan_id
     where it.payslip_id = ${slipId} order by i.due_year, i.due_month, i.no`.execute(ctx.trx);
  const pick = (l: Row) => ({
    code: l.code as string,
    nameAr: l.nameAr as string,
    nameEn: (l.nameEn as string | null) ?? null,
    amount: l.amount as string,
  });
  return {
    id: r.id as string,
    employeeId: r.employeeId as string,
    employeeNo: (r.employeeNo as string | null) ?? null,
    nameAr: r.nameAr as string,
    nameEn: (r.nameEn as string | null) ?? null,
    year: Number(r.year),
    month: Number(r.month),
    currency: r.currency as string,
    periodStatus: r.periodStatus as string,
    gross: r.gross as string,
    deductions: r.deductions as string,
    net: r.net as string,
    loans: r.loans as string,
    payable: r.payable as string,
    earnings: lines.filter((l) => l.kind === 'earning').map(pick),
    deductionLines: lines.filter((l) => l.kind === 'deduction').map(pick),
    loanItems: items.map((i) => ({
      amount: i.amount as string,
      overCap: Boolean(i.overCap),
      no: Number(i.no),
      count: Number(i.count),
    })),
  };
};

export const companyLang = async (ctx: Ctx): Promise<Lang> => {
  const { rows } = await sql<{ defaultLocale: string }>`
    select default_locale from companies where id = ${ctx.companyId}`.execute(ctx.trx);
  return rows[0]?.defaultLocale === 'en' ? 'en' : 'ar';
};

/** HTML القسيمة كاملاً (مع الترويسة والتذييل بلغة القسيمة). */
export const buildPayslipHtml = async (
  ctx: Ctx,
  files: FileDeps,
  d: PayslipDoc,
  lang: Lang,
): Promise<string> => {
  const t = L[lang];
  const name = lang === 'en' ? d.nameEn || d.nameAr : d.nameAr || d.nameEn || '';
  const label = (l: { nameAr: string; nameEn: string | null }) =>
    esc(lang === 'en' ? l.nameEn || l.nameAr : l.nameAr || l.nameEn || '');
  const section = (title: string, list: PayslipDoc['earnings']) =>
    list.length
      ? `<h3 style="margin:14px 0 4px">${esc(title)}</h3><table><thead><tr><th style="text-align:start">${t.item}</th><th style="width:140px;text-align:end">${t.amount}</th></tr></thead><tbody>${list
          .map(
            (l) =>
              `<tr><td>${label(l)}</td><td style="text-align:end">${ltr(fmtAmount(l.amount))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';
  const total = (title: string, v: string, strong = false) =>
    `<tr><td style="${strong ? 'font-weight:bold;' : ''}">${esc(title)}</td><td style="width:140px;text-align:end;${strong ? 'font-weight:bold;' : ''}">${ltr(fmtAmount(v))}</td></tr>`;
  const hasLoans = d.loanItems.length > 0;
  const loanNotes = d.loanItems
    .map(
      (i) =>
        `<div style="font-size:10pt;color:#444">${t.loanLine} ${ltr(`${i.no}/${i.count}`)}: ${ltr(fmtAmount(i.amount))}${i.overCap ? ` — ${t.deferred}` : ''}</div>`,
    )
    .join('');
  const body = `
<h2 style="text-align:center;margin:0 0 8px">${t.title}</h2>
<table><tbody>
<tr><td>${t.employee}</td><td>${esc(name)}</td><td>${t.no}</td><td>${ltr(d.employeeNo ?? '—')}</td></tr>
<tr><td>${t.period}</td><td>${ltr(`${d.year}-${String(d.month).padStart(2, '0')}`)}</td><td>${t.currency}</td><td>${ltr(d.currency)}</td></tr>
</tbody></table>
${section(t.earnings, d.earnings)}
${section(t.deductions, d.deductionLines)}
<table style="margin-top:14px"><tbody>
${total(t.gross, d.gross)}
${total(t.totalDed, d.deductions)}
${total(t.net, d.net, true)}
${hasLoans ? total(t.loans, d.loans) : ''}
${hasLoans ? total(t.payable, d.payable, true) : ''}
</tbody></table>
${loanNotes}
<p style="font-size:10pt;color:#666;margin-top:18px">${t.note}</p>`;
  const lh = await loadLetterhead(ctx, files, lang);
  return wrapLetterHtml(body, lang, lh);
};
