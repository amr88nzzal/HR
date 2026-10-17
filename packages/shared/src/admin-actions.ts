import { z } from 'zod';
import { employmentFields } from './employments.js';
import { withVersion } from './org.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ بصيغة YYYY-MM-DD');
const money = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'مبلغ صالح');

export const ACTION_CATEGORIES = [
  'notice',
  'warning',
  'penalty',
  'reward_cash',
  'reward_moral',
  'commendation',
  'promotion',
  'other',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];
export const PAYROLL_EFFECTS = ['none', 'deduction', 'bonus'] as const;
export const ACTION_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

const typeShape = {
  code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'رمز بحروف صغيرة وأرقام و_'),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).nullish(),
  category: z.enum(ACTION_CATEGORIES),
  payrollEffect: z.enum(PAYROLL_EFFECTS).default('none'),
  requiresApproval: z.boolean().default(true),
  requiresAcknowledgment: z.boolean().default(true),
  letterTemplateCode: z.string().trim().max(60).nullish(),
  escalationTypeId: uuid.nullish(),
  escalationCount: z.number().int().min(2).max(20).nullish(),
  escalationWindowDays: z.number().int().min(1).max(3650).nullish(),
  isActive: z.boolean().default(true),
};
type TypeRuleShape = {
  category: ActionCategory;
  payrollEffect?: string;
  escalationTypeId?: string | null;
  escalationCount?: number | null;
};
const typeRefine = <T extends z.ZodType<TypeRuleShape>>(s: T) =>
  s
    .refine(
      (v) =>
        (v.payrollEffect ?? 'none') === 'none' ||
        v.category === 'penalty' ||
        v.category === 'reward_cash',
      {
        message: 'الأثر المالي للرواتب خاص بالعقوبة والمكافأة النقدية فقط',
        path: ['payrollEffect'],
      },
    )
    .refine((v) => !!v.escalationTypeId === (v.escalationCount != null), {
      message: 'حدّد النوع التالي وعدد التكرار معاً',
      path: ['escalationCount'],
    });
export const adminActionTypeInput = typeRefine(z.object(typeShape));
export const adminActionTypeUpdate = withVersion(typeShape);
/** قواعد النوع بعد دمج التعديل مع القيم الحالية (للمسار)؛ يعيد رسالة الخطأ أو null */
export const typeRulesError = (v: TypeRuleShape): string | null => {
  const r = adminActionTypeInput.safeParse({ code: 'xx', nameAr: 'x', ...v });
  return r.success ? null : (r.error.issues[0]?.message ?? 'بيانات غير صالحة');
};

/** حقول الترقية: القيم الجديدة فقط (يُحتفظ بالباقي من التعيين الحالي) */
export const promotionInput = z
  .object({
    jobTitleId: employmentFields.shape.jobTitleId.optional(),
    jobGradeId: employmentFields.shape.jobGradeId.optional(),
    departmentId: uuid.optional(),
    branchId: uuid.optional(),
    managerEmployeeId: employmentFields.shape.managerEmployeeId.optional(),
    /** الراتب الأساسي الجديد؛ يُنسخ باقي الراتب الحالي (الهيكل والمكونات والعملة) */
    newBasicAmount: money.optional(),
  })
  .refine(
    (v) =>
      v.jobTitleId !== undefined ||
      v.jobGradeId !== undefined ||
      v.departmentId !== undefined ||
      v.branchId !== undefined ||
      v.managerEmployeeId !== undefined ||
      v.newBasicAmount !== undefined,
    { message: 'حدّد تغييراً واحداً على الأقل (مسمى/درجة/قسم/راتب)' },
  );
export type PromotionInput = z.infer<typeof promotionInput>;

export const adminActionInput = z.object({
  employeeId: uuid,
  typeId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullish(),
  actionDate: isoDate,
  effectiveDate: isoDate.optional(),
  amount: money.nullish(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  /** الدورة المستهدفة للأثر المالي؛ الافتراضي: شهر تاريخ السريان */
  payrollYear: z.number().int().min(2000).max(2100).nullish(),
  payrollMonth: z.number().int().min(1).max(12).nullish(),
  promotion: promotionInput.nullish(),
  /** true: يُرسل للموافقة فوراً (أو يُعتمد مباشرة إن كان النوع بلا موافقة وللمستخدم صلاحية) */
  submit: z.boolean().default(false),
});
export type AdminActionInput = z.infer<typeof adminActionInput>;
export const adminActionUpdate = adminActionInput
  .omit({ employeeId: true, typeId: true, submit: true })
  .partial()
  .extend({ version: z.number().int().min(1) });

export const cancelActionInput = z.object({ reason: z.string().trim().min(3).max(500) });

export const adminActionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  employeeId: uuid.optional(),
  typeId: uuid.optional(),
  category: z.enum(ACTION_CATEGORIES).optional(),
  status: z.enum(ACTION_STATUSES).optional(),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z]{1,40}$/)
    .optional(),
});
