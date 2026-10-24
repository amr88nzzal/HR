import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { LoanAttachments } from './LoanAttachments';

const state = vi.hoisted(() => ({ rows: [] as object[] }));
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({ data: state.rows }),
    upload: async () => ({ data: {} }),
    del: async () => undefined,
  },
}));

const wrap = (props: { requiresAttachment?: boolean; canEdit?: boolean }) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <LoanAttachments
          loanId="l1"
          canEdit={props.canEdit ?? true}
          requiresAttachment={props.requiresAttachment ?? false}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('مرفقات السلفة', () => {
  it('النوع الذي يتطلب مرفقاً ولا مرفق: تنبيه', async () => {
    state.rows = [];
    wrap({ requiresAttachment: true });
    expect(await screen.findByText(/يتطلب مرفقاً/)).toBeTruthy();
  });
  it('يعرض المرفقات مع تنزيل وحذف لمن يملك الصلاحية', async () => {
    state.rows = [{ id: 'a1', name: 'فاتورة.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }];
    wrap({});
    expect(await screen.findByText('فاتورة.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تنزيل' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حذف' })).toBeTruthy();
  });
  it('بلا صلاحية تعديل لا يظهر الحذف', async () => {
    state.rows = [{ id: 'a1', name: 'فاتورة.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }];
    wrap({ canEdit: false });
    await screen.findByText('فاتورة.pdf');
    expect(screen.queryByRole('button', { name: 'حذف' })).toBeNull();
  });
});
