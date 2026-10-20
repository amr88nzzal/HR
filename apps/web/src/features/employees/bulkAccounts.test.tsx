import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { BulkAccountsModal } from './BulkAccountsModal';

const state = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[] }));
vi.mock('../../api/client', () => ({
  api: {
    post: async (path: string, body: { dryRun: boolean }) => {
      state.posts.push({ path, body });
      const rows = [
        { employeeId: 'a', employeeNo: 'E1', name: 'بسمة', email: 'b@x.test', status: 'ok' },
        { employeeId: 'b', employeeNo: 'E2', name: 'جود', email: null, status: 'no_email' },
      ];
      return {
        data: body.dryRun
          ? rows
          : rows.map((r) => (r.status === 'ok' ? { ...r, status: 'created' } : r)),
        meta: {
          dryRun: body.dryRun,
          total: 2,
          created: body.dryRun ? 0 : 1,
          ok: body.dryRun ? 1 : 0,
        },
      };
    },
  },
}));
vi.mock('../../api/hooks', () => ({ useList: () => ({ data: { data: [] } }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => false }) }));

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

describe('إنشاء حسابات بالجملة', () => {
  it('التنفيذ معطّل قبل المعاينة، ثم المعاينة تعرض النتيجة لكل موظف، ثم التنفيذ يرسل dryRun=false', async () => {
    const done = vi.fn();
    wrap(<BulkAccountsModal ids={['a', 'b']} onClose={() => undefined} onDone={done} />);
    const run = screen.getByRole('button', { name: 'تنفيذ' });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'معاينة' }));
    await waitFor(() => expect(screen.getByText('بلا بريد')).toBeTruthy());
    expect(state.posts[0]?.body).toMatchObject({ employeeIds: ['a', 'b'], dryRun: true });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'تنفيذ' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'تنفيذ' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(state.posts[1]?.body).toMatchObject({ dryRun: false });
    expect(screen.getByText('أُنشئ')).toBeTruthy();
  });
});
