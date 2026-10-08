import { describe, expect, it } from 'vitest';
import { isGroup, permissionForPath, visibleNav } from './nav';

const keys = (perms: string[]) =>
  visibleNav(perms).flatMap((n) => (isGroup(n) ? n.items.map((i) => i.key) : [n.key]));

describe('القائمة تُبنى من الصلاحيات', () => {
  it('بلا صلاحيات تظهر الرئيسية فقط وتختفي المجموعات الفارغة', () => {
    expect(keys([])).toEqual(['dashboard']);
    expect(visibleNav([]).some(isGroup)).toBe(false);
  });
  it('تظهر العناصر المطابقة فقط', () => {
    expect(keys(['system.branch.read', 'identity.user.read'])).toEqual([
      'dashboard',
      'branches',
      'users',
    ]);
  });
  it('مدير النظام يرى كل شيء', () => {
    expect(
      keys([
        'system.branch.read',
        'org.department.read',
        'org.job_title.read',
        'org.job_grade.read',
        'org.work_location.read',
        'org.cost_center.read',
        'system.currency.read',
        'identity.user.read',
        'identity.role.read',
        'system.setting.read',
        'system.audit.read',
        'employees.employee.read',
        'archive.document.read',
        'archive.document_type.read',
        'org.external_system.read',
        'org.custom_field.read',
        'employees.employee.import',
      ]).length,
    ).toBe(19);
  });
  it('صلاحية المسار', () => {
    expect(permissionForPath('/admin/audit')).toBe('system.audit.read');
    expect(permissionForPath('/')).toBeUndefined();
  });
});
