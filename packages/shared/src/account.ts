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

export const acceptInviteInput = z.object({
  token: z.string().min(10).max(300),
  password: z.string().min(1).max(256),
});
