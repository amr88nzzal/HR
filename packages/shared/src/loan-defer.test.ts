import { describe, expect, it } from 'vitest';
import { planDefer } from './loan.js';

const remaining = [
  { id: 'a', year: 2026, month: 8, amount: '100.0000' },
  { id: 'b', year: 2026, month: 9, amount: '100.0000' },
  { id: 'c', year: 2026, month: 10, amount: '100.0000' },
];
const base = { amount: '100.0000', dueYear: 2026, dueMonth: 7, remaining };

describe('planDefer', () => {
  it('شهر واحد (افتراضي): القسط كاملاً إلى الشهر القادم', () => {
    const p = planDefer({ ...base, mode: 'month', targetYear: 2026, targetMonth: 8 });
    expect(p).toMatchObject({ ok: true, full: true, keep: '0.0000' });
    if (p.ok)
      expect(p.rows).toEqual([
        { id: null, year: 2026, month: 8, add: '100.0000', total: '100.0000' },
      ]);
  });
  it('أقساط جديدة متعددة: الفرق على الأخير، وتعبر السنة', () => {
    const p = planDefer({
      ...base,
      deferAmount: '100',
      mode: 'month',
      targetYear: 2026,
      targetMonth: 12,
      count: 3,
    });
    if (!p.ok) throw new Error('x');
    expect(p.rows.map((r) => `${r.year}-${r.month}:${r.add}`)).toEqual([
      '2026-12:33.3333',
      '2027-1:33.3333',
      '2027-2:33.3334',
    ]);
  });
  it('التوزيع على المتبقي: كله أو أول عدد محدد', () => {
    const all = planDefer({ ...base, deferAmount: '30', mode: 'remaining' });
    if (!all.ok) throw new Error('x');
    expect(all).toMatchObject({ keep: '70.0000', full: false });
    expect(all.rows.map((r) => r.add)).toEqual(['10.0000', '10.0000', '10.0000']);
    const two = planDefer({ ...base, mode: 'remaining', count: 2 });
    if (!two.ok) throw new Error('x');
    expect(two.rows.map((r) => [r.id, r.add, r.total])).toEqual([
      ['a', '50.0000', '150.0000'],
      ['b', '50.0000', '150.0000'],
    ]);
  });
  it('الأخطاء', () => {
    expect(planDefer({ ...base, deferAmount: '0', mode: 'remaining' })).toMatchObject({
      ok: false,
      code: 'INVALID_DEFER_AMOUNT',
    });
    expect(planDefer({ ...base, deferAmount: '101', mode: 'remaining' })).toMatchObject({
      ok: false,
      code: 'INVALID_DEFER_AMOUNT',
    });
    expect(planDefer({ ...base, mode: 'month', targetYear: 2026, targetMonth: 7 })).toMatchObject({
      ok: false,
      code: 'INVALID_TARGET_MONTH',
    });
    expect(planDefer({ ...base, mode: 'remaining', count: 4 })).toMatchObject({
      ok: false,
      code: 'INVALID_COUNT',
    });
    expect(planDefer({ ...base, remaining: [], mode: 'remaining' })).toMatchObject({
      ok: false,
      code: 'NO_REMAINING',
    });
  });
});
