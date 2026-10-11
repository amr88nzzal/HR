import { describe, expect, it } from 'vitest';
import { monthGrid, requestsOn, weekdayOf, type CalRequest } from './calendar';

const req = (id: string, startDate: string, endDate: string): CalRequest => ({
  id,
  employeeId: 'e',
  employeeName: 'س',
  typeNameAr: 'سنوية',
  typeNameEn: null,
  color: null,
  startDate,
  endDate,
  status: 'approved',
  chargedDays: '1.00',
});

describe('تقويم الإجازات', () => {
  it('الشبكة 42 يوماً تبدأ بالأحد وتحوي الشهر كاملاً', () => {
    const g = monthGrid(2026, 9); // أكتوبر 2026
    expect(g).toHaveLength(42);
    expect(weekdayOf(g[0] as string)).toBe(0);
    expect(g).toContain('2026-10-01');
    expect(g).toContain('2026-10-31');
    expect(g[0]).toBe('2026-09-27');
  });

  it('الطلب يغطي طرفيه ويتخطى خارجهما', () => {
    const rs = [req('a', '2026-10-05', '2026-10-07')];
    expect(requestsOn(rs, '2026-10-04')).toHaveLength(0);
    expect(requestsOn(rs, '2026-10-05')).toHaveLength(1);
    expect(requestsOn(rs, '2026-10-07')).toHaveLength(1);
    expect(requestsOn(rs, '2026-10-08')).toHaveLength(0);
  });
});
