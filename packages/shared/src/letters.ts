import { z } from 'zod';

export const LETTER_LANGUAGES = ['ar', 'en'] as const;
export type LetterLanguage = (typeof LETTER_LANGUAGES)[number];

/** نوع القيمة يحدد العزل الاتجاهي: التواريخ والأرقام والأكواد تُعرض LTR داخل النص العربي. */
/** html: كتلة يولّدها الخادم فقط (مهروبة)؛ image: PNG data URL يولّده الخادم */
export type VariableKind = 'text' | 'date' | 'code' | 'image' | 'html';
export type LetterVariable = {
  key: string;
  group: 'employee' | 'job' | 'contract' | 'company' | 'document' | 'action';
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
    key: 'company.legalName',
    group: 'company',
    kind: 'text',
    labelAr: 'الاسم القانوني (بلغة القالب)',
    labelEn: 'Legal name (template language)',
  },
  {
    key: 'company.address',
    group: 'company',
    kind: 'text',
    labelAr: 'عنوان الشركة (بلغة القالب)',
    labelEn: 'Company address (template language)',
  },
  {
    key: 'company.phone',
    group: 'company',
    kind: 'code',
    labelAr: 'هاتف الشركة',
    labelEn: 'Company phone',
  },
  {
    key: 'company.email',
    group: 'company',
    kind: 'code',
    labelAr: 'بريد الشركة',
    labelEn: 'Company email',
  },
  {
    key: 'company.website',
    group: 'company',
    kind: 'code',
    labelAr: 'موقع الشركة',
    labelEn: 'Company website',
  },
  {
    key: 'company.taxNo',
    group: 'company',
    kind: 'code',
    labelAr: 'الرقم الضريبي',
    labelEn: 'Tax number',
  },
  {
    key: 'company.registrationNo',
    group: 'company',
    kind: 'code',
    labelAr: 'رقم السجل التجاري',
    labelEn: 'Registration number',
  },
  {
    key: 'company.logo',
    group: 'company',
    kind: 'image',
    labelAr: 'شعار الشركة (بلغة القالب)',
    labelEn: 'Company logo (template language)',
  },
  {
    key: 'company.stamp',
    group: 'company',
    kind: 'image',
    labelAr: 'ختم/توقيع الشركة',
    labelEn: 'Company stamp / signature',
  },
  {
    key: 'company.header',
    group: 'company',
    kind: 'html',
    labelAr: 'الترويسة الكاملة (شعار وبيانات)',
    labelEn: 'Full letterhead (logo and details)',
  },
  {
    key: 'company.footer',
    group: 'company',
    kind: 'html',
    labelAr: 'تذييل الشركة',
    labelEn: 'Company footer',
  },
  {
    key: 'document.today',
    group: 'document',
    kind: 'date',
    labelAr: 'تاريخ الإصدار',
    labelEn: 'Issue date',
  },
  {
    key: 'document.number',
    group: 'document',
    kind: 'code',
    labelAr: 'رقم الوثيقة',
    labelEn: 'Document number',
  },
  {
    key: 'document.verifyUrl',
    group: 'document',
    kind: 'code',
    labelAr: 'رابط التحقق',
    labelEn: 'Verification link',
  },
  {
    key: 'document.qr',
    group: 'document',
    kind: 'image',
    labelAr: 'رمز QR للتحقق',
    labelEn: 'Verification QR code',
  },
  {
    key: 'document.issuedBy',
    group: 'document',
    kind: 'text',
    labelAr: 'أصدرها',
    labelEn: 'Issued by',
  },
  {
    key: 'action.title',
    group: 'action',
    kind: 'text',
    labelAr: 'عنوان الإجراء الإداري',
    labelEn: 'Administrative action title',
  },
  {
    key: 'action.type',
    group: 'action',
    kind: 'text',
    labelAr: 'نوع الإجراء الإداري',
    labelEn: 'Administrative action type',
  },
  {
    key: 'action.description',
    group: 'action',
    kind: 'text',
    labelAr: 'وصف الإجراء الإداري',
    labelEn: 'Administrative action description',
  },
  {
    key: 'action.date',
    group: 'action',
    kind: 'date',
    labelAr: 'تاريخ الإجراء',
    labelEn: 'Action date',
  },
  {
    key: 'action.effectiveDate',
    group: 'action',
    kind: 'date',
    labelAr: 'تاريخ سريان الإجراء',
    labelEn: 'Action effective date',
  },
  {
    key: 'action.amount',
    group: 'action',
    kind: 'text',
    labelAr: 'مبلغ الإجراء (مع العملة)',
    labelEn: 'Action amount (with currency)',
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
    // الصورة يولّدها الخادم فقط (data URL لـ PNG)؛ أي قيمة أخرى تُهمل
    if (meta?.kind === 'image') {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raw)) return '—';
      if (key === 'document.qr')
        return `<img src="${raw}" alt="QR" width="110" height="110" style="display:block">`;
      const h = key === 'company.logo' ? 70 : 110;
      return `<img src="${raw}" alt="" style="max-height:${h}px;max-width:240px;display:inline-block">`;
    }
    // كتل HTML من الخادم (مهروبة عند البناء)؛ لا تُقبل من غيره
    if (meta?.kind === 'html') return raw.startsWith('<div class="lh-') ? raw : '—';
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
export const wrapLetterHtml = (
  bodyHtml: string,
  language: LetterLanguage,
  letterhead?: { header?: string; footer?: string },
): string => {
  const footer = letterhead?.footer
    ? `<div style="position:fixed;bottom:0;left:0;right:0">${letterhead.footer}</div>`
    : '';
  return `<!doctype html><html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${letterhead?.header ?? ''}${bodyHtml}${footer}</body></html>`;
};

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
  /** تغليف الوثيقة بترويسة الشركة وتذييلها تلقائياً */
  useLetterhead: z.boolean().default(true),
  bodyHtml: html,
});
export type LetterTemplateInput = z.infer<typeof letterTemplateInput>;

export const letterTemplateUpdate = z.object({
  nameAr: z.string().trim().min(1).max(200).optional(),
  nameEn: z.string().trim().max(200).nullish(),
  category: z.string().trim().min(1).max(40).optional(),
  useLetterhead: z.boolean().optional(),
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

export const issueDocumentInput = z
  .object({
    /** يمكن حذفه عند الإصدار من إجراء إداري: يُؤخذ قالب نوع الإجراء */
    templateId: z.string().uuid().optional(),
    employeeId: z.string().uuid(),
    /** إصدار من إجراء إداري معتمد: تُضاف متغيرات `action.*` ويُربط الخطاب بالإجراء */
    adminActionId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.templateId || !!v.adminActionId, { message: 'templateId required' });

export const revokeDocumentInput = z.object({ reason: z.string().trim().min(1).max(300) });

export const issuedListQuery = z.object({
  employeeId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
