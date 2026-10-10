import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ApprovalDetailPage } from './ApprovalDetailPage';
import type { ApprovalDetail } from './types';

const detail = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../api/client', () => ({
  api: { get: async () => ({ data: detail.current }), post: vi.fn() },
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ approvalId: 'r1' }),
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}));
vi.mock('../../lib/useFormat', () => ({ useFormat: () => ({ dateTime: (v: string) => v }) }));

const base: ApprovalDetail = {
  id: 'r1',
  requestType: 'general',
  title: 'طلب شراء',
  status: 'pending',
  requesterName: 'سارة',
  submittedAt: '2026-10-10T10:00:00Z',
  payload: { amount: 5000 },
  finalNote: null,
  currentPosition: 1,
  requesterUserId: 'u1',
  steps: [{ id: 's1', position: 1, nameAr: 'المدير المباشر', nameEn: null }],
  assignees: [
    {
      id: 'a1',
      position: 1,
      userId: 'u2',
      userName: 'خالد',
      delegatedFromUserId: null,
      status: 'pending',
    },
  ],
  actions: [
    {
      id: 'x1',
      action: 'submit',
      note: null,
      createdAt: '2026-10-10T10:00:00Z',
      actorName: 'سارة',
      onBehalfOfUserId: null,
    },
  ],
  canAct: false,
  canWithdraw: false,
  canResubmit: false,
};

const renderPage = (over: Partial<ApprovalDetail>) => {
  detail.current = { ...base, ...over };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <ApprovalDetailPage />
      </MantineProvider>
    </QueryClientProvider>,
  );
};

describe('تفاصيل طلب الموافقة', () => {
  beforeEach(() => vi.clearAllMocks());

  it('المعتمد يرى أزرار القرار الثلاثة فقط', async () => {
    renderPage({ canAct: true });
    expect(await screen.findByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'رفض' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إرجاع للتعديل' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'سحب الطلب' })).toBeNull();
  });

  it('مقدّم الطلب يرى السحب ولا يرى أزرار القرار', async () => {
    renderPage({ canWithdraw: true });
    expect(await screen.findByRole('button', { name: 'سحب الطلب' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'موافقة' })).toBeNull();
  });

  it('المُرجَع يعرض إعادة التقديم', async () => {
    renderPage({ status: 'returned', canResubmit: true, canWithdraw: true });
    expect(await screen.findByRole('button', { name: 'إعادة التقديم' })).toBeInTheDocument();
    expect(screen.getByText('مُرجَع للتعديل')).toBeInTheDocument();
  });
});
