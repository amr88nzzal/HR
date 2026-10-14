import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ComponentsPanel } from './ComponentsPanel';
import { SalaryTab } from './SalaryTab';

const state = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[] }));
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/payroll/variables')
        return { data: [{ key: 'basic', labelAr: 'الراتب الأساسي', labelEn: 'Basic salary' }] };
      if (path === '/payroll/components')
        return {
          data: [
            {
              id: 'c1',
              code: 'housing',
              nameAr: 'بدل سكن',
              nameEn: null,
              kind: 'earning',
              calcType: 'fixed',
              fixedAmount: '500.0000',
              percent: null,
              baseId: null,
              formula: null,
              rateTableId: null,
              roundingDecimals: 2,
              displayOrder: 100,
              isActive: true,
              version: 1,
            },
          ],
        };
      if (path === '/employees/e1/salaries')
        return {
          data: [
            {
              id: 's2',
              structureId: null,
              structureName: null,
              currency: 'SAR',
              basicAmount: '5500.0000',
              validFrom: '2025-07-01',
              validTo: null,
              note: null,
              version: 1,
              components: [],
            },
            {
              id: 's1',
              structureId: 'st1',
              structureName: 'الهيكل العام',
              currency: 'SAR',
              basicAmount: '5000.0000',
              validFrom: '2025-01-01',
              validTo: '2025-06-30',
              note: null,
              version: 2,
              components: [],
            },
          ],
        };
      return { data: [] };
    },
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: {} };
    },
    patch: async () => ({ data: {} }),
    del: async () => ({ data: undefined }),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../lib/useFormat', () => ({
  useFormat: () => ({ date: (v: unknown) => String(v ?? '—') }),
}));

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('الرواتب: الإعداد ورواتب الموظف', () => {
  beforeEach(() => {
    state.posts.length = 0;
  });

  it('مكوّن بصيغة: إدراج متغير بالنقر ثم الحفظ يرسل الجسم الصحيح', async () => {
    wrap(<ComponentsPanel />);
    expect(await screen.findByText('بدل سكن')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    await userEvent.type(await screen.findByLabelText('الرمز'), 'late_ded');
    await userEvent.type(screen.getByLabelText('الاسم بالعربية'), 'خصم تأخير');
    // نوع الاحتساب ← صيغة
    await userEvent.click(screen.getByRole('combobox', { name: 'طريقة الاحتساب' }));
    await userEvent.click(await screen.findByText('صيغة'));
    await userEvent.click(await screen.findByText('الراتب الأساسي'));
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]?.path).toBe('/payroll/components');
    expect(state.posts[0]?.body).toMatchObject({
      code: 'late_ded',
      calcType: 'formula',
      formula: 'basic',
      fixedAmount: null,
    });
  });

  it('صيغة غير صالحة تُرفض في الواجهة قبل الإرسال', async () => {
    wrap(<ComponentsPanel />);
    await screen.findByText('بدل سكن');
    await userEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    await userEvent.type(await screen.findByLabelText('الرمز'), 'x1');
    await userEvent.type(screen.getByLabelText('الاسم بالعربية'), 'س');
    await userEvent.click(screen.getByRole('combobox', { name: 'طريقة الاحتساب' }));
    await userEvent.click(await screen.findByText('صيغة'));
    await userEvent.type(screen.getByLabelText(/^الصيغة/), 'process.exit()');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByText(/formula/)).toBeTruthy();
    expect(state.posts).toHaveLength(0);
  });

  it('رواتب الموظف: الخط الزمني والحالي، وحذف الأحدث فقط', async () => {
    wrap(<SalaryTab employeeId="e1" />);
    expect(await screen.findByText('2025-07-01')).toBeTruthy();
    expect(screen.getByText('الحالي')).toBeTruthy();
    expect(screen.getByText('الهيكل العام')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'حذف الأحدث' })).toHaveLength(1);
  });
});
