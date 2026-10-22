import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { LeaveAttachments } from './LeaveAttachments';

const state = vi.hoisted(() => ({
  rows: [] as { id: string; name: string; mimeType: string; sizeBytes: number }[],
  uploads: [] as { path: string; name?: string }[],
  dels: [] as string[],
  blobs: [] as string[],
}));
vi.mock('../../lib/export', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({ data: state.rows }),
    upload: async (path: string, _f: Blob, opts: { name?: string }) => {
      state.uploads.push({ path, name: opts.name });
      return { data: { id: 'new' } };
    },
    del: async (path: string) => {
      state.dels.push(path);
      return { data: undefined };
    },
    blob: async (path: string) => {
      state.blobs.push(path);
      return new Blob(['x']);
    },
  },
}));

const wrap = (props: { canEdit: boolean; requiresAttachment?: boolean }) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <LeaveAttachments requestId="r1" {...props} />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('مرفقات الإجازة', () => {
  beforeEach(() => {
    state.rows = [];
    state.uploads.length = 0;
    state.dels.length = 0;
    state.blobs.length = 0;
  });

  it('النوع الذي يتطلب مرفقاً وبلا مرفق: تنبيه (وليس منعاً)', async () => {
    wrap({ canEdit: true, requiresAttachment: true });
    expect(await screen.findByText(/يتطلب مرفقاً/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'رفع' })).toBeTruthy();
  });

  it('يعرض المرفق ويُنزّله ويحذفه للمالك', async () => {
    state.rows = [{ id: 'a1', name: 'تقرير.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }];
    wrap({ canEdit: true, requiresAttachment: true });
    expect(await screen.findByText('تقرير.pdf')).toBeTruthy();
    expect(screen.queryByText(/يتطلب مرفقاً/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'تنزيل' }));
    await waitFor(() => expect(state.blobs).toEqual(['/leave-requests/r1/attachments/a1/content']));
    await userEvent.click(screen.getByRole('button', { name: 'حذف' }));
    await waitFor(() => expect(state.dels).toEqual(['/leave-requests/r1/attachments/a1']));
  });

  it('للمعتمد (قراءة فقط): تنزيل بلا رفع ولا حذف', async () => {
    state.rows = [{ id: 'a1', name: 'تقرير.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }];
    wrap({ canEdit: false });
    expect(await screen.findByText('تقرير.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تنزيل' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'حذف' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'رفع' })).toBeNull();
  });

  it('رفع ملف يرسل الاسم إلى المسار الصحيح', async () => {
    const { container } = wrap({ canEdit: true });
    await screen.findByText(/إرفاق ملف/);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['%PDF-1.4 test'], 'طبي.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: 'رفع' }));
    await waitFor(() => expect(state.uploads).toHaveLength(1));
    expect(state.uploads[0]).toEqual({
      path: '/leave-requests/r1/attachments',
      name: 'طبي.pdf',
    });
  });
});
