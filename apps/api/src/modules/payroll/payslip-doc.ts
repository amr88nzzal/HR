import { sql } from 'kysely';
import { num } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

type Row = Record<string, unknown>;
export type Lang = 'ar' | 'en';

/** مبلغ بخانتين على الأقل وبلا أصفار زائدة بعدهما (لا تقريب يخفي الفلس). */
export const fmtAmount = (v: string): string => {
  const s = num(v).toFixed(4).replace(/0+$/, '');
  const [i, d = ''] = s.split('.');
  return `${i}.${d.padEnd(2, '0')}`;
};

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
  loanItems: {
    amount: string;
    overCap: boolean;
    no: number;
    count: number;
    typeNameAr: string;
    typeNameEn: string;
    reference: string | null;
    eventDate: string;
  }[];
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
    select it.amount::text as amount, it.over_cap, i.no, l.installments_count as count,
           lt.name_ar as type_name_ar, lt.name_en as type_name_en, l.reference, l.event_date::text as event_date
      from payslip_loan_items it join loan_installments i on i.id = it.installment_id
      join loans l on l.id = i.loan_id join loan_types lt on lt.id = l.type_id
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
      typeNameAr: i.typeNameAr as string,
      typeNameEn: i.typeNameEn as string,
      reference: (i.reference as string | null) ?? null,
      eventDate: i.eventDate as string,
    })),
  };
};

export const companyLang = async (ctx: Ctx): Promise<Lang> => {
  const { rows } = await sql<{ defaultLocale: string }>`
    select default_locale from companies where id = ${ctx.companyId}`.execute(ctx.trx);
  return rows[0]?.defaultLocale === 'en' ? 'en' : 'ar';
};
