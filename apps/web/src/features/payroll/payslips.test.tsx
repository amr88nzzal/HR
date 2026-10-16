import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ComparePanel, isBig, lineColor, type CompareRow } from './ComparePanel';
import { MyPayslipsPage } from './MyPayslipsPage';

vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/me/payslips')
        return {
          data: [
            {
              id: 's1',
              year: 2026,
              month: 1,
              currency: 'SAR',
              gross: '3500',
              deductions: '350',
              net: '3150.0000',
              loans: '0',
              payable: '3150.0000',
            },
          ],
        };
      return { data: {} };
    },
    blob: async () => new Blob(['x']),
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

const row = (id: string, pct: string | null, diff: string): CompareRow => ({
  employeeId: id,
  employeeNo: id,
  employeeName: `موظف ${id}`,
  net: '100',
  prevNet: '90',
  diff,
  pct,
  loans: '0',
  prevLoans: '0',
  lines: [
    {
      code: 'basic',
      nameAr: 'الأساسي',
      kind: 'earning',
      cur: '3500',
      prev: '3000',
      diff: '500',
      pct: '16.67',
    },
    {
      code: 'social',
      nameAr: 'تأمينات',
      kind: 'deduction',
      cur: '350',
      prev: '300',
      diff: '50',
      pct: '16.67',
    },
  ],
});

describe('قسائم الموظف 7d', () => {
  it('الأرقام مخفية افتراضياً وتظهر بالضغط على إظهار', async () => {
    render(wrap(<MyPayslipsPage />));
    expect(await screen.findAllByText('••••••')).not.toHaveLength(0);
    expect(screen.queryByText('3150.00')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /إظهار الأرقام/ }));
    expect((await screen.findAllByText('3150.00')).length).toBeGreaterThan(0);
  });

  it('لون الفرق يتبع أثره على الموظف: زيادة الاستقطاع سيئة', () => {
    expect(lineColor('earning', '10')).toBe('teal');
    expect(lineColor('earning', '-10')).toBe('red');
    expect(lineColor('deduction', '10')).toBe('red');
    expect(lineColor('deduction', '-10')).toBe('teal');
    expect(lineColor('earning', '0')).toBe('dimmed');
  });

  it('الفرق الكبير: عتبة النسبة، ونسبة غير معرّفة تُعدّ كبيرة', () => {
    expect(isBig('9.9', 10)).toBe(false);
    expect(isBig('-10', 10)).toBe(true);
    expect(isBig(null, 10)).toBe(true);
  });

  it('المقارنة: توسيع الصف يُظهر فروق البنود، والمرشّح يُخفي الصغيرة', async () => {
    render(wrap(<ComparePanel rows={[row('E1', '2', '2'), row('E2', '40', '40')]} />));
    expect(screen.queryByText('الأساسي')).toBeNull();
    await userEvent.click(screen.getByText('E2 · موظف E2'));
    expect(screen.getByText('الأساسي')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('الفروق الكبيرة فقط'));
    expect(screen.queryByText('E1 · موظف E1')).toBeNull();
    expect(screen.getByText('E2 · موظف E2')).toBeTruthy();
  });
});
