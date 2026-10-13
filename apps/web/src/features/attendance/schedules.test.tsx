import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { SchedulesPage } from './SchedulesPage';
import { segmentsText, ShiftsPage } from './ShiftsPage';

const state = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[] }));
const shift = (over: object) => ({
  id: 's1',
  version: 1,
  code: 'DAY',
  nameAr: 'صباحية',
  nameEn: null,
  color: '#228be6',
  lateGraceMinutes: 10,
  earlyLeaveGraceMinutes: 5,
  isActive: true,
  segments: [{ startTime: '08:00', endTime: '16:00', endsNextDay: false }],
  ...over,
});
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/shifts')
        return {
          data: [
            shift({}),
            shift({
              id: 's2',
              code: 'NIGHT',
              nameAr: 'ليلية',
              segments: [{ startTime: '22:00', endTime: '06:00', endsNextDay: true }],
            }),
          ],
        };
      if (path === '/work-schedules')
        return {
          data: [
            {
              id: 'w1',
              version: 1,
              code: 'STD',
              nameAr: 'قياسي',
              nameEn: null,
              isActive: true,
              days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
                weekday,
                shiftId: weekday <= 4 ? 's1' : null,
              })),
            },
          ],
        };
      if (path === '/schedule-assignments/resolve')
        return { data: { scheduleCode: 'STD', scope: 'company', shift: shift({}) } };
      return { data: [], meta: { page: 1, pageSize: 200, total: 0 } };
    },
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: {} };
    },
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../lib/useFormat', () => ({ useFormat: () => ({ date: (v: string) => v }) }));
vi.mock('../employees/EmployeeSelect', () => ({
  EmployeeSelect: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button onClick={() => onChange('emp-1')}>pick-employee</button>
  ),
}));

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('الورديات وجداول الدوام (الواجهة)', () => {
  beforeEach(() => {
    state.posts.length = 0;
  });

  it('ملخص الفترات: مقسومة وليلية', () => {
    expect(
      segmentsText([
        { startTime: '08:00', endTime: '12:00', endsNextDay: false },
        { startTime: '16:00', endTime: '20:00', endsNextDay: false },
      ]),
    ).toBe('08:00–12:00 | 16:00–20:00');
    expect(segmentsText([{ startTime: '22:00', endTime: '06:00', endsNextDay: true }])).toBe(
      '22:00–06:00 +1',
    );
  });

  it('قائمة الورديات تعرض الفترات ولو ليلية', async () => {
    wrap(<ShiftsPage />);
    expect(await screen.findByText('08:00–16:00')).toBeTruthy();
    expect(screen.getByText(/22:00–06:00/)).toBeTruthy();
  });

  it('إضافة وردية: فترات متداخلة تعطّل الحفظ، والصحيحة تُرسل', async () => {
    wrap(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'إضافة وردية' }));
    const dialog = await screen.findByRole('dialog');
    const inputs = within(dialog).getAllByRole('textbox');
    fireEvent.change(inputs[0] as HTMLElement, { target: { value: 'MORN' } });
    fireEvent.change(inputs[1] as HTMLElement, { target: { value: 'صباحي' } });
    const save = within(dialog).getByRole('button', { name: 'حفظ' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    // فترة ثانية تتداخل مع الأولى (08:00–16:00)
    await userEvent.click(within(dialog).getByRole('button', { name: 'إضافة فترة' }));
    const times = dialog.querySelectorAll('input[type="time"]');
    fireEvent.change(times[2] as HTMLElement, { target: { value: '15:00' } });
    fireEvent.change(times[3] as HTMLElement, { target: { value: '18:00' } });
    expect(await within(dialog).findByText(/متداخلة أو غير مرتبة/)).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(times[2] as HTMLElement, { target: { value: '16:00' } });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(save);
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]?.path).toBe('/shifts');
    expect(state.posts[0]?.body).toMatchObject({
      code: 'MORN',
      segments: [
        { startTime: '08:00', endTime: '16:00', endsNextDay: false },
        { startTime: '16:00', endTime: '18:00', endsNextDay: false },
      ],
    });
  });

  it('فحص الموظف يعرض الجدول والوردية السارية', async () => {
    wrap(<SchedulesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'فحص موظف' }));
    await userEvent.click(await screen.findByText('pick-employee'));
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLElement, {
      target: { value: '2026-10-12' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'فحص' }));
    const res = await screen.findByTestId('check-result');
    expect(within(res).getByText('STD')).toBeTruthy();
    expect(within(res).getByText('DAY')).toBeTruthy();
  });
});
