import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { LeaveRequestModal } from './LeaveRequestModal';
import type { Preview } from './types';

const state = vi.hoisted(() => ({ preview: null as unknown, posts: [] as string[] }));
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({
      data: [{ id: 't1', code: 'ANNUAL', nameAr: 'سنوية', nameEn: null, allowHalfDay: true }],
      meta: { page: 1, pageSize: 200, total: 1 },
    }),
    post: async (path: string) => {
      state.posts.push(path);
      return { data: state.preview };
    },
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock('../../lib/useFormat', () => ({ useFormat: () => ({ date: (v: string) => v }) }));

const preview = (over: Partial<Preview>): Preview => ({
  days: [
    { date: '2026-06-15', kind: 'work', units: '1.00' },
    { date: '2026-06-17', kind: 'holiday', units: '0.00' },
  ],
  totalDays: '1.00',
  deductsBalance: true,
  balance: '12.00',
  balanceAfter: '11.00',
  sufficient: true,
  overlaps: [],
  ...over,
});

const open = async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <LeaveRequestModal onClose={() => undefined} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name: /نوع الإجازة/ }));
  await user.click(await screen.findByText('سنوية'));
  fireEvent.change(screen.getByLabelText(/من تاريخ/), { target: { value: '2026-06-15' } });
};

describe('نموذج طلب الإجازة', () => {
  beforeEach(() => {
    state.posts.length = 0;
  });

  it('يعرض المعاينة الحية ويفعّل الإرسال عند كفاية الرصيد', async () => {
    state.preview = preview({});
    await open();
    expect(await screen.findByTestId('leave-preview')).toBeTruthy();
    expect(screen.getByText(/12.00 → 11.00/)).toBeTruthy();
    expect(state.posts).toContain('/leave-requests/preview');
    const send = screen.getByRole('button', { name: 'إرسال الطلب' });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
  });

  it('يمنع الإرسال عند عدم كفاية الرصيد أو التداخل', async () => {
    state.preview = preview({
      sufficient: false,
      overlaps: [{ id: 'x', startDate: '2026-06-15', endDate: '2026-06-16', status: 'pending' }],
    });
    await open();
    expect(await screen.findByText('الرصيد غير كافٍ لهذا الطلب')).toBeTruthy();
    expect(screen.getByText('يتداخل مع طلب إجازة قائم')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'إرسال الطلب' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });
});
