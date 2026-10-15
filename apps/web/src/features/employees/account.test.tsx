import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { AcceptInvitePage } from '../../pages/AcceptInvitePage';
import { AccountPanel } from './AccountPanel';

const state = vi.hoisted(() => ({
  account: { state: 'none' } as Record<string, unknown>,
  posts: [] as { path: string; body: unknown }[],
}));
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({ data: state.account }),
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return {
        data: {
          email: 'a@x.test',
          delivery: 'invite',
          inviteLink: 'https://h/accept-invite?token=T',
        },
      };
    },
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}));
vi.mock('../../lib/useFormat', () => ({
  useFormat: () => ({ dateTime: (v: unknown) => String(v ?? '—') }),
}));

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

describe('حساب المستخدم من الموظف', () => {
  beforeEach(() => {
    state.posts.length = 0;
    state.account = { state: 'none' };
  });

  it('بلا حساب: الإنشاء بدعوة يعرض الرابط مرة واحدة', async () => {
    wrap(<AccountPanel employeeId="e1" />);
    expect(await screen.findByText('بلا حساب')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء حساب' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'إنشاء حساب' }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toMatchObject({
      path: '/employees/e1/account',
      body: { delivery: 'invite' },
    });
    expect(await screen.findByText(/accept-invite\?token=T/)).toBeTruthy();
    expect(screen.getByText('تُعرض هذه القيمة مرة واحدة فقط ولا تُحفظ.')).toBeTruthy();
  });

  it('مدعو: زر إعادة الإرسال، ومعطّل لانتهاء الخدمة: يظهر السبب', async () => {
    state.account = { state: 'invited', email: 'a@x.test', inviteExpiresAt: '2026-10-20' };
    const { unmount } = wrap(<AccountPanel employeeId="e1" />);
    expect(await screen.findByRole('button', { name: 'إعادة إرسال الدعوة' })).toBeTruthy();
    unmount();
    state.account = {
      state: 'disabled',
      email: 'a@x.test',
      disabledReason: 'employment_ended',
    };
    wrap(<AccountPanel employeeId="e1" />);
    expect(await screen.findByText(/عُطّل الحساب تلقائياً/)).toBeTruthy();
  });

  it('صفحة الدعوة: تباين الكلمتين يُرفض قبل الإرسال', async () => {
    window.history.pushState({}, '', '/accept-invite?token=abc1234567890');
    wrap(<AcceptInvitePage />);
    await userEvent.type(screen.getByLabelText('كلمة المرور الجديدة'), 'Aa-1234567890');
    await userEvent.type(screen.getByLabelText('تأكيد كلمة المرور'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'تعيين كلمة المرور' }));
    expect(await screen.findByText('كلمتا المرور غير متطابقتين')).toBeTruthy();
    expect(state.posts).toHaveLength(0);
  });
});
