import { z } from 'zod';

export const LETTER_LANGUAGES = ['ar', 'en'] as const;
export type LetterLanguage = (typeof LETTER_LANGUAGES)[number];

/** نوع القيمة يحدد العزل الاتجاهي: التواريخ والأرقام والأكواد تُعرض LTR داخل النص العربي. */
export type VariableKind = 'text' | 'date' | 'code';
export type LetterVariable = {
  key: string;
  group: 'employee' | 'job' | 'contract' | 'company' | 'document';
  kind: VariableKind;
  labelAr: string;
  labelEn: string;
};

/** دليل المتغيرات المتاحة في القوالب، بأسماء عربية مجمّعة حسب الكيان. */
export const LETTER_VARIABLES: readonly LetterVariable[] = [
  {
    key: 'employee.fullName',
    group: 'employee',
    kind: 'text',
    labelAr: 'الاسم الكامل (بلغة القالب)',
    labelEn: 'Full name (template language)',
  },
  {
    key: 'employee.fullNameAr',
    group: 'employee',
    kind: 'text',
    labelAr: 'الاسم الكامل بالعربية',
    labelEn: 'Full name (Arabic)',
  },
  {
    key: 'employee.fullNameEn',
    group: 'employee',
    kind: 'text',
    labelAr: 'الاسم الكامل بالإنجليزية',
    labelEn: 'Full name (English)',
  },
  {
    key: 'employee.employeeNo',
    group: 'employee',
    kind: 'code',
    labelAr: 'الرقم الوظيفي',
    labelEn: 'Employee number',
  },
  {
    key: 'employee.nationality',
    group: 'employee',
    kind: 'text',
    labelAr: 'الجنسية',
    labelEn: 'Nationality',
  },
  { key: 'employee.gender', group: 'employee', kind: 'text', labelAr: 'الجنس', labelEn: 'Gender' },
  {
    key: 'employee.birthDate',
    group: 'employee',
    kind: 'date',
    labelAr: 'تاريخ الميلاد',
    labelEn: 'Birth date',
  },
  {
    key: 'employee.hireDate',
    group: 'employee',
    kind: 'date',
    labelAr: 'تاريخ التعيين',
    labelEn: 'Hire date',
  },
  { key: 'job.title', group: 'job', kind: 'text', labelAr: 'المسمى الوظيفي', labelEn: 'Job title' },
  { key: 'job.department', group: 'job', kind: 'text', labelAr: 'القسم', labelEn: 'Department' },
  { key: 'job.branch', group: 'job', kind: 'text', labelAr: 'الفرع', labelEn: 'Branch' },
  {
    key: 'job.grade',
    group: 'job',
    kind: 'text',
    labelAr: 'الدرجة الوظيفية',
    labelEn: 'Job grade',
  },
  {
    key: 'job.manager',
    group: 'job',
    kind: 'text',
    labelAr: 'المدير المباشر',
    labelEn: 'Direct manager',
  },
  {
    key: 'job.employmentType',
    group: 'job',
    kind: 'text',
    labelAr: 'نوع التوظيف',
    labelEn: 'Employment type',
  },
  {
    key: 'contract.startDate',
    group: 'contract',
    kind: 'date',
    labelAr: 'بداية العقد الحالي',
    labelEn: 'Current contract start',
  },
  {
    key: 'contract.endDate',
    group: 'contract',
    kind: 'date',
    labelAr: 'نهاية العقد الحالي',
    labelEn: 'Current contract end',
  },
  {
    key: 'company.name',
    group: 'company',
    kind: 'text',
    labelAr: 'اسم الشركة (بلغة القالب)',
    labelEn: 'Company name (template language)',
  },
  {
    key: 'document.today',
    group: 'document',
    kind: 'date',
    labelAr: 'تاريخ الإصدار',
    labelEn: 'Issue date',
  },
  {
    key: 'document.issuedBy',
    group: 'document',
    kind: 'text',
    labelAr: 'أصدرها',
    labelEn: 'Issued by',
  },
];

export const LETTER_VARIABLE_KEYS: ReadonlySet<string> = new Set(
  LETTER_VARIABLES.map((v) => v.key),
);

const VAR_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** المتغيرات المستعملة في القالب (بلا تكرار). */
export const extractVariables = (html: string): string[] => [
  ...new Set([...html.matchAll(VAR_RE)].map((m) => m[1] as string)),
];

export const MAX_TEMPLATE_BYTES = 200_000;

/** أنماط ممنوعة: سكربت، معالجات أحداث، موارد خارجية، إطارات، تحويل ترويسات. */
const FORBIDDEN: [RegExp, string][] = [
  [/<\s*script/i, 'ممنوع وسم script'],
  [/<\s*(iframe|object|embed|applet|frame|frameset)\b/i, 'ممنوع تضمين إطارات أو كائنات'],
  [/<\s*(link|base)\b/i, 'ممنوع وسما link وbase'],
  [/<\s*meta\b[^>]*http-equiv/i, 'ممنوع تحويل الترويسات'],
  [/\son[a-z]+\s*=/i, 'ممنوع معالجات الأحداث (onclick…)'],
  [/javascript\s*:/i, 'ممنوع روابط javascript'],
  [/@import\b/i, 'ممنوع @import'],
  [/(src|href|poster|action)\s*=\s*["']?\s*(https?:)?\/\//i, 'ممنوع الموارد الخارجية'],
  [/url\(\s*["']?\s*(https?:)?\/\//i, 'ممنوع الموارد الخارجية في CSS'],
];

/** يعيد قائمة المشكلات (فارغة = صالح). */
export const checkTemplateHtml = (html: string): string[] => {
  const problems: string[] = [];
  if (html.length > MAX_TEMPLATE_BYTES / 2) problems.push('حجم القالب كبير جداً');
  for (const [re, msg] of FORBIDDEN) if (re.test(html)) problems.push(msg);
  const unknown = extractVariables(html).filter((k) => !LETTER_VARIABLE_KEYS.has(k));
  if (unknown.length) problems.push(`متغيرات غير معروفة: ${unknown.join('، ')}`);
  return problems;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** يملأ المتغيرات مع الهروب من HTML وعزل اتجاه التواريخ والأكواد. القيمة الفارغة تظهر «—». */
export const renderLetterBody = (html: string, values: Record<string, string | null>): string =>
  html.replace(VAR_RE, (_, key: string) => {
    const raw = values[key];
    if (raw === null || raw === undefined || raw === '') return '—';
    const meta = LETTER_VARIABLES.find((v) => v.key === key);
    const safe = escapeHtml(raw);
    return meta && meta.kind !== 'text'
      ? `<span dir="ltr" style="unicode-bidi:isolate">${safe}</span>`
      : safe;
  });

const BASE_CSS = `
@page { size: A4; margin: 22mm 20mm; }
html { font-family: 'Amiri','Noto Naskh Arabic','Noto Sans',serif; font-size: 14pt; line-height: 1.9; color: #111; }
body { margin: 0; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #999; padding: 4px 8px; }
`;

/** الصفحة الكاملة المرسلة للتحويل لـ PDF. */
export const wrapLetterHtml = (bodyHtml: string, language: LetterLanguage): string =>
  `<!doctype html><html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`;

// ───── مدخلات الـ API ─────
const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'الرمز أحرف لاتينية وأرقام و - _ فقط');
const html = z.string().min(1).max(MAX_TEMPLATE_BYTES);

export const letterTemplateInput = z.object({
  code,
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).nullish(),
  language: z.enum(LETTER_LANGUAGES),
  category: z.string().trim().min(1).max(40).default('certificate'),
  bodyHtml: html,
});
export type LetterTemplateInput = z.infer<typeof letterTemplateInput>;

export const letterTemplateUpdate = z.object({
  nameAr: z.string().trim().min(1).max(200).optional(),
  nameEn: z.string().trim().max(200).nullish(),
  category: z.string().trim().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
});

export const letterVersionInput = z.object({
  bodyHtml: html,
  note: z.string().trim().max(300).nullish(),
});

export const letterPreviewInput = z.object({
  bodyHtml: html.optional(),
  versionId: z.string().uuid().optional(),
  employeeId: z.string().uuid(),
});

export const issueDocumentInput = z.object({
  templateId: z.string().uuid(),
  employeeId: z.string().uuid(),
});

export const issuedListQuery = z.object({
  employeeId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
