import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { LoansPanel } from './LoansPanel';
import { PayslipDrawer } from './PayslipDrawer';

vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/payroll/loans')
        return {
          data: [
            {
              id: 'l1',
              employeeNo: 'E-1',
              employeeName: 'أحمد',
              kind: 'loan',
              currency: 'SAR',
              principal: '3000.0000',
              repaid: '1000.0000',
              remaining: '2000.0000',
              status: 'active',
            },
          ],
        };
      if (path === '/payroll/loans/l1')
        return {
          data: {
            id: 'l1',
            employeeNo: 'E-1',
            employeeName: 'أحمد',
            kind: 'loan',
            currency: 'SAR',
            principal: '3000.0000',
            repaid: '1000.0000',
            remaining: '2000.0000',
            status: 'active',
            reason: null,
            cancelReason: null,
            payments: [],
            installments: [
              {
                id: 'i1',
                no: 1,
                dueYear: 2026,
                dueMonth: 1,
                amount: '1000.0000',
                status: 'deducted',
              },
              {
                id: 'i2',
                no: 2,
                dueYear: 2026,
                dueMonth: 2,
                amount: '1000.0000',
                status: 'scheduled',
              },
            ],
          },
        };
      if (path === '/payroll/payslips/s1')
        return {
          data: {
            id: 's1',
            employeeNo: 'E-1',
            employeeName: 'أحمد',
            netAmount: '3150.0000',
            loansAmount: '1000.0000',
            payableAmount: '2150.0000',
            loanItems: [
              {
                installmentId: 'i1',
                amount: '1000.0000',
                overCap: false,
                no: 1,
                dueYear: 2026,
                dueMonth: 1,
                kind: 'loan',
                installmentsCount: 3,
              },
            ],
            error: null,
            lines: [],
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
vi.mock('../employees/shared', () => ({
  useLookup: () => ({ rows: [{ code: 'SAR' }], options: [], name: () => '' }),
}));
vi.mock('../employees/EmployeeSelect', () => ({ EmployeeSelect: () => <div /> }));

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

describe('الرواتب 7c: السلف', () => {
  it('القائمة تعرض المسدَّد والمتبقي، والتفاصيل تعرض الأقساط وزر التأجيل للمجدول فقط', async () => {
    wrap(<LoansPanel />);
    expect(await screen.findByText('2000.0000')).toBeTruthy();
    await userEvent.click(screen.getByText('E-1 · أحمد'));
    expect(await screen.findByText('مخصوم')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'تأجيل' })).toHaveLength(1);
  });

  it('القسيمة: القسط في سطر مستقل بعد الصافي ثم المستحق للدفع', async () => {
    wrap(<PayslipDrawer slipId="s1" canOverride={false} onClose={() => undefined} />);
    expect(await screen.findByText('الصافي: 3150.0000')).toBeTruthy();
    expect(screen.getByText('قسط السلف: 1000.0000')).toBeTruthy();
    expect(screen.getByText('المستحق للدفع: 2150.0000')).toBeTruthy();
  });
});
