import { describe, expect, it } from 'vitest';
import {
  computeShortfall,
  shortfallDecisionInput,
  shortfallPolicyInput,
  splitShortfall,
} from './shortfall.js';

const base = {
  method: 'minutes' as const,
  countLate: true,
  countEarly: true,
  monthlyFreeMinutes: 0,
  minutesPerDay: 480,
  tiers: [],
};
const days = [
  { late: 30, early: 0 },
  { late: 0, early: 90 },
  { late: 20, early: 40 },
  { late: 0, early: 0 },
];

describe('computeShortfall', () => {
  it('دقائق: التأخير + المغادرة المبكرة ÷ دقائق اليوم، والمرات = أيام النقص', () => {
    const r = computeShortfall(base, days);
    expect(r).toMatchObject({
      lateMinutes: 50,
      earlyMinutes: 130,
      occurrences: 3,
      totalMinutes: 180,
      chargeableMinutes: 180,
      daysDue: '0.3750',
    });
  });
  it('السماحية الشهرية تُخصم قبل التحويل ولا تنزل عن صفر', () => {
    expect(computeShortfall({ ...base, monthlyFreeMinutes: 60 }, days).daysDue).toBe('0.2500');
    expect(computeShortfall({ ...base, monthlyFreeMinutes: 500 }, days)).toMatchObject({
      chargeableMinutes: 0,
      daysDue: '0.0000',
    });
  });
  it('التأخير فقط أو المغادرة فقط بحسب السياسة', () => {
    expect(computeShortfall({ ...base, countEarly: false }, days)).toMatchObject({
      totalMinutes: 50,
      occurrences: 2,
    });
    expect(computeShortfall({ ...base, countLate: false }, days)).toMatchObject({
      totalMinutes: 130,
      occurrences: 2,
    });
  });
  it('الشرائح: أعلى شريحة بلغها عدد المرات؛ وتحت أول شريحة لا خصم', () => {
    const tiers = [
      { from: 2, dayFraction: '0.25' },
      { from: 3, dayFraction: '0.5' },
      { from: 6, dayFraction: '1' },
    ];
    const p = { ...base, method: 'tiers' as const, tiers };
    expect(computeShortfall(p, days).daysDue).toBe('0.5000');
    expect(computeShortfall(p, days.slice(0, 2)).daysDue).toBe('0.2500');
    expect(computeShortfall(p, days.slice(0, 1)).daysDue).toBe('0.0000');
  });
});

describe('splitShortfall', () => {
  it('راتب: كله من الراتب. رصيد: من الرصيد حتى المتاح والباقي من الراتب', () => {
    expect(splitShortfall('1.5000', 'salary', { available: '10' })).toEqual({
      daysLeave: '0.00',
      daysSalary: '1.5000',
      balanceShort: false,
    });
    expect(splitShortfall('1.5000', 'leave', { available: '10' })).toEqual({
      daysLeave: '1.50',
      daysSalary: '0.0000',
      balanceShort: false,
    });
    expect(splitShortfall('1.5000', 'leave', { available: '0.5' })).toEqual({
      daysLeave: '0.50',
      daysSalary: '1.0000',
      balanceShort: true,
    });
  });
  it('تقسيم: الجزء المحدد من الرصيد (لا يتجاوز المستحق)، وإعفاء بلا خصم', () => {
    expect(splitShortfall('1.0000', 'split', { leaveDays: '0.25', available: '5' })).toMatchObject({
      daysLeave: '0.25',
      daysSalary: '0.7500',
    });
    expect(splitShortfall('1.0000', 'split', { leaveDays: '9', available: '5' })).toMatchObject({
      daysLeave: '1.00',
      daysSalary: '0.0000',
    });
    expect(splitShortfall('1.0000', 'waive', { available: '5' })).toMatchObject({
      daysLeave: '0.00',
      daysSalary: '0.0000',
    });
  });
});

describe('مخططات الإدخال', () => {
  const policy = {
    isEnabled: true,
    ...base,
    defaultTarget: 'salary' as const,
    leaveTypeId: null,
    suggestActionAfter: null,
  };
  it('السياسة: رفض الهدف رصيداً بلا نوع إجازة، والشرائح الفارغة، وتكرار البداية', () => {
    expect(shortfallPolicyInput.safeParse(policy).success).toBe(true);
    expect(shortfallPolicyInput.safeParse({ ...policy, defaultTarget: 'leave' }).success).toBe(
      false,
    );
    expect(shortfallPolicyInput.safeParse({ ...policy, method: 'tiers' }).success).toBe(false);
    expect(
      shortfallPolicyInput.safeParse({
        ...policy,
        method: 'tiers',
        tiers: [
          { from: 2, dayFraction: '0.25' },
          { from: 2, dayFraction: '0.5' },
        ],
      }).success,
    ).toBe(false);
    expect(
      shortfallPolicyInput.safeParse({ ...policy, countLate: false, countEarly: false }).success,
    ).toBe(false);
  });
  it('القرار: التقسيم يحتاج أيام رصيد وغيره لا يقبلها', () => {
    const d = {
      employeeId: '0190a0a0-0000-7000-8000-000000000001',
      year: 2026,
      month: 9,
      reason: 'سبب',
    };
    expect(shortfallDecisionInput.safeParse({ ...d, target: 'split' }).success).toBe(false);
    expect(
      shortfallDecisionInput.safeParse({ ...d, target: 'split', leaveDays: '0.5' }).success,
    ).toBe(true);
    expect(
      shortfallDecisionInput.safeParse({ ...d, target: 'salary', leaveDays: '0.5' }).success,
    ).toBe(false);
    expect(shortfallDecisionInput.safeParse({ ...d, target: 'waive' }).success).toBe(true);
  });
});
