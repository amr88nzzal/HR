import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { DailyBoardPage } from './DailyBoardPage';
import { MyAttendancePage } from './MyAttendancePage';
import { PunchEntryPage } from './PunchEntryPage';

const state = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[] }));
const day = (over: object) => ({
  id: 'd1',
  employeeId: 'e1',
  dayDate: '2026-09-06',
  computedStatus: 'present',
  status: 'present',
  shiftId: null,
  scheduledMinutes: 480,
  firstIn: '2026-09-06T05:25:00Z',
  lastOut: '2026-09-06T13:00:00Z',
  workedMinutes: 455,
  lateMinutes: 25,
  earlyLeaveMinutes: 0,
  surplusMinutes: 0,
  leaveUnits: '0',
  isOverridden: false,
  overrideNote: null,
  diffWarning: false,
  ...over,
});
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/attendance/daily')
        return {
          data: {
            counts: { present: 1, absent: 1, none: 1 },
            rows: [
              { ...day({}), employeeId: 'e1', employeeNo: 'E001', employeeName: 'أحمد' },
              {
                ...day({ status: 'absent', firstIn: null, lastOut: null, lateMinutes: 0 }),
                employeeId: 'e2',
                employeeNo: 'E002',
                employeeName: 'سارة',
              },
              { employeeId: 'e3', employeeNo: 'E003', employeeName: 'خالد' },
            ],
          },
        };
      if (path === '/attendance/days/me') return { data: [day({})] };
      return { data: [], meta: { page: 1, pageSize: 200, total: 0 } };
    },
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: { inserted: 1, duplicates: 0, errors: [] } };
    },
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ can: (c: string) => c !== 'attendance.day.read_all' }),
}));
vi.mock('../../lib/useFormat', () => ({
  useFormat: () => ({ date: (v: string) => v, time: (v: string) => `T:${v.slice(11, 16)}` }),
}));

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

describe('شاشات الحضور', () => {
  beforeEach(() => {
    state.posts.length = 0;
  });

  it('اللوحة اليومية: عدّاد الحالات وتصفية بالنقر', async () => {
    wrap(<DailyBoardPage />);
    expect(await screen.findByText('أحمد')).toBeTruthy();
    const chips = screen.getByTestId('status-chips');
    expect(within(chips).getByText(/الكل 3/)).toBeTruthy();
    await userEvent.click(within(chips).getByText(/غائب 1/));
    await waitFor(() => expect(screen.queryByText('أحمد')).toBeNull());
    expect(screen.getByText('سارة')).toBeTruthy();
  });

  it('التقويم الشهري يلوّن اليوم بحالته ويُظهر التأخير', async () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    vi.setSystemTime(new Date(`${ym}-15T12:00:00Z`));
    wrap(<MyAttendancePage />);
    await waitFor(() => expect(screen.getByTestId('attendance-calendar')).toBeTruthy());
    // مجموع الخروج المبكر يظهر بجانب مجموع التأخير
    expect(screen.getByText('إجمالي التأخير')).toBeTruthy();
    expect(screen.getByText('إجمالي الخروج المبكر')).toBeTruthy();
    vi.useRealTimers();
  });

  it('لصق البصمات: معاينة بالأخطاء ثم حفظ الصالح فقط', async () => {
    wrap(<PunchEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('الصق البصمات هنا'), {
      target: { value: 'E001\t2026-09-06\t08:05\nE002\t2026-13-40\t08:00' },
    });
    expect(await screen.findByText(/صالح 1/)).toBeTruthy();
    expect(screen.getByText('تاريخ غير صالح')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /حفظ البصمات \(1\)/ }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toEqual({
      path: '/attendance/punches/bulk',
      body: { rows: [{ employeeNo: 'E001', date: '2026-09-06', time: '08:05', direction: null }] },
    });
  });
});
