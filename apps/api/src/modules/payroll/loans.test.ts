import { describe, expect, it } from 'vitest';
import { buildSchedule } from '@hrms/shared';
import { allocateInstallments } from './loans.js';

describe('جدول الأقساط', () => {
  it('أقساط متساوية والفرق على الأخير، وعبور السنة', () => {
    const s = buildSchedule('1000', 3, 2026, 11);
    expect(s.map((x) => x.amount)).toEqual(['333.3333', '333.3333', '333.3334']);
    expect(s.map((x) => [x.year, x.month])).toEqual([
      [2026, 11],
      [2026, 12],
      [2027, 1],
    ]);
    expect(s.reduce((a, x) => a + Number(x.amount), 0)).toBeCloseTo(1000, 4);
  });
});

describe('توزيع الأقساط على الصافي', () => {
  const due = (...amts: string[]) =>
    amts.map((a, i) => ({
      id: `i${i}`,
      loanId: 'l',
      no: i + 1,
      dueYear: 2026,
      dueMonth: 1,
      amount: a,
    }));
  it('يخصم الأقدم حتى السقف ويوقف عند أول ما لا يتسع', () => {
    const r = allocateInstallments('1000', 50, due('300', '300', '100'));
    expect(r.total).toBe('300.0000');
    expect(r.items.map((i) => i.overCap)).toEqual([false, true, true]);
  });
  it('صافٍ صفر أو سالب: لا خصم', () => {
    expect(allocateInstallments('-5', 50, due('10')).total).toBe('0.0000');
    expect(allocateInstallments('0', 50, due('10')).items[0]!.overCap).toBe(true);
  });
  it('سقف 100% يخصم كل شيء يتسع', () => {
    expect(allocateInstallments('1000', 100, due('600', '400')).total).toBe('1000.0000');
  });
});
