import { z } from 'zod';
import { withVersion } from './org.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ بصيغة YYYY-MM-DD');
const country = z.string().regex(/^[A-Z]{2}$/, 'رمز دولة من حرفين كبيرين');

export const changeTypeEnum = z.enum([
  'hire',
  'transfer',
  'promotion',
  'manager_change',
  'suspension',
  'reinstatement',
  'termination',
]);
export type ChangeType = z.infer<typeof changeTypeEnum>;

export const employmentTypeEnum = z.enum(['full_time', 'part_time', 'temporary', 'contractor']);
export const workModeEnum = z.enum(['onsite', 'remote', 'hybrid']);

/** حقول التعيين القابلة للتغيير عبر حدث. */
export const employmentFields = z.object({
  contractId: uuid.nullable(),
  branchId: uuid,
  departmentId: uuid,
  jobTitleId: uuid.nullable(),
  jobGradeId: uuid.nullable(),
  managerEmployeeId: uuid.nullable(),
  costCenterId: uuid.nullable(),
  workLocationId: uuid.nullable(),
  employmentType: employmentTypeEnum,
  workMode: workModeEnum,
  workCountry: country.nullable(),
});
export type EmploymentFields = z.infer<typeof employmentFields>;

export const changeInput = z.object({
  changeType: changeTypeEnum,
  /** تاريخ سريان الحدث؛ التغييرات الحالية للحالة (إيقاف/إنهاء) لا تقبل تاريخاً مستقبلياً */
  effectiveDate: date,
  reasonId: uuid.nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** الحقول المتغيرة فقط (في التعيين الأول: البناء الكامل) */
  employment: employmentFields.partial().default({}),
});
export type ChangeInput = z.infer<typeof changeInput>;

export const contractTypeEnum = z.enum([
  'permanent',
  'fixed_term',
  'temporary',
  'part_time',
  'internship',
  'contractor',
]);
export const contractInput = z.object({
  contractType: contractTypeEnum,
  startDate: date,
  endDate: date.nullish(),
  probationEndDate: date.nullish(),
  noticeDays: z.number().int().min(0).max(365).nullish(),
  status: z.enum(['draft', 'active', 'ended', 'terminated']).default('active'),
});
export const contractUpdateInput = withVersion(contractInput.shape);

export const changeReasonInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/),
  changeType: changeTypeEnum,
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).nullish(),
  isActive: z.boolean().default(true),
});
