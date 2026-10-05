import { describe, expect, it } from 'vitest';
import { formatEmployeeNo, isValidEmployeeNoFormat, normalizeSearch } from './text';

describe('normalizeSearch', () => {
  it('يوحّد الألف والياء والتاء المربوطة ويحذف التشكيل', () => {
    expect(normalizeSearch('أَحْمَد')).toBe('احمد');
    expect(normalizeSearch('إيمان')).toBe(normalizeSearch('ايمان'));
    expect(normalizeSearch('فاطمة')).toBe('فاطمه');
    expect(normalizeSearch('مصطفى')).toBe('مصطفي');
    expect(normalizeSearch('مـحـمـد')).toBe('محمد');
  });
  it('يحوّل الأرقام الهندية ويخفض الحروف اللاتينية', () => {
    expect(normalizeSearch('EMP-٠٠١٢')).toBe('emp-0012');
    expect(normalizeSearch('  A   B ')).toBe('a b');
  });
});

describe('صيغة الرقم الوظيفي', () => {
  it('تتحقق من الصيغة', () => {
    expect(isValidEmployeeNoFormat('EMP-{seq:5}')).toBe(true);
    expect(isValidEmployeeNoFormat('{yy}{seq:4}')).toBe(true);
    expect(isValidEmployeeNoFormat('EMP')).toBe(false);
    expect(isValidEmployeeNoFormat('EMP {seq:5}')).toBe(false);
  });
  it('تولّد الرقم', () => {
    expect(formatEmployeeNo('EMP-{seq:5}', 42)).toBe('EMP-00042');
    expect(formatEmployeeNo('{yy}-{seq:3}', 7, new Date('2026-05-01T00:00:00Z'))).toBe('26-007');
  });
});
