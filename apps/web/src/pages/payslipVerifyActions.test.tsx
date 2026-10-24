import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { PayslipVerifyActions } from './PayslipVerifyActions';

const calls: { path: string; body: unknown }[] = [];
vi.mock('../api/client', () => ({
  api: {
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path.endsWith('/check')) return { data: { match: false } };
      return {
        data: {
          holder: 'أحمد علي',
          employeeNo: 'E-1',
          year: 2026,
          month: 9,
          currency: 'SAR',
          earnings: [{ name: 'الأساسي', amount: '5000.00' }],
          deductions: [],
          loans: [],
          gross: '5000.00',
          deductionsTotal: '0.00',
          net: '5000.00',
          loansTotal: '0.00',
          payable: '5000.00',
        },
      };
    },
  },
}));

const wrap = (methods: object) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <PayslipVerifyActions
          token="t"
          methods={{
            figures: true,
            otpTelegram: false,
            otpEmail: false,
            secret: 'birthDate',
            ...methods,
          }}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('إجراءات التحقق العام من القسيمة', () => {
  it('مطابقة الأرقام تعرض عدم التطابق دون كشف أرقام', async () => {
    wrap({});
    const u = userEvent.setup();
    const inputs = screen.getAllByRole('textbox');
    await u.type(inputs[0] as HTMLElement, '5000');
    await u.type(inputs[1] as HTMLElement, '0');
    await u.type(inputs[2] as HTMLElement, '5000');
    await u.click(screen.getByRole('button', { name: 'تحقق من الأرقام' }));
    expect(await screen.findByText(/غير مطابقة/)).toBeTruthy();
    expect(calls.at(-1)?.path).toBe('/public/verify/payslip/t/check');
  });
  it('القيمة السرية الصحيحة تكشف القسيمة كاملة', async () => {
    wrap({ figures: false });
    const u = userEvent.setup();
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    await u.type(date, '1990-05-17');
    await u.click(screen.getByRole('button', { name: 'عرض' }));
    expect(await screen.findByText('الأساسي')).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({ body: { secret: '1990-05-17' } });
  });
});
