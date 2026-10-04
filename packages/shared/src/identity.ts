import { z } from 'zod';

const uuid = z.string().uuid();

export const scopeTypeSchema = z.enum(['company', 'branch', 'department', 'team', 'self']);
export type ScopeTypeDto = z.infer<typeof scopeTypeSchema>;

export const roleAssignmentInput = z
  .object({ roleId: uuid, scopeType: scopeTypeSchema, scopeId: uuid.nullish() })
  .refine((a) => (a.scopeType === 'company' || a.scopeType === 'self') === (a.scopeId == null), {
    message: 'النطاق يتطلب معرّفاً إلا في نطاقي الشركة والذات',
  });

export const userCreateInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'اسم المستخدم 3-40 حرفاً لاتينياً أو أرقاماً أو . _ -')
    .nullish(),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(256),
  mustChangePassword: z.boolean().default(true),
  assignments: z.array(roleAssignmentInput).max(50).default([]),
});

export const userUpdateInput = z
  .object({
    username: userCreateInput.shape.username,
    displayName: z.string().trim().min(1).max(200),
    status: z.enum(['active', 'disabled']),
  })
  .partial()
  .extend({ version: z.number().int().positive() });

export const assignmentsInput = z.object({ assignments: z.array(roleAssignmentInput).max(50) });
export const resetPasswordInput = z.object({
  password: z.string().min(1).max(256),
  mustChangePassword: z.boolean().default(true),
});

const roleCode = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'رمز الدور: أحرف لاتينية صغيرة وأرقام و _');
export const roleCreateInput = z.object({
  code: roleCode,
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).nullish(),
  permissions: z.array(z.string().max(100)).max(500).default([]),
});
export const roleUpdateInput = z
  .object({
    nameAr: roleCreateInput.shape.nameAr,
    nameEn: roleCreateInput.shape.nameEn,
    permissions: z.array(z.string().max(100)).max(500),
  })
  .partial()
  .extend({ version: z.number().int().positive() });
