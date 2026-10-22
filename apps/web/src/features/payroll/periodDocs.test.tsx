import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GlSettingsPanel } from './GlSettingsPanel';
import { PeriodDocsMenu } from './PeriodDocsMenu';

const state = vi.hoisted(() => ({
  blobs: [] as { path: string; query: unknown }[],
  puts: [] as { path: string; body: Record<string, unknown> }[],
  journalUnmapped: 0,
}));
vi.mock('../../lib/export', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path.endsWith('/bank-transfer'))
        return {
          data: {
            rows: 3,
            total: '9000.0000',
            currency: 'SAR',
            missing: [{ employeeNo: 'E-009', name: 'سعد بلا حساب' }],
          },
        };
      if (path.endsWith('/journal'))
        return {
          data: {
            debit: '10',
            credit: '10',
            balanced: true,
            unmapped: Array.from({ length: state.journalUnmapped }, () => ({ description: 'x' })),
          },
        };
      return { data: { salariesPayable: '2200', loansReceivable: null, defaultExpense: null } };
    },
    blob: async (path: string, query: unknown) => {
      state.blobs.push({ path, query });
      return new Blob(['x']);
    },
    put: async (path: string, body: Record<string, unknown>) => {
      state.puts.push({ path, body });
      return { data: {} };
    },
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

describe('مستندات الدورة', () => {
  beforeEach(() => {
    state.blobs.length = 0;
    state.puts.length = 0;
    state.journalUnmapped = 0;
  });

  it('ملف البنك: يعرض الملخص والموظفين بلا حساب قبل التنزيل', async () => {
    wrap(<PeriodDocsMenu periodId="p1" status="approved" />);
    await userEvent.click(screen.getByRole('button', { name: 'مستندات الدورة' }));
    await userEvent.click(await screen.findByText('ملف تحويل البنك (Excel)'));
    expect(await screen.findByText(/3 حوالة/)).toBeTruthy();
    expect(screen.getByText(/E-009/)).toBeTruthy();
    expect(state.blobs).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'تنزيل' }));
    await waitFor(() => expect(state.blobs).toHaveLength(1));
    expect(state.blobs[0]?.path).toBe('/payroll/periods/p1/bank-transfer');
  });

  it('القيد: متوازن ومربوط ينزل مباشرة، وبه بنود غير مربوطة يحذّر أولاً', async () => {
    wrap(<PeriodDocsMenu periodId="p1" status="locked" />);
    await userEvent.click(screen.getByRole('button', { name: 'مستندات الدورة' }));
    await userEvent.click(await screen.findByText('قيد المحاسبة (CSV)'));
    await waitFor(() => expect(state.blobs).toHaveLength(1));
    state.journalUnmapped = 2;
    await userEvent.click(screen.getByRole('button', { name: 'مستندات الدورة' }));
    await userEvent.click(await screen.findByText('قيد المحاسبة (CSV)'));
    expect(await screen.findByText(/2 سطر بلا حساب/)).toBeTruthy();
    expect(state.blobs).toHaveLength(1);
  });

  it('المسودة: لا ملف بنك ولا قيد، وكشف الإدارة فقط', async () => {
    wrap(<PeriodDocsMenu periodId="p1" status="draft" />);
    await userEvent.click(screen.getByRole('button', { name: 'مستندات الدورة' }));
    expect(await screen.findByText('كشف الإدارة للتوقيع (PDF)')).toBeTruthy();
    expect(screen.queryByText('ملف تحويل البنك (Excel)')).toBeNull();
    expect(screen.queryByText('قيد المحاسبة (Excel)')).toBeNull();
  });
});

describe('حسابات المحاسبة', () => {
  it('تحمّل القيم وتحفظ الفارغ كـ null', async () => {
    wrap(<GlSettingsPanel />);
    const first = await screen.findByDisplayValue('2200');
    await userEvent.clear(first);
    await userEvent.type(first, '2210');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ الحسابات' }));
    await waitFor(() => expect(state.puts).toHaveLength(1));
    expect(state.puts[0]?.path).toBe('/payroll/gl-settings');
    expect(state.puts[0]?.body).toEqual({
      salariesPayable: '2210',
      loansReceivable: null,
      defaultExpense: null,
    });
  });
});
