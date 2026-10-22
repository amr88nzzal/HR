import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GroupMembersModal } from './GroupMembersModal';

const state = vi.hoisted(() => ({
  posts: [] as { path: string; body: unknown }[],
  dels: [] as string[],
}));
vi.mock('../employees/EmployeeSelect', () => ({
  EmployeeSelect: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button onClick={() => onChange('emp-2')}>اختر موظفاً</button>
  ),
}));
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({
      data: [
        {
          id: 'a1',
          employeeNo: 'E-001',
          employeeName: 'سعد الأحمد',
          validFrom: '2020-01-01',
          validTo: null,
        },
      ],
    }),
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: {} };
    },
    del: async (path: string) => {
      state.dels.push(path);
      return { data: undefined };
    },
  },
}));

const wrap = (canEdit = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <GroupMembersModal
          groupId="g1"
          groupName="الشهرية"
          isDefault
          canEdit={canEdit}
          onClose={() => undefined}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('أعضاء مجموعة الدفع', () => {
  beforeEach(() => {
    state.posts.length = 0;
    state.dels.length = 0;
  });
  it('يعرض الأعضاء وتلميح الافتراضية، ويضيف تعييناً بتاريخ، ويحذف', async () => {
    wrap();
    expect(await screen.findByText(/سعد الأحمد/)).toBeTruthy();
    expect(screen.getByText(/المجموعة الافتراضية/)).toBeTruthy();
    expect(screen.getByText('حالي')).toBeTruthy();
    await userEvent.click(screen.getByText('اختر موظفاً'));
    await userEvent.click(screen.getByRole('button', { name: 'تعيين' }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]?.path).toBe('/payroll/groups/g1/assignments');
    expect(state.posts[0]?.body).toMatchObject({ employeeId: 'emp-2' });
    await userEvent.click(screen.getByRole('button', { name: 'حذف' }));
    await waitFor(() => expect(state.dels).toEqual(['/payroll/groups/g1/assignments/a1']));
  });
  it('بلا صلاحية التعديل: لا إضافة ولا حذف', async () => {
    wrap(false);
    expect(await screen.findByText(/سعد الأحمد/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'تعيين' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'حذف' })).toBeNull();
  });
});
