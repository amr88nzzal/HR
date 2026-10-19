import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ShortfallPage } from './ShortfallPage';

const state = vi.hoisted(() => ({
  puts: [] as { path: string; body: Record<string, unknown> }[],
}));
const row = {
  id: 'e1',
  employeeId: 'e1',
  employeeNo: 'E-001',
  employeeName: 'سعد الأحمد',
  departmentName: 'المبيعات',
  payslipStatus: 'draft',
  lateMinutes: 120,
  earlyMinutes: 60,
  occurrences: 5,
  chargeableMinutes: 120,
  daysDue: '0.2500',
  target: 'salary',
  decided: false,
  decisionReason: null,
  available: '1.00',
  daysLeave: '0.00',
  daysSalary: '0.2500',
  balanceShort: false,
  suggestAction: true,
};
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/payroll/shortfall/report')
        return { data: [row], meta: { total: 1, policyEnabled: true } };
      if (path === '/payroll/shortfall/policy')
        return {
          data: {
            isEnabled: true,
            method: 'minutes',
            countLate: true,
            countEarly: true,
            monthlyFreeMinutes: 60,
            minutesPerDay: 480,
            tiers: [],
            defaultTarget: 'salary',
            leaveTypeId: null,
            suggestActionAfter: 5,
            version: 1,
          },
        };
      return { data: [], meta: { total: 0 } };
    },
    put: async (path: string, body: Record<string, unknown>) => {
      state.puts.push({ path, body });
      return { data: {} };
    },
    del: async () => ({ data: undefined }),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <ModalsProvider>
          <ShortfallPage />
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('نقص الدوام', () => {
  beforeEach(() => {
    state.puts.length = 0;
  });

  it('التقرير يعرض الموظف والدقائق وعلامة اقتراح الإجراء، وقرار «إعفاء» يُرسل بسبب', async () => {
    wrap();
    expect(await screen.findByText('سعد الأحمد')).toBeTruthy();
    expect(screen.getByText('اقترح إجراءً')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'قرار الخصم' }));
    await userEvent.click(await screen.findByText('إعفاء'));
    // السبب إلزامي: الحفظ معطّل حتى يُكتب
    const save = screen.getByRole('button', { name: 'حفظ' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('سبب القرار'), 'ظرف قاهر');
    await userEvent.click(save);
    await waitFor(() =>
      expect(state.puts).toContainEqual({
        path: '/payroll/shortfall/decisions',
        body: expect.objectContaining({
          employeeId: 'e1',
          target: 'waive',
          reason: 'ظرف قاهر',
        }),
      }),
    );
  });

  it('السياسة: الحفظ لا يُفعَّل قبل التعديل ويرسل القيم المعدّلة', async () => {
    wrap();
    await userEvent.click(await screen.findByRole('tab', { name: 'السياسة' }));
    const save = (await screen.findByRole('button', { name: 'حفظ' })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const free = screen.getByLabelText(/سماحية شهرية/);
    await userEvent.clear(free);
    await userEvent.type(free, '90');
    await userEvent.click(save);
    await waitFor(() =>
      expect(state.puts).toContainEqual({
        path: '/payroll/shortfall/policy',
        body: expect.objectContaining({ monthlyFreeMinutes: 90, method: 'minutes' }),
      }),
    );
  });
});
