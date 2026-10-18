import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { AdjustmentsPage } from './AdjustmentsPage';

const state = vi.hoisted(() => ({
  posts: [] as { path: string; body: unknown }[],
  mode: 'both' as string,
}));
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/attendance-corrections/policy')
        return { data: { mode: state.mode, windowDays: 14 } };
      if (path === '/attendance-corrections/me')
        return {
          data: [
            {
              id: 'c1',
              employeeId: 'e1',
              employeeName: 'أحمد',
              dayDate: '2026-10-01',
              inAt: '2026-10-01T05:00:00Z',
              outAt: '2026-10-01T13:00:00Z',
              reason: 'نسيت البصمة',
              method: 'request',
              status: 'pending',
            },
          ],
          meta: { total: 1 },
        };
      return { data: [], meta: { total: 0 } };
    },
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: {} };
    },
    put: async () => ({ data: {} }),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../employees/EmployeeSelect', () => ({ EmployeeSelect: () => null }));

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <ModalsProvider>
          <AdjustmentsPage all={false} />
        </ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('طلبات تعديل الحضور', () => {
  beforeEach(() => {
    state.posts.length = 0;
    state.mode = 'both';
  });

  it('يعرض طلباتي ويسمح بالسحب', async () => {
    wrap();
    expect(await screen.findByText('نسيت البصمة')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'سحب' }));
    // تأكيد قبل التنفيذ: لا طلب قبل الضغط على «نعم»
    expect(state.posts).toHaveLength(0);
    await userEvent.click(await screen.findByRole('button', { name: 'نعم، اسحب الطلب' }));
    await waitFor(() =>
      expect(state.posts).toContainEqual({ path: '/attendance-corrections/c1/withdraw', body: {} }),
    );
  });

  it('تقديم طلب تعديل يرسل الأوقات والسبب', async () => {
    wrap();
    await userEvent.click(await screen.findByRole('button', { name: 'طلب تعديل حضور' }));
    fireEvent.change(await screen.findByLabelText('السبب'), { target: { value: 'عطل' } });
    await userEvent.click(screen.getByRole('button', { name: 'تقديم الطلب' }));
    await waitFor(() =>
      expect(state.posts.some((p) => p.path === '/attendance-corrections')).toBe(true),
    );
    const body = state.posts.find((p) => p.path === '/attendance-corrections')?.body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      inTime: '08:00',
      outTime: '16:00',
      outNextDay: false,
      reason: 'عطل',
    });
  });
});
