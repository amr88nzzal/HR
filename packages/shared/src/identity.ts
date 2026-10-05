import { z } from 'zod';

const uuid = z.string().uuid();
const nameAr = z.string().trim().min(1).max(200);

export const scopeTypeSchema = z.enum(['company', 'branch', 'department', 'team', 'self']);
export type ScopeTypeInput = z.infer<typeof scopeTypeSchema>;

export const roleAssignmentInput = z
  .object({ roleId: uuid, scopeType: scopeTypeSchema, scopeId: uuid.nullish() })
  .refine(
    (v) =>
      (v.scopeType === 'company' || v.scopeType === 'team' || v.scopeType === 'self') ===
      !v.scopeId,
    {
      message: 'نطاق الشركة/الفريق/الذات بلا معرّف، ونطاق الفرع/القسم يتطلب معرّفاً',
      path: ['scopeId'],
    },
  );

export const userCreateInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'اسم المستخدم 3-40 حرفاً لاتينياً أو أرقاماً أو . _ -')
    .nullish(),
  displayName: nameAr,
  /** كلمة مرور مبدئية؛ يُجبر المستخدم على تغييرها عند أول دخول */
  password: z.string().min(1).max(256),
  roles: z.array(roleAssignmentInput).max(20).default([]),
});

export const userUpdateInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/)
    .nullish(),
  displayName: nameAr.optional(),
  status: z.enum(['active', 'disabled']).optional(),
  version: z.number().int().positive(),
});

export const userListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const roleInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'الرمز أحرف لاتينية صغيرة وأرقام و _'),
  nameAr,
  nameEn: z.string().trim().max(200).nullish(),
  permissions: z.array(z.string().max(100)).max(500),
});

export const roleUpdateInput = z.object({
  nameAr: nameAr.optional(),
  nameEn: z.string().trim().max(200).nullish(),
  permissions: z.array(z.string().max(100)).max(500).optional(),
  version: z.number().int().positive(),
});
