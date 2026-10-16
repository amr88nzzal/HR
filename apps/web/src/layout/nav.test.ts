import { describe, expect, it } from 'vitest';
import { isGroup, permissionForPath, visibleNav } from './nav';

const keys = (perms: string[]) =>
  visibleNav(perms).flatMap((n) => (isGroup(n) ? n.items.map((i) => i.key) : [n.key]));

describe('القائمة تُبنى من الصلاحيات', () => {
  it('بلا صلاحيات تظهر الرئيسية فقط وتختفي المجموعات الفارغة', () => {
    // الموافقات والتفويض متاحان لكل مستخدم (بلا صلاحية)، وسلاسل الموافقة بصلاحية
    expect(keys([])).toEqual(['dashboard', 'myPayslips', 'approvalsInbox', 'approvalDelegations']);
  });
  it('تظهر العناصر المطابقة فقط', () => {
    expect(keys(['system.branch.read', 'identity.user.read'])).toEqual([
      'dashboard',
      'myPayslips',
      'approvalsInbox',
      'approvalDelegations',
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
        'system.job.read',
        'system.notification_template.read',
        'system.integration.read',
        'approvals.flow.read',
        'leave.request.submit',
        'leave.balance.read',
        'leave.type.read',
        'leave.policy.read',
        'leave.holiday.read',
        'attendance.day.read_all',
        'attendance.punch.create',
        'attendance.import.read',
        'attendance.import_profile.read',
        'attendance.shift.read',
        'attendance.schedule.read',
        'attendance.correction.submit',
        'attendance.correction.read_all',
        'letters.document.read',
        'letters.template.read',
      ]).length,
    ).toBe(45);
  });
  it('صلاحية المسار', () => {
    expect(permissionForPath('/admin/audit')).toBe('system.audit.read');
    expect(permissionForPath('/')).toBeUndefined();
  });
});
