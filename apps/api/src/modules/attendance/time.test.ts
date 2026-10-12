import { describe, expect, it } from 'vitest';
import { addDays, diffDays, localParts, localToUtc } from './time';

describe('الزمن المحلي', () => {
  it('عمّان صيفاً (UTC+3): 08:00 محلياً = 05:00 UTC', () => {
    const t = localToUtc('2026-07-10', '08:00', 'Asia/Amman');
    expect(t.toISOString()).toBe('2026-07-10T05:00:00.000Z');
    expect(localParts(t, 'Asia/Amman')).toEqual({ date: '2026-07-10', minute: 480 });
  });
  it('الرياض (UTC+3 ثابت) وعبور منتصف الليل', () => {
    const t = localToUtc('2026-10-11', '23:30', 'Asia/Riyadh');
    expect(t.toISOString()).toBe('2026-10-11T20:30:00.000Z');
    expect(localParts(new Date('2026-10-11T21:30:00Z'), 'Asia/Riyadh')).toEqual({
      date: '2026-10-12',
      minute: 30,
    });
  });
  it('إضافة الأيام والفرق', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-10-12', '2026-10-10')).toBe(2);
  });
});
