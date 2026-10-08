import { z } from 'zod';
import { withVersion } from './org.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ بصيغة YYYY-MM-DD');
const txt = (max = 200) => z.string().trim().min(1).max(max);
const optTxt = (max = 200) => z.string().trim().max(max).nullish();
const country = z.string().regex(/^[A-Z]{2}$/, 'رمز دولة من حرفين كبيرين (ISO 3166-1)');
const currency = z.string().regex(/^[A-Z]{3}$/, 'رمز عملة من ثلاثة أحرف كبيرة');

export const genderEnum = z.enum(['male', 'female']);
export const employeeStatusEnum = z.enum(['active', 'suspended', 'terminated']);

export const employeeInput = z.object({
  /** يُولَّد تلقائياً إن غاب؛ تحديده يدوياً يتطلب صلاحية خاصة */
  employeeNo: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_\-/.]+$/, 'رقم وظيفي بأحرف لاتينية وأرقام و - _ / .')
    .nullish(),
  firstNameAr: txt(80),
  fatherNameAr: optTxt(80),
  grandfatherNameAr: optTxt(80),
  familyNameAr: txt(80),
  firstNameEn: optTxt(80),
  fatherNameEn: optTxt(80),
  grandfatherNameEn: optTxt(80),
  familyNameEn: optTxt(80),
  birthDate: date.nullish(),
  gender: genderEnum.nullish(),
  maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']).nullish(),
  nationality: country.nullish(),
  firstHireDate: date.nullish(),
  /** قيم الحقول المخصصة (مفتاح ← قيمة)؛ تُتحقق من تعريفاتها في الخادم */
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export const employeeUpdateInput = withVersion(employeeInput.omit({ employeeNo: true }).shape);

export const employeeListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  status: employeeStatusEnum.optional(),
  branchId: uuid.optional(),
  departmentId: uuid.optional(),
  sort: z
    .enum(['employeeNo', '-employeeNo', 'name', '-name', 'createdAt', '-createdAt'])
    .default('employeeNo'),
});

export const contactInput = z.object({
  type: z.enum(['mobile', 'phone', 'email', 'emergency']),
  value: txt(120),
  contactName: optTxt(120),
  relation: optTxt(60),
  isPrimary: z.boolean().default(false),
});
export const addressInput = z.object({
  type: z.enum(['home', 'work', 'other']).default('home'),
  country: optTxt(60),
  city: optTxt(100),
  line1: optTxt(200),
  line2: optTxt(200),
  postalCode: optTxt(20),
  isPrimary: z.boolean().default(false),
});
export const dependentInput = z.object({
  name: txt(150),
  relation: z.enum(['spouse', 'child', 'parent', 'other']),
  birthDate: date.nullish(),
  gender: genderEnum.nullish(),
  isCovered: z.boolean().default(false),
  notes: optTxt(500),
});
export const educationInput = z.object({
  degree: txt(120),
  field: optTxt(120),
  institution: optTxt(160),
  country: optTxt(60),
  startYear: z.number().int().min(1940).max(2100).nullish(),
  endYear: z.number().int().min(1940).max(2100).nullish(),
  grade: optTxt(40),
});
export const experienceInput = z.object({
  employer: txt(160),
  title: optTxt(120),
  startDate: date.nullish(),
  endDate: date.nullish(),
  notes: optTxt(500),
});
const ibanRe = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
export const bankAccountInput = z.object({
  bankName: txt(120),
  accountHolder: optTxt(120),
  /** يُطبَّع (حذف المسافات وتكبير) ثم يُشفَّر؛ لا يُعاد إلا مقنّعاً */
  iban: z
    .string()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().regex(ibanRe, 'IBAN غير صالح')),
  currency,
  isPrimary: z.boolean().default(false),
  validFrom: date.nullish(),
  validTo: date.nullish(),
});

export const childInputs = {
  contacts: contactInput,
  addresses: addressInput,
  dependents: dependentInput,
  education: educationInput,
  experience: experienceInput,
} as const;
export const childUpdateInput = <T extends z.ZodRawShape>(shape: T) => withVersion(shape);
export { uuid as employeeIdSchema };
