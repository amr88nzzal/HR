import { sql } from 'kysely';
import { FormulaError, num, type RateBracket } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { loadAdminLines } from './admin-feed.js';
import {
  evaluateShortfall,
  persistShortfall,
  shortfallLine,
  type ShortfallEval,
} from './shortfall.js';
import {
  computePayslip,
  EngineError,
  type BaseDef,
  type CompDef,
  type EmpComp,
  type EngineInput,
  type EngineResult,
  type Line,
  type TableDef,
} from './engine.js';
import {
  allocateInstallments,
  loadCapPercent,
  loadDueInstallments,
  type LoanItem,
} from './loans.js';

export type Period = {
  id: string;
  payGroupId: string;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  currency: string;
  status: 'draft' | 'approved' | 'locked';
};

type Row = Record<string, unknown>;
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

export const monthRange = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    startDate: `${year}-${p(month)}-01`,
    endDate: `${year}-${p(month)}-${p(last)}`,
    daysInMonth: last,
  };
};

export type CalcData = {
  comps: CompDef[];
  bases: BaseDef[];
  tables: TableDef[];
  allCodes: string[];
};

export const loadCalcData = async (ctx: Ctx): Promise<CalcData> => {
  const { rows: comps } = await sql<Row>`
    select c.id, c.code, c.name_ar, c.name_en, c.kind, c.calc_type, c.fixed_amount::text as fixed_amount,
           c.percent::text as percent, b.code as base_code, c.formula, t.code as rate_table_code,
           c.rounding_decimals, c.display_order, c.prorate, c.is_active
      from pay_components c
      left join payroll_bases b on b.id = c.base_id
      left join rate_tables t on t.id = c.rate_table_id
     where c.company_id = ${ctx.companyId}`.execute(ctx.trx);
  const { rows: bases } = await sql<Row>`
    select b.code, b.includes_basic,
           coalesce(array_agg(c.code) filter (where c.code is not null and c.is_active), '{}') as member_codes
      from payroll_bases b
      left join pay_component_bases l on l.base_id = b.id
      left join pay_components c on c.id = l.component_id
     where b.company_id = ${ctx.companyId} group by b.id`.execute(ctx.trx);
  const { rows: tables } = await sql<Row>`
    select code, mode, brackets from rate_tables where company_id = ${ctx.companyId}`.execute(
    ctx.trx,
  );
  return {
    comps: comps
      .filter((c) => c.isActive)
      .map((c) => ({
        id: c.id as string,
        code: c.code as string,
        nameAr: c.nameAr as string,
        nameEn: (c.nameEn as string | null) ?? null,
        kind: c.kind as CompDef['kind'],
        calcType: c.calcType as CompDef['calcType'],
        fixedAmount: (c.fixedAmount as string | null) ?? null,
        percent: (c.percent as string | null) ?? null,
        baseCode: (c.baseCode as string | null) ?? null,
        formula: (c.formula as string | null) ?? null,
        rateTableCode: (c.rateTableCode as string | null) ?? null,
        roundingDecimals: Number(c.roundingDecimals),
        displayOrder: Number(c.displayOrder),
        prorate: Boolean(c.prorate),
      })),
    allCodes: comps.map((c) => c.code as string),
    bases: bases.map((b) => ({
      code: b.code as string,
      includesBasic: Boolean(b.includesBasic),
      memberCodes: b.memberCodes as string[],
    })),
    tables: tables.map((t) => ({
      code: t.code as string,
      mode: t.mode as TableDef['mode'],
      brackets: t.brackets as RateBracket[],
    })),
  };
};

export type Eligible = {
  employeeId: string;
  employeeNo: string | null;
  name: string;
  salaryId: string;
  structureId: string | null;
  basic: string;
  serviceStart: string;
  serviceEnd: string;
};

/** الموظفون المستحقون في الدورة: راتب ساري بعملتها، ضمن مجموعة الدفع، وخدمة داخل الشهر. */
export const loadEligible = async (
  ctx: Ctx,
  p: Period,
  employeeIds?: string[],
): Promise<Eligible[]> => {
  const { rows } = await sql<Row>`
    select * from (
      select distinct on (e.id)
             e.id as employee_id, e.employee_no, e.full_name_ar as name, e.first_hire_date::text as hire,
             e.status as emp_status,
             case when e.status = 'terminated'
                  then (select max(m.valid_to)::text from employments m where m.employee_id = e.id) end as term_end,
             s.id as salary_id, s.structure_id, s.basic_amount::text as basic, s.currency
        from employees e
        join employee_salaries s on s.employee_id = e.id
         and s.valid_from <= ${p.endDate}::date and coalesce(s.valid_to, 'infinity'::date) >= ${p.startDate}::date
       where e.company_id = ${ctx.companyId}
         ${employeeIds ? sql`and e.id = any(${employeeIds}::uuid[])` : sql``}
         and (
           exists (select 1 from pay_group_assignments a
                    where a.employee_id = e.id and a.pay_group_id = ${p.payGroupId}
                      and a.valid_from <= ${p.endDate}::date and coalesce(a.valid_to, 'infinity'::date) >= ${p.startDate}::date)
           or (exists (select 1 from pay_groups g where g.id = ${p.payGroupId} and g.is_default)
               and not exists (select 1 from pay_group_assignments a
                    where a.employee_id = e.id
                      and a.valid_from <= ${p.endDate}::date and coalesce(a.valid_to, 'infinity'::date) >= ${p.startDate}::date))
         )
       order by e.id, s.valid_from desc
    ) x where x.currency = ${p.currency} order by x.employee_no nulls last, x.name`.execute(
    ctx.trx,
  );
  const out: Eligible[] = [];
  for (const r of rows) {
    const start = maxDate(p.startDate, (r.hire as string | null) ?? p.startDate);
    const end = minDate(p.endDate, (r.termEnd as string | null) ?? p.endDate);
    if (start > end) continue;
    out.push({
      employeeId: r.employeeId as string,
      employeeNo: (r.employeeNo as string | null) ?? null,
      name: r.name as string,
      salaryId: r.salaryId as string,
      structureId: (r.structureId as string | null) ?? null,
      basic: r.basic as string,
      serviceStart: start,
      serviceEnd: end,
    });
  }
  return out;
};

type Vars = Record<string, string>;
const VAR_KEYS = [
  'days_in_period',
  'worked_days',
  'absent_days',
  'unpaid_leave_days',
  'overtime_hours',
  'late_minutes',
  'early_leave_minutes',
  'shortfall_minutes',
] as const;

/** المتغيرات الآلية من الحضور والإجازات، ثم تجاوزات payroll_inputs. */
export const loadVariables = async (
  ctx: Ctx,
  p: Period,
  list: Eligible[],
): Promise<Map<string, { vars: Vars; overridden: string[] }>> => {
  const ids = list.map((e) => e.employeeId);
  const out = new Map<string, { vars: Vars; overridden: string[] }>();
  if (!ids.length) return out;
  const { rows: att } = await sql<Row>`
    select employee_id,
           count(*) filter (where coalesce(override_status, status) = 'present') as worked,
           count(*) filter (where coalesce(override_status, status) = 'absent') as absent,
           coalesce(sum(late_minutes), 0) as late,
           coalesce(sum(early_leave_minutes), 0) as early,
           coalesce(sum(overtime_minutes), 0) as ot
      from attendance_days
     where company_id = ${ctx.companyId} and employee_id = any(${ids}::uuid[])
       and day_date between ${p.startDate}::date and ${p.endDate}::date
     group by employee_id`.execute(ctx.trx);
  const { rows: unpaid } = await sql<Row>`
    select r.employee_id, coalesce(sum(d.units), 0)::text as units
      from leave_request_days d
      join leave_requests r on r.id = d.request_id and r.status = 'approved'
      join leave_types t on t.id = r.leave_type_id and not t.is_paid
     where d.company_id = ${ctx.companyId} and r.employee_id = any(${ids}::uuid[])
       and d.kind = 'work' and d.day_date between ${p.startDate}::date and ${p.endDate}::date
     group by r.employee_id`.execute(ctx.trx);
  const { rows: inputs } = await sql<Row>`
    select employee_id, key, value::text as value from payroll_inputs
     where period_id = ${p.id} and employee_id = any(${ids}::uuid[])`.execute(ctx.trx);
  const attBy = new Map(att.map((r) => [r.employeeId as string, r]));
  const unpaidBy = new Map(unpaid.map((r) => [r.employeeId as string, r.units as string]));
  const inputsBy = new Map<string, Map<string, string>>();
  for (const i of inputs) {
    const m = inputsBy.get(i.employeeId as string) ?? new Map<string, string>();
    m.set(i.key as string, i.value as string);
    inputsBy.set(i.employeeId as string, m);
  }
  for (const e of list) {
    const a = attBy.get(e.employeeId);
    const vars: Vars = {
      days_in_period: '30',
      worked_days: String(a?.worked ?? 0),
      absent_days: String(a?.absent ?? 0),
      unpaid_leave_days: unpaidBy.get(e.employeeId) ?? '0',
      overtime_hours: num(String(a?.ot ?? 0))
        .div(60)
        .toFixed(4),
      late_minutes: String(a?.late ?? 0),
      early_leave_minutes: String(a?.early ?? 0),
      shortfall_minutes: String(Number(a?.late ?? 0) + Number(a?.early ?? 0)),
    };
    const overridden: string[] = [];
    for (const k of VAR_KEYS) {
      const v = inputsBy.get(e.employeeId)?.get(k);
      if (v !== undefined) {
        vars[k] = v;
        overridden.push(k);
      }
    }
    // النقص المجمَّع يتبع تجاوز التأخير/المغادرة ما لم يُتجاوَز هو نفسه
    if (!overridden.includes('shortfall_minutes'))
      vars['shortfall_minutes'] = String(
        Number(vars['late_minutes'] ?? 0) + Number(vars['early_leave_minutes'] ?? 0),
      );
    out.set(e.employeeId, { vars, overridden });
  }
  return out;
};

/** مكونات الموظف: أسناد الهيكل ثم تخصيص الموظف (الموظف > الهيكل > الافتراضي). */
export const loadEmployeeComps = async (
  ctx: Ctx,
  data: CalcData,
  list: Eligible[],
): Promise<Map<string, EmpComp[]>> => {
  const byId = new Map(data.comps.map((c) => [c.id, c]));
  const out = new Map<string, EmpComp[]>();
  if (!list.length) return out;
  const structIds = [...new Set(list.map((e) => e.structureId).filter((x): x is string => !!x))];
  const { rows: sc } = structIds.length
    ? await sql<Row>`
        select structure_id, component_id, amount::text as amount, percent::text as percent
          from salary_structure_components where structure_id = any(${structIds}::uuid[])`.execute(
        ctx.trx,
      )
    : { rows: [] as Row[] };
  const salaryIds = list.map((e) => e.salaryId);
  const { rows: ec } = await sql<Row>`
    select employee_salary_id, component_id, amount::text as amount, percent::text as percent
      from employee_salary_components where employee_salary_id = any(${salaryIds}::uuid[])`.execute(
    ctx.trx,
  );
  for (const e of list) {
    const m = new Map<string, { amount: string | null; percent: string | null }>();
    for (const r of sc.filter((x) => x.structureId === e.structureId))
      m.set(r.componentId as string, {
        amount: (r.amount as string | null) ?? null,
        percent: (r.percent as string | null) ?? null,
      });
    for (const r of ec.filter((x) => x.employeeSalaryId === e.salaryId)) {
      const prev = m.get(r.componentId as string);
      m.set(r.componentId as string, {
        amount: (r.amount as string | null) ?? prev?.amount ?? null,
        percent: (r.percent as string | null) ?? prev?.percent ?? null,
      });
    }
    const comps: EmpComp[] = [];
    for (const [id, v] of m) {
      const c = byId.get(id);
      if (c) comps.push({ ...c, amount: v.amount, percentOverride: v.percent });
    }
    out.set(e.employeeId, comps);
  }
  return out;
};

export type OldLine = {
  code: string;
  amount: string;
  autoAtOverride: string | null;
  isManual: boolean;
  isAdded: boolean;
  nameAr: string;
  nameEn: string | null;
  kind: Line['kind'];
  overrideReasonId: string | null;
  overrideNote: string | null;
  overrideBy: string | null;
  overrideAt: Date | null;
};

export const loadOldLines = async (
  ctx: Ctx,
  periodId: string,
  employeeIds?: string[],
): Promise<Map<string, OldLine[]>> => {
  const { rows } = await sql<Row>`
    select s.employee_id, l.code, l.amount::text as amount, l.auto_at_override::text as auto_at_override,
           l.is_manual, l.is_added, l.name_ar, l.name_en, l.kind, l.override_reason_id,
           l.override_note, l.override_by, l.override_at
      from payslip_lines l join payslips s on s.id = l.payslip_id
     where s.period_id = ${periodId} and (l.is_manual or l.is_added)
       ${employeeIds ? sql`and s.employee_id = any(${employeeIds}::uuid[])` : sql``}`.execute(
    ctx.trx,
  );
  const out = new Map<string, OldLine[]>();
  for (const r of rows) {
    const list = out.get(r.employeeId as string) ?? [];
    list.push({
      code: r.code as string,
      amount: r.amount as string,
      autoAtOverride: (r.autoAtOverride as string | null) ?? null,
      isManual: Boolean(r.isManual),
      isAdded: Boolean(r.isAdded),
      nameAr: r.nameAr as string,
      nameEn: (r.nameEn as string | null) ?? null,
      kind: r.kind as Line['kind'],
      overrideReasonId: (r.overrideReasonId as string | null) ?? null,
      overrideNote: (r.overrideNote as string | null) ?? null,
      overrideBy: (r.overrideBy as string | null) ?? null,
      overrideAt: (r.overrideAt as Date | null) ?? null,
    });
    out.set(r.employeeId as string, list);
  }
  return out;
};

export type Built = {
  employee: Eligible;
  status: 'calculated' | 'error';
  error: string | null;
  result: EngineResult | null;
  inputs: Record<string, unknown>;
  old: OldLine[];
  /** أقساط السلف المخطط خصمها (عمود مستقل بعد الصافي، لا بند راتب) */
  loanItems: LoanItem[];
  loansAmount: string;
  payableAmount: string;
  shortfall?: ShortfallEval;
};

export const buildPayslip = (
  p: Period,
  data: CalcData,
  e: Eligible,
  vars: { vars: Vars; overridden: string[] },
  comps: EmpComp[],
  old: OldLine[],
  admin: { added: EngineInput['added']; warnings: string[] } = { added: [], warnings: [] },
): Built => {
  const dim = monthRange(p.year, p.month).daysInMonth;
  const serviceDays = Math.round((ms(e.serviceEnd) - ms(e.serviceStart)) / DAY) + 1;
  const factor = serviceDays >= dim ? '1' : num(serviceDays).div(dim).toFixed(8);
  const inputs = {
    basic: e.basic,
    factor,
    serviceStart: e.serviceStart,
    serviceEnd: e.serviceEnd,
    serviceDays,
    variables: vars.vars,
    overriddenVariables: vars.overridden,
  };
  try {
    const result = computePayslip({
      basic: e.basic,
      factor,
      variables: vars.vars,
      components: comps,
      allCodes: data.allCodes,
      bases: data.bases,
      tables: data.tables,
      manual: Object.fromEntries(
        old.filter((o) => o.isManual && !o.isAdded).map((o) => [o.code, o.amount]),
      ),
      added: old
        .filter((o) => o.isAdded)
        .map((o) => ({
          code: o.code,
          nameAr: o.nameAr,
          nameEn: o.nameEn,
          kind: o.kind,
          amount: o.amount,
        }))
        .concat(admin.added),
    });
    for (const w of admin.warnings) if (!result.warnings.includes(w)) result.warnings.push(w);
    return {
      employee: e,
      status: 'calculated',
      error: null,
      result,
      inputs,
      old,
      loanItems: [],
      loansAmount: '0.0000',
      payableAmount: result.totals.net,
    };
  } catch (err) {
    if (err instanceof EngineError || err instanceof FormulaError)
      return {
        employee: e,
        status: 'error',
        error: err.message,
        result: null,
        inputs,
        old,
        loanItems: [],
        loansAmount: '0.0000',
        payableAmount: '0.0000',
      };
    throw err;
  }
};

export const buildAll = async (
  ctx: Ctx,
  p: Period,
  employeeIds?: string[],
): Promise<{ built: Built[]; eligible: Eligible[] }> => {
  const data = await loadCalcData(ctx);
  const eligible = await loadEligible(ctx, p, employeeIds);
  const [vars, comps, old, adminLines, shortfalls] = await Promise.all([
    loadVariables(ctx, p, eligible),
    loadEmployeeComps(ctx, data, eligible),
    loadOldLines(ctx, p.id, employeeIds),
    loadAdminLines(
      ctx,
      p,
      eligible.map((e) => e.employeeId),
    ),
    evaluateShortfall(
      ctx,
      p,
      eligible.map((e) => e.employeeId),
    ),
  ]);
  const built = eligible.map((e) => {
    const ev = shortfalls.get(e.employeeId);
    const sf = shortfallLine(e.basic, ev);
    const admin = adminLines.get(e.employeeId) ?? { added: [], warnings: [] };
    const b = buildPayslip(
      p,
      data,
      e,
      vars.get(e.employeeId) ?? { vars: {}, overridden: [] },
      comps.get(e.employeeId) ?? [],
      old.get(e.employeeId) ?? [],
      { added: [...admin.added, ...sf.added], warnings: [...admin.warnings, ...sf.warnings] },
    );
    if (ev) b.shortfall = ev;
    return b;
  });
  // الأقساط: تُوزَّع على الصافي بعد الاحتساب (عمود مستقل، ولا تدخل في الصافي)
  const [due, cap] = await Promise.all([
    loadDueInstallments(
      ctx,
      p.year,
      p.month,
      p.currency,
      built.filter((b) => b.result).map((b) => b.employee.employeeId),
    ),
    loadCapPercent(ctx),
  ]);
  for (const b of built) {
    if (!b.result) continue;
    const list = due.get(b.employee.employeeId);
    if (!list?.length) continue;
    const a = allocateInstallments(b.result.totals.net, cap, list);
    b.loanItems = a.items;
    b.loansAmount = a.total;
    b.payableAmount = num(b.result.totals.net).minus(a.total).toFixed(4);
    if (a.items.some((i) => i.overCap)) b.result.warnings.push('LOAN_OVER_CAP');
  }
  return { built, eligible };
};

export const persistPayslip = async (ctx: Ctx, p: Period, b: Built): Promise<string> => {
  const t = b.result?.totals;
  const hasManual = !!b.result?.lines.some((l) => l.isManual);
  const { rows } = await sql<{ id: string }>`
    insert into payslips (company_id, period_id, employee_id, currency, status, basic_amount, gross_amount,
                          deductions_amount, net_amount, employer_amount, inputs, warnings, error, has_manual,
                          loans_amount, payable_amount)
    values (${ctx.companyId}, ${p.id}, ${b.employee.employeeId}, ${p.currency}, ${b.status},
            ${t?.basic ?? '0'}, ${t?.gross ?? '0'}, ${t?.deductions ?? '0'}, ${t?.net ?? '0'},
            ${t?.employer ?? '0'}, ${JSON.stringify(b.inputs)}::jsonb,
            ${JSON.stringify(b.result?.warnings ?? [])}::jsonb, ${b.error}, ${hasManual},
            ${b.loansAmount}, ${b.payableAmount})
    on conflict (period_id, employee_id) do update set
      currency = excluded.currency, status = excluded.status, basic_amount = excluded.basic_amount,
      gross_amount = excluded.gross_amount, deductions_amount = excluded.deductions_amount,
      net_amount = excluded.net_amount, employer_amount = excluded.employer_amount,
      inputs = excluded.inputs, warnings = excluded.warnings, error = excluded.error,
      has_manual = excluded.has_manual, loans_amount = excluded.loans_amount,
      payable_amount = excluded.payable_amount, version = payslips.version + 1
    returning id`.execute(ctx.trx);
  const id = rows[0]!.id;
  await sql`delete from payslip_lines where payslip_id = ${id}`.execute(ctx.trx);
  await sql`delete from payslip_loan_items where payslip_id = ${id}`.execute(ctx.trx);
  await persistShortfall(
    ctx,
    id,
    b.employee.employeeId,
    b.status === 'calculated' ? b.shortfall : undefined,
  );
  for (const it of b.loanItems)
    await sql`insert into payslip_loan_items (company_id, payslip_id, installment_id, amount, over_cap)
              values (${ctx.companyId}, ${id}, ${it.installmentId}, ${it.amount}, ${it.overCap})`.execute(
      ctx.trx,
    );
  // عند الخطأ تُحفظ البنود اليدوية القديمة كما هي كي لا تضيع
  const lines: (Line & { old?: OldLine })[] = b.result
    ? b.result.lines.map((l) => {
        const o = b.old.find((x) => x.code === l.code);
        return o ? { ...l, old: o } : l;
      })
    : b.old.map((o, i) => ({
        code: o.code,
        componentId: null,
        nameAr: o.nameAr,
        nameEn: o.nameEn,
        kind: o.kind,
        amount: o.amount,
        autoAmount: null,
        isManual: true,
        isAdded: o.isAdded,
        explain: {},
        sortOrder: 1000 + i,
        old: o,
      }));
  for (const l of lines) {
    const o = l.old;
    await sql`
      insert into payslip_lines (company_id, payslip_id, component_id, code, name_ar, name_en, kind, amount,
        auto_amount, auto_at_override, is_manual, is_added, override_reason_id, override_note, override_by,
        override_at, explain, sort_order)
      values (${ctx.companyId}, ${id}, ${l.componentId}, ${l.code}, ${l.nameAr}, ${l.nameEn}, ${l.kind},
        ${l.amount}, ${l.autoAmount}, ${o?.autoAtOverride ?? null}, ${l.isManual}, ${l.isAdded},
        ${o?.overrideReasonId ?? null}, ${o?.overrideNote ?? null}, ${o?.overrideBy ?? null},
        ${o?.overrideAt ?? null}, ${JSON.stringify(l.explain)}::jsonb, ${l.sortOrder})`.execute(
      ctx.trx,
    );
  }
  return id;
};

export const assertDraft = (p: Pick<Period, 'status'>) => {
  if (p.status !== 'draft')
    throw new AppError('PERIOD_LOCKED', 409, 'الدورة مُعتمدة أو مقفلة؛ أعد فتحها للتعديل');
};

/** احتساب الدورة كاملة: يحدّث القسائم ويحذف قسائم من لم يعد مستحقاً (بلا بنود يدوية محفوظة تضيع صامتاً). */
export const calculatePeriod = async (ctx: Ctx, p: Period) => {
  assertDraft(p);
  const { built, eligible } = await buildAll(ctx, p);
  const keep = eligible.map((e) => e.employeeId);
  await sql`delete from payslips where period_id = ${p.id}
            and not (employee_id = any(${keep}::uuid[]))`.execute(ctx.trx);
  for (const b of built) await persistPayslip(ctx, p, b);
  const totals = sumTotals(built);
  const errors = built.filter((b) => b.status === 'error').length;
  const { rows } = await sql<{ n: number }>`
    select coalesce(max(run_no), 0) + 1 as n from payroll_runs where period_id = ${p.id}`.execute(
    ctx.trx,
  );
  await sql`insert into payroll_runs (company_id, period_id, run_no, employees_count, error_count, totals, created_by)
            values (${ctx.companyId}, ${p.id}, ${rows[0]!.n}, ${built.length}, ${errors},
                    ${JSON.stringify(totals)}::jsonb, ${ctx.userId})`.execute(ctx.trx);
  await sql`update payroll_periods set calculated_at = now(), version = version + 1 where id = ${p.id}`.execute(
    ctx.trx,
  );
  return { runNo: rows[0]!.n, employees: built.length, errors, totals };
};

export const sumTotals = (built: Built[]) => {
  const keys = ['basic', 'gross', 'deductions', 'net', 'employer'] as const;
  const acc = Object.fromEntries(keys.map((k) => [k, num(0)])) as Record<
    (typeof keys)[number],
    ReturnType<typeof num>
  >;
  for (const b of built)
    if (b.result) for (const k of keys) acc[k] = acc[k].plus(b.result.totals[k]);
  const loans = built.reduce((a, b) => a.plus(b.loansAmount), num(0));
  const payable = built.reduce((a, b) => a.plus(b.payableAmount), num(0));
  return {
    ...Object.fromEntries(keys.map((k) => [k, acc[k].toFixed(4)])),
    loans: loans.toFixed(4),
    payable: payable.toFixed(4),
  };
};

/** محاكاة بلا أي كتابة */
export const simulatePeriod = async (ctx: Ctx, p: Period, employeeIds?: string[]) => {
  const { built } = await buildAll(ctx, p, employeeIds);
  return {
    totals: sumTotals(built),
    slips: built.map((b) => ({
      employeeId: b.employee.employeeId,
      employeeNo: b.employee.employeeNo,
      name: b.employee.name,
      status: b.status,
      error: b.error,
      totals: b.result
        ? { ...b.result.totals, loans: b.loansAmount, payable: b.payableAmount }
        : null,
      loanItems: b.loanItems,
      warnings: b.result?.warnings ?? [],
      lines: b.result?.lines ?? [],
    })),
  };
};

/** إعادة احتساب موظف واحد مع إبقاء بنوده اليدوية */
export const recalcEmployee = async (ctx: Ctx, p: Period, employeeId: string) => {
  assertDraft(p);
  const { built } = await buildAll(ctx, p, [employeeId]);
  const b = built[0];
  if (!b) throw new AppError('NOT_ELIGIBLE', 409, 'الموظف غير مستحق في هذه الدورة');
  return persistPayslip(ctx, p, b);
};
