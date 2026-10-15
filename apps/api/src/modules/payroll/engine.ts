import {
  applyRateTable,
  evalFormula,
  formulaRefs,
  num,
  parseFormula,
  type FormulaEnv,
  type Num,
  type RateBracket,
} from '@hrms/shared';

/** نواة احتساب القسيمة: دالة نقية بلا قاعدة بيانات (decimal.js، تقريب لكل بند نصف للأعلى). */
export class EngineError extends Error {}

export type CompDef = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  kind: 'earning' | 'deduction' | 'employer';
  calcType: 'fixed' | 'percent' | 'formula' | 'rate_table';
  fixedAmount: string | null;
  percent: string | null;
  baseCode: string | null;
  formula: string | null;
  rateTableCode: string | null;
  roundingDecimals: number;
  displayOrder: number;
  prorate: boolean;
};
/** مكوّن مُسند للموظف بقيمه الفعلية بعد التخصيص (الموظف ثم الهيكل ثم الافتراضي) */
export type EmpComp = CompDef & { amount: string | null; percentOverride: string | null };
export type BaseDef = { code: string; includesBasic: boolean; memberCodes: string[] };
export type TableDef = { code: string; mode: 'progressive' | 'slab'; brackets: RateBracket[] };

export type EngineInput = {
  basic: string;
  /** نسبة التناسب 0..1 (أيام الخدمة ÷ أيام الشهر) */
  factor: string;
  variables: Record<string, string>;
  components: EmpComp[];
  /** رموز كل مكونات الشركة: مكوّن غير مُسند للموظف يُقرأ في الصيغ صفراً */
  allCodes: string[];
  bases: BaseDef[];
  tables: TableDef[];
  /** قيم يدوية بحسب رمز البند (الأساسي: basic) */
  manual: Record<string, string>;
  added: {
    code: string;
    nameAr: string;
    nameEn: string | null;
    kind: CompDef['kind'];
    amount: string;
  }[];
  basicNameAr?: string;
  basicNameEn?: string;
};

export type Line = {
  code: string;
  componentId: string | null;
  nameAr: string;
  nameEn: string | null;
  kind: CompDef['kind'];
  amount: string;
  autoAmount: string | null;
  isManual: boolean;
  isAdded: boolean;
  explain: Record<string, unknown>;
  sortOrder: number;
};
export type EngineResult = {
  lines: Line[];
  totals: { basic: string; gross: string; deductions: string; net: string; employer: string };
  warnings: string[];
};

const fix = (n: Num) => n.toFixed(4);
const round = (n: Num, dp: number) => n.toDecimalPlaces(dp, 4 /* ROUND_HALF_UP */);

const depsOf = (c: EmpComp, bases: Map<string, BaseDef>, inSet: Set<string>): string[] => {
  const out = new Set<string>();
  const members = (b: string | null) =>
    (b ? (bases.get(b)?.memberCodes ?? []) : []).forEach((m) => inSet.has(m) && out.add(m));
  if (c.calcType === 'percent' || c.calcType === 'rate_table') members(c.baseCode);
  if (c.calcType === 'formula' && c.formula) {
    const refs = formulaRefs(parseFormula(c.formula));
    refs.vars.forEach((v) => inSet.has(v) && out.add(v));
    refs.bases.forEach((b) => members(b));
  }
  out.delete(c.code);
  return [...out];
};

/** ترتيب طوبولوجي مستقر: الاعتماديات أولاً ثم displayOrder ثم الرمز. */
const orderComponents = (comps: EmpComp[], bases: Map<string, BaseDef>): EmpComp[] => {
  const sorted = [...comps].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code),
  );
  const inSet = new Set(sorted.map((c) => c.code));
  const deps = new Map(sorted.map((c) => [c.code, depsOf(c, bases, inSet)]));
  const done = new Set<string>();
  const out: EmpComp[] = [];
  while (out.length < sorted.length) {
    const next = sorted.find(
      (c) => !done.has(c.code) && (deps.get(c.code) ?? []).every((d) => done.has(d)),
    );
    if (!next) throw new EngineError('اعتماد دائري بين المكونات');
    done.add(next.code);
    out.push(next);
  }
  return out;
};

export const computePayslip = (input: EngineInput): EngineResult => {
  const bases = new Map(input.bases.map((b) => [b.code, b]));
  const tables = new Map(input.tables.map((t) => [t.code, t]));
  const factor = num(input.factor);
  const fullBasic = num(input.basic);
  const known = new Set(input.allCodes);
  const amounts = new Map<string, Num>();
  const lines: Line[] = [];

  const manualOf = (code: string): Num | null => {
    const m = input.manual[code];
    return m === undefined ? null : num(m);
  };
  const push = (l: Omit<Line, 'amount' | 'autoAmount' | 'isManual'> & { auto: Num }) => {
    const m = manualOf(l.code);
    const amount = m ?? l.auto;
    amounts.set(l.code, amount);
    const { auto, ...rest } = l;
    lines.push({
      ...rest,
      amount: fix(amount),
      autoAmount: fix(auto),
      isManual: m !== null,
    });
  };

  const basicAuto = round(fullBasic.times(factor), 4);
  push({
    code: 'basic',
    componentId: null,
    nameAr: input.basicNameAr ?? 'الراتب الأساسي',
    nameEn: input.basicNameEn ?? 'Basic salary',
    kind: 'earning',
    auto: basicAuto,
    isAdded: false,
    explain: { type: 'basic', basic: fix(fullBasic), factor: input.factor },
    sortOrder: 0,
  });

  const baseAmount = (code: string): Num => {
    const b = bases.get(code);
    if (!b) throw new EngineError(`أساس غير معروف: ${code}`);
    let sum = b.includesBasic ? (amounts.get('basic') ?? num(0)) : num(0);
    for (const m of b.memberCodes) sum = sum.plus(amounts.get(m) ?? 0);
    return sum;
  };

  for (const c of orderComponents(input.components, bases)) {
    let auto: Num;
    let explain: Record<string, unknown>;
    if (c.calcType === 'fixed') {
      const raw = num(c.amount ?? c.fixedAmount ?? 0);
      const f = c.prorate ? factor : num(1);
      auto = raw.times(f);
      explain = { type: 'fixed', amount: fix(raw), prorated: c.prorate, factor: fix(f) };
    } else if (c.calcType === 'percent') {
      const pct = num(c.percentOverride ?? c.percent ?? 0);
      const base = baseAmount(c.baseCode ?? '');
      auto = base.times(pct).div(100);
      explain = {
        type: 'percent',
        percent: pct.toString(),
        base: c.baseCode,
        baseAmount: fix(base),
      };
    } else if (c.calcType === 'rate_table') {
      const t = tables.get(c.rateTableCode ?? '');
      if (!t) throw new EngineError(`جدول نسب غير معروف: ${c.rateTableCode}`);
      const base = baseAmount(c.baseCode ?? '');
      auto = applyRateTable(t.mode, t.brackets, base);
      explain = { type: 'rate_table', table: t.code, base: c.baseCode, input: fix(base) };
    } else {
      const used: Record<string, string> = {};
      const env: FormulaEnv = {
        variable: (n) => {
          const v =
            n === 'basic'
              ? fullBasic
              : Object.hasOwn(input.variables, n)
                ? num(input.variables[n] as string)
                : amounts.has(n)
                  ? (amounts.get(n) as Num)
                  : known.has(n)
                    ? num(0)
                    : undefined;
          if (v !== undefined) used[n] = fix(v);
          return v;
        },
        base: (code) => {
          const v = baseAmount(code);
          used[`base('${code}')`] = fix(v);
          return v;
        },
        table: (code, value) => {
          const t = tables.get(code);
          if (!t) throw new EngineError(`جدول نسب غير معروف: ${code}`);
          const v = applyRateTable(t.mode, t.brackets, value);
          used[`table('${code}', ${fix(value)})`] = fix(v);
          return v;
        },
      };
      auto = evalFormula(parseFormula(c.formula ?? '0'), env);
      explain = { type: 'formula', formula: c.formula, inputs: used };
    }
    auto = round(auto, c.roundingDecimals);
    push({
      code: c.code,
      componentId: c.id,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      kind: c.kind,
      auto,
      isAdded: false,
      explain,
      sortOrder: 100 + c.displayOrder,
    });
  }

  input.added.forEach((a, i) => {
    const amount = num(a.amount);
    amounts.set(a.code, amount);
    lines.push({
      code: a.code,
      componentId: null,
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      kind: a.kind,
      amount: fix(amount),
      autoAmount: null,
      isManual: true,
      isAdded: true,
      explain: { type: 'added' },
      sortOrder: 1000 + i,
    });
  });

  const sum = (pred: (l: Line) => boolean) =>
    lines.filter(pred).reduce((acc, l) => acc.plus(l.amount), num(0));
  const gross = sum((l) => l.kind === 'earning');
  const deductions = sum((l) => l.kind === 'deduction');
  const employer = sum((l) => l.kind === 'employer');
  const net = gross.minus(deductions);
  const warnings: string[] = [];
  if (net.lt(0)) warnings.push('NEGATIVE_NET');
  return {
    lines,
    totals: {
      basic: fix(amounts.get('basic') ?? num(0)),
      gross: fix(gross),
      deductions: fix(deductions),
      net: fix(net),
      employer: fix(employer),
    },
    warnings,
  };
};
