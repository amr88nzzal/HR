import { describe, expect, it } from 'vitest';
import {
  addMonths,
  allocateFifo,
  carryOver,
  dueAccruals,
  fromCents,
  toCents,
  type AccrualPolicy,
} from './engine.js';

const monthly = (annual: number, minService = 0): AccrualPolicy => ({
  annualEntitlement: annual,
  accrualMethod: 'monthly',
  minServiceMonths: minService,
});
const sum = (a: { cents: number }[]) => a.reduce((s, x) => s + x.cents, 0);

describe('الاستحقاق الشهري (golden)', () => {
  it('21 يوماً: 1.75 شهرياً، وحتى أكتوبر 17.50', () => {
    const due = dueAccruals(monthly(21), '2020-03-10', '2026-10-11');
    expect(due).toHaveLength(10);
    expect(due.every((d) => d.cents === 175)).toBe(true);
    expect(due[0]).toMatchObject({ period: '2026-01', effectiveDate: '2026-01-01' });
    expect(fromCents(sum(due))).toBe('17.50');
  });

  it('لا انجراف: 22 يوماً تجتمع 22.00 بالضبط في ديسمبر', () => {
    const due = dueAccruals(monthly(22), '2020-01-01', '2026-12-31');
    expect(due).toHaveLength(12);
    expect(sum(due)).toBe(2200);
  });

  it('تعيين في منتصف السنة: بالتناسب لشهر التعيين ثم كاملاً (استحقاق 24)', () => {
    // التعيين 2026-04-16: أبريل 15 يوماً من 30 → نصف 2.00 = 1.00
    const due = dueAccruals(monthly(24), '2026-04-16', '2026-06-20');
    expect(due.map((d) => [d.period, d.cents, d.effectiveDate])).toEqual([
      ['2026-04', 100, '2026-04-16'],
      ['2026-05', 200, '2026-05-01'],
      ['2026-06', 200, '2026-06-01'],
    ]);
  });

  it('تعيين في أول الشهر يستحق الشهر كاملاً، وتعيين في المستقبل لا يستحق', () => {
    expect(dueAccruals(monthly(24), '2026-10-01', '2026-10-11')).toEqual([
      { period: '2026-10', cents: 200, effectiveDate: '2026-10-01' },
    ]);
    expect(dueAccruals(monthly(24), '2026-10-20', '2026-10-11')).toEqual([]);
    expect(dueAccruals(monthly(24), '2027-01-01', '2026-10-11')).toEqual([]);
  });

  it('مدة الخدمة الدنيا: لا استحقاق قبل انقضائها ثم يبدأ من يوم الأهلية', () => {
    // تعيين 2026-01-15 + 6 أشهر = 2026-07-15
    const due = dueAccruals(monthly(24, 6), '2026-01-15', '2026-09-30');
    expect(due.map((d) => d.period)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(due[0]).toMatchObject({ effectiveDate: '2026-07-15' });
    expect(due[0]?.cents).toBe(Math.round((200 * 17) / 31));
    expect(dueAccruals(monthly(24, 6), '2026-05-01', '2026-09-30')).toEqual([]);
  });

  it('استحقاق صفر لا يولّد قيوداً', () => {
    expect(dueAccruals(monthly(0), '2020-01-01', '2026-10-11')).toEqual([]);
  });
});

describe('الاستحقاق المقدَّم (upfront)', () => {
  const up = (annual: number): AccrualPolicy => ({
    annualEntitlement: annual,
    accrualMethod: 'upfront',
    minServiceMonths: 0,
  });
  it('قديم الخدمة: كامل الرصيد أول السنة', () => {
    expect(dueAccruals(up(30), '2019-05-01', '2026-10-11')).toEqual([
      { period: '2026', cents: 3000, effectiveDate: '2026-01-01' },
    ]);
  });
  it('تعيين خلال السنة: بالتناسب بأيام السنة المتبقية', () => {
    // 2026-07-02: اليوم 182 من 365 (ترتيب 0-based)، المتبقي 365-182=183
    const [d] = dueAccruals(up(30), '2026-07-02', '2026-10-11');
    expect(d?.period).toBe('2026');
    expect(d?.cents).toBe(Math.round((3000 * 183) / 365));
    expect(d?.effectiveDate).toBe('2026-07-02');
  });
});

describe('الترحيل والانتهاء', () => {
  it('الترحيل = الأقل من المتبقي والسقف، وللمرحَّل انتهاء بعد المدة', () => {
    expect(carryOver(800, { carryOverMax: 5, carryOverValidMonths: 3 }, 2027)).toEqual({
      carryCents: 500,
      expiresOn: '2027-04-01',
    });
    expect(carryOver(300, { carryOverMax: 5, carryOverValidMonths: 3 }, 2027).carryCents).toBe(300);
  });
  it('بلا ترحيل (سقف 0) أو بلا رصيد: صفر وبلا انتهاء', () => {
    expect(carryOver(800, { carryOverMax: 0, carryOverValidMonths: 3 }, 2027)).toEqual({
      carryCents: 0,
      expiresOn: null,
    });
    expect(carryOver(0, { carryOverMax: 5, carryOverValidMonths: null }, 2027).carryCents).toBe(0);
  });
  it('بلا مدة صلاحية: لا انتهاء للمرحَّل', () => {
    expect(
      carryOver(800, { carryOverMax: 5, carryOverValidMonths: null }, 2027).expiresOn,
    ).toBeNull();
  });
  it('إضافة الأشهر تثبّت آخر الشهر', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('الاستهلاك FIFO', () => {
  const lots = [
    { id: 'new', remainingCents: 500, effectiveDate: '2027-02-01', expiresOn: null },
    { id: 'carry', remainingCents: 300, effectiveDate: '2027-01-01', expiresOn: '2027-04-01' },
  ];
  it('يستهلك الأقدم (المرحَّل) أولاً ثم الأحدث', () => {
    const r = allocateFifo(lots, 600, '2027-03-01');
    expect(r.allocations).toEqual([
      { lotId: 'carry', cents: 300 },
      { lotId: 'new', cents: 300 },
    ]);
    expect(r.shortfallCents).toBe(0);
  });
  it('الدفعة المنتهية بتاريخ الاستهلاك لا تُستعمل', () => {
    const r = allocateFifo(lots, 600, '2027-04-01');
    expect(r.allocations).toEqual([{ lotId: 'new', cents: 500 }]);
    expect(r.shortfallCents).toBe(100);
  });
  it('النقص يعود كعجز، والكمية صفر لا تخصيص', () => {
    expect(allocateFifo([], 100, '2027-01-01')).toEqual({ allocations: [], shortfallCents: 100 });
    expect(allocateFifo(lots, 0, '2027-01-01').allocations).toEqual([]);
  });
  it('الكسور بالسنتي: 0.5 يوم', () => {
    expect(toCents('1.75')).toBe(175);
    const r = allocateFifo(
      [{ id: 'a', remainingCents: 175, effectiveDate: '2027-01-01', expiresOn: null }],
      toCents(0.5),
      '2027-02-01',
    );
    expect(r.allocations).toEqual([{ lotId: 'a', cents: 50 }]);
  });
});
