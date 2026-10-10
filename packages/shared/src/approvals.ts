import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ بصيغة YYYY-MM-DD');

// ── الشروط على بيانات الطلب ──
export const CONDITION_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const leaf = z.object({
  field: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9_.]+$/, 'اسم حقل لاتيني (أحرف وأرقام _ .)'),
  op: z.enum(CONDITION_OPS),
  value: z.union([scalar, z.array(scalar).max(50)]),
});

export type Condition = z.infer<typeof leaf> | { all: Condition[] } | { any: Condition[] };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    leaf,
    z.object({ all: z.array(conditionSchema).min(1).max(10) }),
    z.object({ any: z.array(conditionSchema).min(1).max(10) }),
  ]),
);

const lookup = (payload: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as object)) return (acc as never)[k];
    return undefined;
  }, payload);

/** يقيّم شرطاً على بيانات الطلب. حقل غائب يجعل المقارنة خاطئة (ما عدا ne). */
export const evaluateCondition = (cond: Condition, payload: Record<string, unknown>): boolean => {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, payload));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, payload));
  const actual = lookup(payload, cond.field);
  const expected = cond.value;
  if (cond.op === 'in') return Array.isArray(expected) && expected.some((e) => e === actual);
  if (Array.isArray(expected)) return false;
  switch (cond.op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    default: {
      if (
        typeof actual !== typeof expected ||
        (typeof actual !== 'number' && typeof actual !== 'string')
      )
        return false;
      const a = actual as number | string;
      const e = expected as number | string;
      return cond.op === 'gt'
        ? a > e
        : cond.op === 'gte'
          ? a >= e
          : cond.op === 'lt'
            ? a < e
            : a <= e;
    }
  }
};

// ── السلاسل والخطوات ──
export const APPROVER_TYPES = ['direct_manager', 'manager_of_manager', 'role', 'user'] as const;
export const approverTypeEnum = z.enum(APPROVER_TYPES);
export const stepModeEnum = z.enum(['any', 'all']);

export const approvalStepInput = z
  .object({
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z.string().trim().max(120).nullish(),
    approverType: approverTypeEnum,
    /** معرّف الدور أو المستخدم (للنوعين role وuser فقط) */
    approverRef: uuid.nullish(),
    mode: stepModeEnum.default('any'),
    condition: conditionSchema.nullish(),
  })
  .refine((s) => (s.approverType === 'role' || s.approverType === 'user') === !!s.approverRef, {
    message: 'المعتمد من نوع دور/مستخدم يتطلب approverRef، والمدير المباشر لا يقبله',
    path: ['approverRef'],
  });

export const approvalFlowInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9_.-]+$/, 'رمز لاتيني'),
  requestType: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).nullish(),
  isActive: z.boolean().default(true),
  steps: z.array(approvalStepInput).min(1).max(10),
});
export const approvalFlowUpdateInput = approvalFlowInput
  .omit({ code: true })
  .extend({ version: z.number().int().min(1) });

// ── الطلبات والإجراءات ──
export const APPROVAL_ACTIONS = ['approve', 'reject', 'return'] as const;
export const approvalActionInput = z.object({
  action: z.enum(APPROVAL_ACTIONS),
  note: z.string().trim().max(1000).nullish(),
});

export const approvalSubmitInput = z.object({
  requestType: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  entityType: z.string().trim().max(60).nullish(),
  entityId: uuid.nullish(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const approvalResubmitInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const approvalWithdrawInput = z.object({ note: z.string().trim().max(1000).nullish() });

export const approvalListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['pending', 'approved', 'rejected', 'returned', 'withdrawn']).optional(),
  requestType: z.string().trim().max(80).optional(),
});

export const delegationInput = z
  .object({
    delegateUserId: uuid,
    validFrom: date,
    validTo: date,
    requestType: z.string().trim().max(80).nullish(),
    note: z.string().trim().max(300).nullish(),
    /** مدير يضبط تفويضاً نيابة عن مستخدم آخر (يتطلب approvals.delegation.manage) */
    delegatorUserId: uuid.nullish(),
  })
  .refine((d) => d.validFrom <= d.validTo, {
    message: 'تاريخ البداية يجب ألا يتجاوز النهاية',
    path: ['validTo'],
  });
