import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import ExcelJS from 'exceljs';
import { loanGridQuery, num, wrapLetterHtml, type LoanGridQuery } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { loadLetterhead } from '../brand/index.js';
import { employeeScope } from '../employees/index.js';
import { requirePermission, type AuthContext } from '../identity/index.js';
import { loadCalendar } from '../leave/index.js';
import type { Renderer } from '../letters/index.js';
import { ensureDefaultLoanTypes, fmtAmount, makeRun } from '../payroll/index.js';

/**
 * جدول السلف والقروض والذمم بحسب أيام الشهر: صف لكل (موظف، نوع)، وخلية اليوم = مبلغ ما صُرف/فُوتر في ذلك اليوم.
 * Loans/advances/receivables by day of month: one row per (employee, type); a day cell = the amount disbursed/invoiced that day.
 */
export type LoansGridDeps = { files: FileDeps; render: Renderer | undefined };

type Cell = { amount: string; refs: string[] };
export type GridRow = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  typeId: string;
  typeCode: string;
  typeNameAr: string;
  typeNameEn: string;
  color: string;
  currency: string;
  cells: Record<string, Cell>;
  taken: string;
  due: string;
  closing: string;
};
type Totals = { perDay: Record<string, string>; taken: string; due: string; closing: string };
export type Grid = {
  year: number;
  month: number;
  days: { day: number; kind: 'work' | 'weekend' | 'holiday' }[];
  types: { id: string; code: string; nameAr: string; nameEn: string; color: string }[];
  rows: GridRow[];
  totals: Record<string, Totals>;
};

type Raw = {
  id: string;
  employeeId: string;
  employeeNo: string | null;
  employeeName: string;
  typeId: string;
  typeCode: string;
  typeNameAr: string;
  typeNameEn: string;
  color: string;
  currency: string;
  eventDate: string;
  principal: string;
  reference: string | null;
  due: string;
  closing: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

export const loadGrid = async (ctx: Ctx, auth: AuthContext, q: LoanGridQuery): Promise<Grid> => {
  await ensureDefaultLoanTypes(ctx);
  const monthStart = `${q.year}-${pad(q.month)}-01`;
  const last = new Date(Date.UTC(q.year, q.month, 0)).getUTCDate();
  const monthEnd = `${q.year}-${pad(q.month)}-${pad(last)}`;
  const idx = q.year * 12 + q.month;
  const scope = employeeScope(auth, 'payroll.loan.read');
  const { rows } = await sql<Raw>`
    select l.id, l.employee_id, employees.employee_no, employees.full_name_ar as employee_name,
           lt.id as type_id, lt.code as type_code, lt.name_ar as type_name_ar, lt.name_en as type_name_en,
           lt.color, l.currency, l.event_date::text as event_date, l.principal::text as principal, l.reference,
           coalesce((select sum(i.amount) from loan_installments i
                      where i.loan_id = l.id and i.due_year = ${q.year} and i.due_month = ${q.month}
                        and i.status <> 'cancelled'), 0)::text as due,
           coalesce((select sum(i.amount) from loan_installments i
                      where i.loan_id = l.id and i.status in ('scheduled', 'deferred')
                        and (i.status = 'deferred' or i.due_year * 12 + i.due_month > ${idx})), 0)::text as closing
      from loans l
      join employees on employees.id = l.employee_id
      join loan_types lt on lt.id = l.type_id
     where l.company_id = ${ctx.companyId}
       and l.event_date <= ${monthEnd}::date
       and (l.event_date >= ${monthStart}::date or exists (
             select 1 from loan_installments i where i.loan_id = l.id
              and i.due_year = ${q.year} and i.due_month = ${q.month} and i.status <> 'cancelled'))
       ${q.status ? sql`and l.status = ${q.status}` : sql`and l.status <> 'cancelled'`}
       ${q.employeeId ? sql`and l.employee_id = ${q.employeeId}` : sql``}
       ${q.typeId ? sql`and l.type_id = ${q.typeId}` : sql``}
       ${
         q.branchId || q.departmentId
           ? sql`and exists (select 1 from employments m where m.employee_id = employees.id
                   and m.valid_from <= ${monthEnd}::date and (m.valid_to is null or m.valid_to >= ${monthStart}::date)
                   ${q.branchId ? sql`and m.branch_id = ${q.branchId}` : sql``}
                   ${q.departmentId ? sql`and m.department_id = ${q.departmentId}` : sql``})`
           : sql``
       }
       ${scope ? sql`and ${scope}` : sql``}
     order by employees.employee_no nulls last, employees.full_name_ar, lt.sort_order, l.event_date`.execute(
    ctx.trx,
  );

  const cal = await loadCalendar(ctx, monthStart, monthEnd);
  const days = Array.from({ length: last }, (_, i) => {
    const day = i + 1;
    const date = `${q.year}-${pad(q.month)}-${pad(day)}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const kind: 'work' | 'weekend' | 'holiday' = cal.weeklyOff.includes(dow)
      ? 'weekend'
      : cal.holidays.has(date)
        ? 'holiday'
        : 'work';
    return { day, kind };
  });

  const byKey = new Map<string, GridRow>();
  const types = new Map<string, Grid['types'][number]>();
  for (const r of rows) {
    const key = `${r.employeeId}|${r.typeId}|${r.currency}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        employeeId: r.employeeId,
        employeeNo: r.employeeNo ?? '',
        employeeName: r.employeeName,
        typeId: r.typeId,
        typeCode: r.typeCode,
        typeNameAr: r.typeNameAr,
        typeNameEn: r.typeNameEn,
        color: r.color,
        currency: r.currency,
        cells: {},
        taken: '0',
        due: '0',
        closing: '0',
      };
      byKey.set(key, g);
      types.set(r.typeId, {
        id: r.typeId,
        code: r.typeCode,
        nameAr: r.typeNameAr,
        nameEn: r.typeNameEn,
        color: r.color,
      });
    }
    if (r.eventDate >= monthStart) {
      const day = String(Number(r.eventDate.slice(8, 10)));
      const c = g.cells[day] ?? { amount: '0', refs: [] };
      c.amount = num(c.amount).plus(r.principal).toFixed(4);
      if (r.reference) c.refs.push(r.reference);
      g.cells[day] = c;
      g.taken = num(g.taken).plus(r.principal).toFixed(4);
    }
    g.due = num(g.due).plus(r.due).toFixed(4);
    g.closing = num(g.closing).plus(r.closing).toFixed(4);
  }
  const out = [...byKey.values()];
  const totals: Record<string, Totals> = {};
  for (const g of out) {
    const t = (totals[g.currency] ??= { perDay: {}, taken: '0', due: '0', closing: '0' });
    for (const [d, c] of Object.entries(g.cells))
      t.perDay[d] = num(t.perDay[d] ?? 0)
        .plus(c.amount)
        .toFixed(4);
    t.taken = num(t.taken).plus(g.taken).toFixed(4);
    t.due = num(t.due).plus(g.due).toFixed(4);
    t.closing = num(t.closing).plus(g.closing).toFixed(4);
  }
  return { year: q.year, month: q.month, days, types: [...types.values()], rows: out, totals };
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const L = {
  ar: {
    title: 'جدول السلف والقروض والذمم',
    month: 'الشهر',
    emp: 'الموظف',
    type: 'النوع',
    taken: 'المصروف',
    due: 'المستحق خصمه',
    closing: 'المتبقي',
    total: 'المجموع',
    legend: 'دليل الألوان',
  },
  en: {
    title: 'Loans, advances & receivables',
    month: 'Month',
    emp: 'Employee',
    type: 'Type',
    taken: 'Taken',
    due: 'Due this month',
    closing: 'Remaining',
    total: 'Total',
    legend: 'Legend',
  },
} as const;

const SHADE = { weekend: '#e9ecef', holiday: '#ffe3e3', work: '#ffffff' } as const;
/** لون الخلية: لون النوع بشفافية خفيفة كي يبقى الرقم مقروءاً. / Cell tint: the type colour, lightened so the number stays readable. */
const tint = (hex: string): string => {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  const mix = (c: number) => Math.round(c * 0.28 + 255 * 0.72);
  return [1, 3, 5].map((i) => mix(n(i)).toString(16).padStart(2, '0')).join('');
};

export const gridHtml = (g: Grid, lang: 'ar' | 'en'): string => {
  const t = L[lang];
  const cell = 'padding:2px 3px;border:1px solid #bbb;text-align:center';
  const money = (v: string) => (num(v).isZero() ? '' : esc(fmtAmount(v)));
  const head = `<tr style="background:#0f766e;color:#fff"><th style="${cell}">${t.emp}</th><th style="${cell}">${t.type}</th>${g.days
    .map(
      (d) =>
        `<th style="${cell};${d.kind !== 'work' ? `background:${d.kind === 'weekend' ? '#6b7280' : '#b42318'}` : ''}">${d.day}</th>`,
    )
    .join(
      '',
    )}<th style="${cell}">${t.taken}</th><th style="${cell}">${t.due}</th><th style="${cell}">${t.closing}</th></tr>`;
  const byEmp = new Map<string, GridRow[]>();
  for (const r of g.rows) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
  const body = [...byEmp.values()]
    .map((list) =>
      list
        .map((r, i) => {
          const name =
            i === 0
              ? `<td rowspan="${list.length}" style="${cell};font-weight:bold;vertical-align:middle">${esc(r.employeeName)}<br/><span style="font-weight:normal;color:#555">${esc(r.employeeNo)}</span></td>`
              : '';
          const tc = `#${tint(r.color)}`;
          const cells = g.days
            .map((d) => {
              const c = r.cells[String(d.day)];
              const bg = c ? tc : SHADE[d.kind];
              return `<td style="${cell};background:${bg}">${c ? money(c.amount) : ''}</td>`;
            })
            .join('');
          return `<tr>${name}<td style="${cell};background:${tc};font-weight:600">${esc(lang === 'ar' ? r.typeNameAr : r.typeNameEn)}</td>${cells}<td style="${cell}">${money(r.taken)}</td><td style="${cell}">${money(r.due)}</td><td style="${cell}">${money(r.closing)}</td></tr>`;
        })
        .join(''),
    )
    .join('');
  const foot = Object.entries(g.totals)
    .map(
      ([cur, tt]) =>
        `<tr style="background:#f1f1f1;font-weight:bold"><td colspan="2" style="${cell}">${t.total} ${esc(cur)}</td>${g.days
          .map((d) => `<td style="${cell}">${money(tt.perDay[String(d.day)] ?? '0')}</td>`)
          .join(
            '',
          )}<td style="${cell}">${money(tt.taken)}</td><td style="${cell}">${money(tt.due)}</td><td style="${cell}">${money(tt.closing)}</td></tr>`,
    )
    .join('');
  const legend = g.types
    .map(
      (ty) =>
        `<span style="display:inline-block;margin-inline-end:12px"><span style="display:inline-block;width:10px;height:10px;background:#${tint(ty.color)};border:1px solid ${ty.color};vertical-align:middle"></span> ${esc(lang === 'ar' ? ty.nameAr : ty.nameEn)}</span>`,
    )
    .join('');
  return `<style>@page{size:A4 landscape;margin:8mm}</style><div style="font-size:7pt">
<h2 style="text-align:center;margin:0 0 4px">${t.title}</h2>
<div style="text-align:center;margin-bottom:6px">${t.month}: <span dir="ltr" style="unicode-bidi:isolate">${g.year}-${pad(g.month)}</span></div>
<table style="width:100%;border-collapse:collapse"><thead>${head}</thead><tbody>${body}${foot}</tbody></table>
<div style="margin-top:6px">${t.legend}: ${legend}</div></div>`;
};

export const gridWorkbook = async (g: Grid, lang: 'ar' | 'en'): Promise<Buffer> => {
  const t = L[lang];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.slice(0, 31), {
    views: [{ rightToLeft: lang === 'ar', state: 'frozen', xSplit: 2, ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const nDays = g.days.length;
  const header = [t.emp, t.type, ...g.days.map((d) => d.day), t.taken, t.due, t.closing];
  ws.addRow(header);
  const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
  const fill = (hex: string): ExcelJS.Fill => ({
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: argb(hex) },
  });
  const hr = ws.getRow(1);
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.alignment = { horizontal: 'center', vertical: 'middle' };
  hr.eachCell((c, n) => {
    const d = g.days[n - 3];
    c.fill = fill(
      d?.kind === 'weekend' ? '#6b7280' : d?.kind === 'holiday' ? '#b42318' : '#0f766e',
    );
  });
  const money = '#,##0.00;-#,##0.00;;';
  let rowNo = 2;
  const byEmp = new Map<string, GridRow[]>();
  for (const r of g.rows) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
  for (const list of byEmp.values()) {
    const start = rowNo;
    for (const r of list) {
      const row = ws.addRow([
        `${r.employeeName} (${r.employeeNo})`,
        lang === 'ar' ? r.typeNameAr : r.typeNameEn,
        ...g.days.map((d) => {
          const c = r.cells[String(d.day)];
          return c ? Number(c.amount) : null;
        }),
        Number(r.taken),
        Number(r.due),
        Number(r.closing),
      ]);
      row.getCell(2).fill = fill(`#${tint(r.color)}`);
      g.days.forEach((d, i) => {
        const c = row.getCell(3 + i);
        c.numFmt = money;
        c.alignment = { horizontal: 'center' };
        c.fill = fill(r.cells[String(d.day)] ? `#${tint(r.color)}` : SHADE[d.kind]);
      });
      for (let k = 0; k < 3; k++) row.getCell(3 + nDays + k).numFmt = money;
      rowNo++;
    }
    // دمج خلية اسم الموظف عبر صفوف أنواعه / merge the employee cell across the employee's type rows
    if (list.length > 1) ws.mergeCells(start, 1, rowNo - 1, 1);
    ws.getCell(start, 1).alignment = { vertical: 'middle', wrapText: true };
    ws.getCell(start, 1).font = { bold: true };
  }
  for (const [cur, tt] of Object.entries(g.totals)) {
    const row = ws.addRow([
      `${t.total} ${cur}`,
      '',
      ...g.days.map((d) => (tt.perDay[String(d.day)] ? Number(tt.perDay[String(d.day)]) : null)),
      Number(tt.taken),
      Number(tt.due),
      Number(tt.closing),
    ]);
    row.font = { bold: true };
    row.eachCell((c, n) => {
      c.fill = fill('#f1f1f1');
      if (n > 2) c.numFmt = money;
    });
    ws.mergeCells(row.number, 1, row.number, 2);
  }
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 14;
  for (let i = 0; i < nDays; i++) ws.getColumn(3 + i).width = 7;
  for (let k = 0; k < 3; k++) ws.getColumn(3 + nDays + k).width = 13;
  return Buffer.from(await wb.xlsx.writeBuffer());
};

export const createLoansGridRouter = (
  db: Db,
  authenticate: RequestHandler,
  deps: LoansGridDeps,
): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  router.get('/', requirePermission('payroll.loan.read'), ((req: Request, res: Response, next) => {
    void (async () => {
      const q = loanGridQuery.parse(req.query);
      const lang = req.query['lang'] === 'en' ? 'en' : 'ar';
      const auth = req.auth as AuthContext;
      const out = await run(req, async (ctx) => ({
        grid: await loadGrid(ctx, auth, q),
        letterhead: q.format === 'pdf' ? await loadLetterhead(ctx, deps.files, lang) : undefined,
      }));
      if (q.format === 'json') {
        res.json({ data: out.grid });
        return;
      }
      const name = `loans-grid-${q.year}-${pad(q.month)}`;
      let buf: Buffer;
      if (q.format === 'xlsx') buf = await gridWorkbook(out.grid, lang);
      else {
        if (!deps.render)
          throw new AppError('RENDER_NOT_CONFIGURED', 503, 'خدمة تحويل PDF غير مهيّأة');
        buf = await deps.render(wrapLetterHtml(gridHtml(out.grid, lang), lang, out.letterhead));
      }
      res.setHeader(
        'Content-Type',
        q.format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${name}.${q.format}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buf);
    })().catch(next);
  }) as RequestHandler);
  return router;
};
