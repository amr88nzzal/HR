import { sql } from 'kysely';
import {
  payslipConfigSchema,
  PAYSLIP_PRESETS,
  wrapLetterHtml,
  type PayslipConfig,
} from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { loadLetterhead } from '../brand/index.js';
import { companyLang, type Lang, type PayslipDoc } from './payslip-doc.js';
import { renderPayslipBody, resolveLang, type PayslipExtras } from './payslip-render.js';

type Row = Record<string, unknown>;

/** قالب الشركة الافتراضي، وإلا التصميم العمودي المبسّط (يطابق القسيمة قبل ميزة القوالب) */
export const loadDefaultConfig = async (ctx: Ctx): Promise<PayslipConfig> => {
  const { rows } = await sql<{ config: unknown }>`
    select config from payslip_templates
     where company_id = ${ctx.companyId} and is_default`.execute(ctx.trx);
  const parsed = payslipConfigSchema.safeParse(rows[0]?.config);
  // قالب تالف لا يكسر الطباعة: نرجع للتصميم الافتراضي / a corrupt template never breaks printing
  return parsed.success ? parsed.data : PAYSLIP_PRESETS.stacked;
};

const fmtPrinted = (tz: string): string => {
  const now = new Date();
  try {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      dateStyle: 'short',
      timeStyle: 'short',
      hour12: false,
    });
    return f.format(now);
  } catch {
    return now.toISOString().slice(0, 16).replace('T', ' ');
  }
};

/** بيانات الرأس والتراكمي: تُحمَّل كلها دائماً (استعلامات صغيرة) والقالب يختار ما يعرضه */
export const loadPayslipExtras = async (ctx: Ctx, d: PayslipDoc): Promise<PayslipExtras> => {
  const { rows } = await sql<Row>`
    select e.first_hire_date::text as hire_date, s.basic_amount::text as basic,
           jt.name_ar as jt_ar, jt.name_en as jt_en,
           dp.name_ar as dp_ar, dp.name_en as dp_en,
           br.name_ar as br_ar, br.name_en as br_en,
           c.timezone
      from payslips s
      join employees e on e.id = s.employee_id
      join companies c on c.id = s.company_id
      left join lateral (
        select * from employments m
         where m.employee_id = e.id
           and m.valid_from <= (make_date(${d.year}, ${d.month}, 1) + interval '1 month - 1 day')::date
         order by m.valid_from desc limit 1) em on true
      left join job_titles jt on jt.id = em.job_title_id
      left join departments dp on dp.id = em.department_id
      left join branches br on br.id = em.branch_id
     where s.id = ${d.id} and s.company_id = ${ctx.companyId}`.execute(ctx.trx);
  const r = rows[0] ?? {};
  const name = (ar: unknown, en: unknown) =>
    ar ? { ar: ar as string, en: (en as string | null) ?? null } : null;
  const { rows: y } = await sql<Row>`
    select coalesce(sum(s.gross_amount), 0)::text as gross,
           coalesce(sum(s.deductions_amount), 0)::text as deductions,
           coalesce(sum(s.net_amount), 0)::text as net
      from payslips s join payroll_periods p on p.id = s.period_id
     where s.employee_id = ${d.employeeId} and s.company_id = ${ctx.companyId}
       and s.status = 'calculated' and p.year = ${d.year} and p.month <= ${d.month}`.execute(
    ctx.trx,
  );
  return {
    jobTitle: name(r.jtAr, r.jtEn),
    department: name(r.dpAr, r.dpEn),
    branch: name(r.brAr, r.brEn),
    hireDate: (r.hireDate as string | null) ?? null,
    basicSalary: (r.basic as string | null) ?? null,
    ytd: y[0]
      ? {
          gross: y[0].gross as string,
          deductions: y[0].deductions as string,
          net: y[0].net as string,
        }
      : null,
    printedAt: fmtPrinted((r.timezone as string | undefined) ?? 'UTC'),
  };
};

/**
 * HTML القسيمة كاملاً بتصميم قالب الشركة (مع الترويسة والتذييل بلغة القسيمة).
 * explicitLang من ?lang؛ وإلا لغة القالب ثم لغة الشركة.
 * Full payslip HTML in the company's template design (with letterhead and footer).
 * explicitLang comes from ?lang; otherwise the template language, then the company language.
 */
export const buildPayslipHtml = async (
  ctx: Ctx,
  files: FileDeps,
  d: PayslipDoc,
  explicitLang?: Lang,
  config?: PayslipConfig,
): Promise<string> => {
  const cfg = config ?? (await loadDefaultConfig(ctx));
  const lang = resolveLang(cfg, explicitLang, await companyLang(ctx));
  const extras = await loadPayslipExtras(ctx, d);
  const lh = await loadLetterhead(ctx, files, lang);
  return wrapLetterHtml(renderPayslipBody(d, extras, cfg, lang), lang, lh);
};
