import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { PayslipDrawer } from './PayslipDrawer';
import { PeriodsPage } from './PeriodsPage';

const line = (o: Record<string, unknown>) => ({
  nameEn: null,
  autoAmount: null,
  isManual: false,
  isAdded: false,
  autoChanged: false,
  overrideReasonName: null,
  overrideNote: null,
  explain: {},
  ...o,
});
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/payroll/periods')
        return {
          data: [
            {
              id: 'p1',
              groupName: 'الرواتب الشهرية',
              year: 2026,
              month: 1,
              currency: 'SAR',
              status: 'approved',
              employeesCount: 2,
              netTotal: '4550.0000',
            },
          ],
        };
      if (path === '/payroll/payslips/s1')
        return {
          data: {
            id: 's1',
            employeeNo: 'E-1',
            employeeName: 'أحمد',
            netAmount: '2950.0000',
            error: null,
            lines: [
              line({
                id: 'l1',
                code: 'basic',
                nameAr: 'الراتب الأساسي',
                kind: 'earning',
                amount: '3000.0000',
              }),
              line({
                id: 'l2',
                code: 'housing',
                nameAr: 'سكن',
                kind: 'earning',
                amount: '900.0000',
                isManual: true,
                autoChanged: true,
                overrideReasonName: 'تصحيح',
                explain: { type: 'fixed' },
              }),
            ],
          },
        };
      return { data: [] };
    },
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
  useParams: () => ({}),
}));
vi.mock('../employees/shared', () => ({
  useLookup: () => ({ rows: [{ code: 'SAR' }], options: [], name: () => '' }),
}));

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

describe('الرواتب 7b: الدورات والقسيمة', () => {
  it('قائمة الدورات تعرض الحالة والصافي', async () => {
    wrap(<PeriodsPage />);
    expect(await screen.findByText('الرواتب الشهرية')).toBeTruthy();
    expect(screen.getByText('معتمدة')).toBeTruthy();
    expect(screen.getByText('4550.0000')).toBeTruthy();
  });

  it('القسيمة: شارة يدوي وتغيّر الآلي، و«كيف حُسب؟» يعرض الشرح', async () => {
    wrap(<PayslipDrawer slipId="s1" canOverride onClose={() => undefined} />);
    expect(await screen.findByText('سكن')).toBeTruthy();
    expect(screen.getByText('يدوي')).toBeTruthy();
    expect(screen.getByText('تغيّر الآلي')).toBeTruthy();
    // الأساسي لا يُعدَّل يدوياً: زر تعديل واحد فقط (للسكن)
    expect(screen.getAllByRole('button', { name: 'تعديل' })).toHaveLength(1);
    await userEvent.click(screen.getAllByRole('button', { name: 'كيف حُسب؟' })[1]!);
    expect(await screen.findByText(/"type": "fixed"/)).toBeTruthy();
  });
});
