import { z } from 'zod';
import { FormulaError, formulaRefs, parseFormula, num } from './formula.js';
import { withVersion } from './org.js';

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'الرمز أحرف لاتينية وأرقام و _ ويبدأ بحرف');
const nameAr = z.string().trim().min(1).max(200);
const nameEn = z.string().trim().max(200).nullish();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');
/** مبلغ مالي كنص عشري بأربع خانات كحد أقصى (لا أرقام عائمة) */
export const money = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, 'مبلغ غير صالح (حتى 4 خانات عشرية)');
const percentage = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'نسبة غير صالحة');

/** متغيرات تُتاح في الصيغ (تُغذّيها دورة الرواتب في 7b)، بأسماء عربية للمحرر. */
export const PAYROLL_VARIABLES = [
  { key: 'basic', labelAr: 'الراتب الأساسي', labelEn: 'Basic salary' },
  { key: 'days_in_period', labelAr: 'أيام الدورة (أساس الاحتساب)', labelEn: 'Days in period' },
  { key: 'worked_days', labelAr: 'أيام العمل الفعلية', labelEn: 'Worked days' },
  { key: 'absent_days', labelAr: 'أيام الغياب', labelEn: 'Absent days' },
  { key: 'unpaid_leave_days', labelAr: 'أيام الإجازة بلا راتب', labelEn: 'Unpaid leave days' },
  { key: 'overtime_hours', labelAr: 'ساعات العمل الإضافي', labelEn: 'Overtime hours' },
  { key: 'late_minutes', labelAr: 'دقائق التأخير', labelEn: 'Late minutes' },
  {
    key: 'early_leave_minutes',
    labelAr: 'دقائق المغادرة المبكرة',
    labelEn: 'Early-leave minutes',
  },
  {
    key: 'shortfall_minutes',
    labelAr: 'دقائق نقص الدوام (تأخير + مغادرة مبكرة)',
    labelEn: 'Shortfall minutes (late + early)',
  },
] as const;
export const PAYROLL_VARIABLE_KEYS: ReadonlySet<string> = new Set(
  PAYROLL_VARIABLES.map((v) => v.key),
);

export const COMPONENT_KINDS = ['earning', 'deduction', 'employer'] as const;
export const CALC_TYPES = ['fixed', 'percent', 'formula', 'rate_table'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export type CalcType = (typeof CALC_TYPES)[number];

const baseShape = {
  code,
  nameAr,
  nameEn,
  /** هل يدخل الراتب الأساسي في هذا الأساس */
  includesBasic: z.boolean().default(false),
  /** المكونات التي تدخل في الأساس (مجموع مبالغها) */
  componentIds: z.array(uuid).max(100).default([]),
  isActive: z.boolean().default(true),
};
export const payrollBaseInput = z.object(baseShape);
export const payrollBaseUpdate = withVersion(baseShape);

const componentBase = z.object({
  code,
  nameAr,
  nameEn,
  kind: z.enum(COMPONENT_KINDS),
  calcType: z.enum(CALC_TYPES),
  fixedAmount: money.nullish(),
  percent: percentage.nullish(),
  /** أساس النسبة، أو مدخل جدول النسب */
  baseId: uuid.nullish(),
  formula: z.string().trim().max(500).nullish(),
  rateTableId: uuid.nullish(),
  /** هل يتناسب المبلغ الثابت مع أيام الخدمة في دورة جزئية */
  prorate: z.boolean().default(true),
  roundingDecimals: z.number().int().min(0).max(4).default(2),
  displayOrder: z.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
});

/** تحقق الحقول المطلوبة لكل نوع احتساب، وسلامة الصيغة (دون المراجع، فتُفحص في الخادم). */
const checkComponent = (v: z.infer<typeof componentBase>, ctx: z.RefinementCtx) => {
  const need = (cond: unknown, path: string, message: string) => {
    if (!cond) ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (v.calcType === 'fixed') need(v.fixedAmount, 'fixedAmount', 'المبلغ مطلوب');
  if (v.calcType === 'percent') {
    need(v.percent, 'percent', 'النسبة مطلوبة');
    need(v.baseId, 'baseId', 'أساس النسبة مطلوب');
  }
  if (v.calcType === 'rate_table') {
    need(v.rateTableId, 'rateTableId', 'جدول النسب مطلوب');
    need(v.baseId, 'baseId', 'الأساس الذي يُحتسب عليه الجدول مطلوب');
  }
  if (v.calcType === 'formula') {
    need(v.formula, 'formula', 'الصيغة مطلوبة');
    if (v.formula) {
      try {
        parseFormula(v.formula);
      } catch (e) {
        if (e instanceof FormulaError) need(false, 'formula', e.message);
        else throw e;
      }
    }
  }
};
export const payComponentInput = componentBase.superRefine(checkComponent);
export const payComponentUpdate = withVersion(componentBase.shape);

export const RATE_MODES = ['progressive', 'slab'] as const;
const bracket = z.object({
  from: money,
  to: money.nullable(),
  rate: percentage,
  fixed: money.default('0'),
});
const rateShape = {
  code,
  nameAr,
  nameEn,
  mode: z.enum(RATE_MODES),
  brackets: z.array(bracket).min(1).max(30),
  isActive: z.boolean().default(true),
};
export const rateTableUpdate = withVersion(rateShape);
export const rateTableInput = z.object(rateShape).superRefine((v, ctx) => {
  const rows = [...v.brackets].sort((a, b) => num(a.from).cmp(num(b.from)));
  rows.forEach((b, i) => {
    const last = i === rows.length - 1;
    const bad = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['brackets', i], message });
    if (b.to !== null && num(b.to).lte(num(b.from))) bad('نهاية الشريحة يجب أن تتجاوز بدايتها');
    if (!last && b.to === null) bad('الشريحة المفتوحة يجب أن تكون الأخيرة');
    if (last && b.to !== null) bad('الشريحة الأخيرة يجب أن تكون مفتوحة (بلا نهاية)');
    const next = rows[i + 1];
    if (next && b.to !== null && !num(next.from).eq(num(b.to)))
      bad('الشرائح يجب أن تكون متصلة بلا فجوات أو تداخل');
  });
  if (rows[0] && !num(rows[0].from).isZero())
    ctx.addIssue({ code: 'custom', path: ['brackets', 0], message: 'أول شريحة تبدأ من صفر' });
});

const componentRef = z.object({
  componentId: uuid,
  /** تجاوز المبلغ الثابت أو النسبة للمكوّن في هذا الهيكل/الموظف */
  amount: money.nullish(),
  percent: percentage.nullish(),
});
const structureShape = {
  code,
  nameAr,
  nameEn,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  items: z.array(componentRef).max(100).default([]),
  isActive: z.boolean().default(true),
};
export const salaryStructureInput = z.object(structureShape);
export const salaryStructureUpdate = withVersion(structureShape);

export const employeeSalaryInput = z.object({
  structureId: uuid.nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  basicAmount: money,
  validFrom: isoDate,
  note: z.string().trim().max(300).nullish(),
  /** مكونات خاصة بالموظف تُضاف إلى هيكله أو تتجاوز قيمه */
  components: z.array(componentRef).max(100).default([]),
});
export const employeeSalaryUpdate = withVersion({
  basicAmount: money.optional(),
  note: z.string().trim().max(300).nullish(),
  components: z.array(componentRef).max(100).optional(),
});

/** مراجع الصيغة (متغيرات غير معروفة وأساس وجداول) للتحقق عند الحفظ. */
export const checkFormulaRefs = (
  formula: string,
  known: {
    components: ReadonlySet<string>;
    bases: ReadonlySet<string>;
    tables: ReadonlySet<string>;
  },
): string[] => {
  const refs = formulaRefs(parseFormula(formula));
  const problems: string[] = [];
  for (const v of refs.vars)
    if (!PAYROLL_VARIABLE_KEYS.has(v) && !known.components.has(v))
      problems.push(`متغير أو مكوّن غير معروف: ${v}`);
  for (const b of refs.bases) if (!known.bases.has(b)) problems.push(`أساس غير معروف: ${b}`);
  for (const t of refs.tables) if (!known.tables.has(t)) problems.push(`جدول نسب غير معروف: ${t}`);
  return problems;
};
