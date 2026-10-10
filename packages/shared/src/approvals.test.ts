import { describe, expect, it } from 'vitest';
import { approvalStepInput, conditionSchema, evaluateCondition } from './approvals.js';

describe('شروط الموافقات', () => {
  const p = { days: 7, type: 'annual', meta: { grade: 3 } };
  it('يقيّم المقارنات والحقول المتداخلة', () => {
    expect(evaluateCondition({ field: 'days', op: 'gt', value: 5 }, p)).toBe(true);
    expect(evaluateCondition({ field: 'days', op: 'lte', value: 5 }, p)).toBe(false);
    expect(evaluateCondition({ field: 'meta.grade', op: 'eq', value: 3 }, p)).toBe(true);
    expect(evaluateCondition({ field: 'type', op: 'in', value: ['sick', 'annual'] }, p)).toBe(true);
  });
  it('الحقل الغائب أو النوع المختلف يجعل المقارنة خاطئة (ما عدا ne)', () => {
    expect(evaluateCondition({ field: 'x', op: 'gt', value: 1 }, p)).toBe(false);
    expect(evaluateCondition({ field: 'type', op: 'gt', value: 1 }, p)).toBe(false);
    expect(evaluateCondition({ field: 'x', op: 'ne', value: 1 }, p)).toBe(true);
  });
  it('يركّب all وany', () => {
    const c = {
      all: [
        { field: 'days', op: 'gte', value: 5 },
        {
          any: [
            { field: 'type', op: 'eq', value: 'sick' },
            { field: 'meta.grade', op: 'lt', value: 4 },
          ],
        },
      ],
    } as const;
    expect(conditionSchema.safeParse(c).success).toBe(true);
    expect(evaluateCondition(c as never, p)).toBe(true);
  });
  it('خطوة role/user تتطلب approverRef والمدير لا يقبله', () => {
    expect(approvalStepInput.safeParse({ nameAr: 'س', approverType: 'role' }).success).toBe(false);
    expect(
      approvalStepInput.safeParse({ nameAr: 'س', approverType: 'direct_manager' }).success,
    ).toBe(true);
    expect(
      approvalStepInput.safeParse({
        nameAr: 'س',
        approverType: 'direct_manager',
        approverRef: '00000000-0000-4000-8000-000000000000',
      }).success,
    ).toBe(false);
  });
});
