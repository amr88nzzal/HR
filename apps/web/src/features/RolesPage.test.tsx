import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { PermissionMatrix } from './RolesPage';

const catalog = [
  { code: 'system.branch.read', module: 'system', resource: 'branch', action: 'read' },
  { code: 'system.branch.create', module: 'system', resource: 'branch', action: 'create' },
  { code: 'org.department.read', module: 'org', resource: 'department', action: 'read' },
];

const renderMatrix = (value: string[], onChange = vi.fn(), readOnly = false) => {
  render(
    <MantineProvider>
      <PermissionMatrix
        catalog={catalog}
        value={new Set(value)}
        onChange={onChange}
        readOnly={readOnly}
      />
    </MantineProvider>,
  );
  return onChange;
};

describe('مصفوفة الصلاحيات', () => {
  it('تحديد خانة يضيف الصلاحية', async () => {
    const onChange = renderMatrix([]);
    await userEvent.click(screen.getByLabelText('system.branch.read'));
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(['system.branch.read']);
  });
  it('تحديد الكل للمورد يضيف كل إجراءاته', async () => {
    const onChange = renderMatrix(['org.department.read']);
    await userEvent.click(screen.getByLabelText('system.branch'));
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)].sort()).toEqual([
      'org.department.read',
      'system.branch.create',
      'system.branch.read',
    ]);
  });
  it('القراءة فقط تعطّل الخانات', () => {
    renderMatrix(['system.branch.read'], vi.fn(), true);
    expect(screen.getByLabelText('system.branch.read')).toBeDisabled();
  });
});
