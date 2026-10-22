import { z } from 'zod';

/**
 * قالب قسيمة الراتب: إعدادات منظَّمة (لا HTML حر) تضبط شكل القسيمة المطبوعة لكل شركة.
 * Payslip template: structured settings (no free HTML) controlling how each company's printed payslip looks.
 * لإضافة حقل رأس أو قسم جديد: أضفه للقوائم أدناه ثم عالجه في apps/api/.../payslip-render.ts وأضف تسميته في الواجهة.
 * To add a header field or section: add it to the lists below, handle it in the API renderer and label it in the UI.
 */
export const PAYSLIP_HEADER_FIELDS = [
  'employeeName',
  'employeeNo',
  'jobTitle',
  'department',
  'branch',
  'hireDate',
  'month',
  'currency',
  'basicSalary',
] as const;
export type PayslipHeaderField = (typeof PAYSLIP_HEADER_FIELDS)[number];

/** أقسام الجسم بترتيب ظهورها؛ غياب القسم = إخفاؤه / body sections in display order; absent = hidden */
export const PAYSLIP_SECTIONS = [
  'header',
  'lines',
  'totals',
  'loans',
  'ytd',
  'notes',
  'signature',
  'qr',
] as const;
export type PayslipSection = (typeof PAYSLIP_SECTIONS)[number];

export const PAYSLIP_LAYOUTS = ['stacked', 'side_by_side'] as const;

const text = (max: number) => z.string().trim().max(max).default('');
const bilingual = (max: number) =>
  z.object({ ar: text(max), en: text(max) }).default({ ar: '', en: '' });

export const payslipConfigSchema = z.object({
  /** stacked: جدول الاستحقاقات ثم الاستقطاعات؛ side_by_side: الاستحقاقات والاستقطاعات جنباً إلى جنب */
  layout: z.enum(PAYSLIP_LAYOUTS).default('stacked'),
  /** لغة القسيمة: لغة الشركة الافتراضية أو لغة ثابتة */
  language: z.enum(['company', 'ar', 'en']).default('company'),
  title: bilingual(120),
  headerFields: z
    .array(z.enum(PAYSLIP_HEADER_FIELDS))
    .min(1)
    .max(PAYSLIP_HEADER_FIELDS.length)
    .refine((a) => new Set(a).size === a.length, 'حقول مكررة')
    .default(['employeeName', 'employeeNo', 'month', 'currency']),
  headerColumns: z.union([z.literal(1), z.literal(2)]).default(2),
  sections: z
    .array(z.enum(PAYSLIP_SECTIONS))
    .min(1)
    .refine((a) => new Set(a).size === a.length, 'أقسام مكررة')
    .refine((a) => a.includes('lines'), 'قسم البنود إلزامي')
    .default(['header', 'lines', 'totals', 'loans', 'notes']),
  hideZeroLines: z.boolean().default(false),
  showLineCodes: z.boolean().default(false),
  showPrintedAt: z.boolean().default(false),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'لون سداسي مثل #0f766e')
    .default('#0f766e'),
  fontSize: z.number().int().min(8).max(13).default(10),
  borders: z.enum(['grid', 'lines']).default('grid'),
  /** نص يظهر في قسم «ملاحظات» (مثل إقرار أو تنبيه) */
  notes: bilingual(500),
  footer: bilingual(300),
});
export type PayslipConfig = z.infer<typeof payslipConfigSchema>;

/** تصاميم جاهزة تُحمَّل كنقطة بداية ثم تُعدَّل / ready designs loaded as a starting point, then edited */
export const PAYSLIP_PRESETS: Record<'stacked' | 'side_by_side' | 'detailed', PayslipConfig> = {
  // عمودي مبسّط: يطابق القسيمة السابقة / simple stacked: matches the former payslip
  stacked: payslipConfigSchema.parse({}),
  // جانبي: دخل | اقتطاعات في جدول واحد مع مربع صافي مميّز، مثل كشوف الرواتب الأردنية
  side_by_side: payslipConfigSchema.parse({
    layout: 'side_by_side',
    headerFields: ['employeeName', 'month', 'jobTitle', 'basicSalary', 'hireDate', 'employeeNo'],
    sections: ['header', 'lines', 'totals', 'loans', 'notes', 'qr'],
    showPrintedAt: true,
    borders: 'grid',
  }),
  // مفصّل: أفكار من الكشوف الألمانية — أرقام تراكمية للسنة، رموز البنود، تاريخ الطباعة، وإقرار توقيع
  detailed: payslipConfigSchema.parse({
    layout: 'stacked',
    headerFields: [
      'employeeName',
      'employeeNo',
      'jobTitle',
      'department',
      'branch',
      'hireDate',
      'month',
      'currency',
    ],
    sections: ['header', 'lines', 'totals', 'loans', 'ytd', 'notes', 'signature', 'qr'],
    showLineCodes: true,
    showPrintedAt: true,
    borders: 'lines',
    notes: {
      ar: 'تُعدّ هذه القسيمة إفادة بالراتب. يرجى مراجعتها والإبلاغ عن أي ملاحظة خلال 7 أيام.',
      en: 'This payslip serves as proof of earnings. Please review it and report any issue within 7 days.',
    },
  }),
};

export const payslipTemplateInput = z.object({
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  config: payslipConfigSchema,
});
export type PayslipTemplateInput = z.infer<typeof payslipTemplateInput>;
