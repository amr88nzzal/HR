import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { DashboardPage } from '../../pages/DashboardPage';
import { ReportsPage } from './ReportsPage';
import { cellView } from './types';

const manifest = {
  code: 'employees.roster',
  module: 'employees',
  titleAr: 'قائمة الموظفين',
  titleEn: 'Employee roster',
  descriptionAr: 'وصف',
  descriptionEn: 'desc',
  filters: [
    {
      key: 'status',
      type: 'select',
      labelAr: 'الحالة',
      labelEn: 'Status',
      options: [{ value: 'active', labelAr: 'نشط', labelEn: 'Active' }],
    },
  ],
  columns: [
    { key: 'nameAr', labelAr: 'الاسم', labelEn: 'Name', type: 'text' },
    {
      key: 'status',
      labelAr: 'الحالة',
      labelEn: 'Status',
      type: 'enum',
      options: [{ value: 'active', labelAr: 'نشط', labelEn: 'Active' }],
    },
  ],
};

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ me: { displayName: 'مدير' } }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('../../lib/useFormat', () => ({
  useFormat: () => ({ date: (s: string) => s, dateTime: (s: string) => s }),
}));
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {
    code = 'X';
  },
  api: {
    get: async (path: string) => {
      if (path === '/reports') return { data: [manifest] };
      if (path === '/reports/employees.roster') return { data: { manifest, layouts: [] } };
      if (path === '/reports/employees.roster/run')
        return {
          data: [{ nameAr: 'أحمد', status: 'active' }],
          meta: { total: 1, columns: [{ key: 'nameAr' }, { key: 'status' }] },
        };
      if (path === '/dashboard/summary')
        return {
          data: {
            me: {
              employeeLinked: true,
              pendingApprovals: 2,
              leaveBalance: '12',
              pendingLeaveRequests: 0,
              latestPayslip: null,
              today: null,
            },
            payroll: {
              latestPeriod: {
                year: 2026,
                month: 1,
                status: 'locked',
                currency: 'SAR',
                employeesCount: 1,
                manualCount: 1,
                errorCount: 0,
                netTotal: '3150',
                payableTotal: '3150',
              },
            },
          },
        };
      return { data: [] };
    },
    blob: async () => new Blob(['x']),
    post: async () => ({ data: {} }),
    del: async () => ({ data: undefined }),
  },
}));

const wrap = (ui: React.ReactNode) => (
  <MantineProvider>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  </MantineProvider>
);

describe('مركز التقارير ولوحة المعلومات', () => {
  it('اختيار تقرير ثم عرض نتائجه مع تسمية الـ enum', async () => {
    render(wrap(<ReportsPage />));
    await userEvent.click(await screen.findByText('قائمة الموظفين'));
    await userEvent.click(await screen.findByRole('button', { name: 'عرض' }));
    expect(await screen.findByText('أحمد')).toBeTruthy();
    expect(screen.getByText('نشط', { selector: 'td' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /تصدير CSV/ })).toBeTruthy();
  });

  it('تسمية القيم والصيغ', () => {
    expect(cellView(manifest.columns[1] as never, 'active', 'en')).toBe('Active');
    expect(cellView(manifest.columns[0] as never, null, 'ar')).toBe('');
  });

  it('اللوحة تعرض قسم الرواتب لمن يملكه فقط وتلوّن التعديلات اليدوية', async () => {
    render(wrap(<DashboardPage />));
    expect(await screen.findByText('الرواتب')).toBeTruthy();
    expect(screen.getByText('قسائم بتعديل يدوي')).toBeTruthy();
    expect(screen.queryByText('على رأس العمل')).toBeNull();
    expect(screen.getByText('موافقات بانتظارك')).toBeTruthy();
  });
});
