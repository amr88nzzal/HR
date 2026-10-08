import { describe, expect, it } from 'vitest';
import { buildTree } from './admin/OrgChartPage';
import { optionsToText, parseOptions } from './admin/CustomFieldsPage';
import { buildChangePayload } from './employees/EmploymentTab';

describe('شجرة الأقسام', () => {
  it('تبني الأبناء وتجعل الأب المفقود والذاتي جذراً', () => {
    const rows = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'zzz' },
      { id: 'd', parentId: 'd' },
    ];
    const roots = buildTree(rows);
    expect(roots.map((r) => r.row.id).sort()).toEqual(['a', 'c', 'd']);
    expect(roots.find((r) => r.row.id === 'a')?.children.map((c) => c.row.id)).toEqual(['b']);
  });
});

describe('خيارات القوائم', () => {
  it('تحلّل سطر القيمة|التسمية وترفض الناقص', () => {
    expect(parseOptions('S|صغير\n\nL|كبير | جداً')).toEqual([
      { value: 'S', labelAr: 'صغير' },
      { value: 'L', labelAr: 'كبير | جداً' },
    ]);
    expect(parseOptions('S')).toBeNull();
    expect(parseOptions('|x')).toBeNull();
    expect(parseOptions('')).toEqual([]);
    expect(parseOptions(null)).toEqual([]);
  });
  it('تذهب وتعود دون فقد', () => {
    const text = 'S|صغير\nL|كبير';
    expect(optionsToText(parseOptions(text))).toBe(text);
    expect(optionsToText(undefined)).toBe('');
  });
});

describe('حمولة تغيير التعيين', () => {
  const base = {
    effectiveDate: '2025-01-01',
    reasonId: '',
    notes: '  ',
    employment: {
      branchId: 'b1',
      departmentId: 'd1',
      jobTitleId: 't1',
      managerEmployeeId: null,
    },
  };
  it('ترسل حقول النوع المعروضة والمملوءة فقط', () => {
    const p = buildChangePayload({ ...base, changeType: 'promotion' });
    expect(p.employment).toEqual({ jobTitleId: 't1' });
    expect(p.reasonId).toBeNull();
    expect(p.notes).toBeNull();
  });
  it('الإيقاف والإنهاء بلا حقول تعيين', () => {
    expect(buildChangePayload({ ...base, changeType: 'termination' }).employment).toEqual({});
  });
  it('النقل يحمل الفرع والقسم', () => {
    expect(buildChangePayload({ ...base, changeType: 'transfer' }).employment).toEqual({
      branchId: 'b1',
      departmentId: 'd1',
    });
  });
});
