import { z } from 'zod';

/** كيف يصل الموظف إلى حسابه: دعوة بريد برابط لمرة واحدة، أو كلمة مرور مؤقتة يراها المنشئ مرة واحدة. */
export const ACCOUNT_DELIVERIES = ['invite', 'temp'] as const;

export const employeeAccountInput = z.object({
  /** يؤخذ من البريد الأساسي في جهات اتصال الموظف إن غاب */
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[A-Za-z0-9._-]+$/)
    .optional(),
  delivery: z.enum(ACCOUNT_DELIVERIES).default('invite'),
  /** للتسليم المؤقت فقط؛ يُولَّد تلقائياً إن غاب */
  password: z.string().min(1).max(256).optional(),
  /** الافتراضي دور «موظف» بنطاق الذات */
  roleId: z.string().uuid().optional(),
});
export type EmployeeAccountInput = z.infer<typeof employeeAccountInput>;

/**
 * إنشاء حسابات بالجملة لموظفين بلا حساب: دعوة بالبريد المسجَّل في جهات الاتصال ودور موحّد.
 * `dryRun` يعاين النتيجة لكل موظف دون كتابة شيء.
 * Bulk account creation for employees without one: email invite to the contact email and a single role.
 * `dryRun` previews the per-employee outcome without writing anything.
 */
export const BULK_ACCOUNT_MAX = 200;
export const bulkAccountInput = z.object({
  employeeIds: z.array(z.string().uuid()).min(1).max(BULK_ACCOUNT_MAX),
  roleId: z.string().uuid().optional(),
  dryRun: z.boolean().default(false),
});
export type BulkAccountInput = z.infer<typeof bulkAccountInput>;
export const BULK_ACCOUNT_STATUSES = [
  'created',
  'ok',
  'has_account',
  'no_email',
  'email_taken',
  'duplicate_email',
  'not_visible',
  'error',
] as const;
export type BulkAccountStatus = (typeof BULK_ACCOUNT_STATUSES)[number];

export const acceptInviteInput = z.object({
  token: z.string().min(10).max(300),
  password: z.string().min(1).max(256),
});
