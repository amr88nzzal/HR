import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { VerifyPayslipPage } from './VerifyPayslipPage';

const state = vi.hoisted(() => ({ mode: 'valid' as 'valid' | 'mismatch' | 'missing' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ token: 'abc' }) }));
vi.mock('../api/client', () => ({
  api: {
    get: async () => {
      if (state.mode === 'missing') throw new Error('404');
      return {
        data:
          state.mode === 'valid'
            ? {
                valid: true,
                status: 'valid',
                company: 'شركة أكمي',
                holder: 'أح*** ال***',
                year: 2026,
                month: 9,
              }
            : { valid: false, status: 'mismatch' },
      };
    },
  },
}));

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <VerifyPayslipPage />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('VerifyPayslipPage', () => {
  it('يعرض المطابقة بالاسم المقنّع والشهر بلا أي مبلغ', async () => {
    state.mode = 'valid';
    wrap();
    expect(await screen.findByText('قسيمة مطابقة للسجل')).toBeTruthy();
    expect(screen.getByText('أح*** ال***')).toBeTruthy();
    expect(screen.getByText('2026-09')).toBeTruthy();
  });
  it('عدم التطابق لا يعرض أي بيانات', async () => {
    state.mode = 'mismatch';
    wrap();
    expect(await screen.findByText('غير مطابقة للسجل')).toBeTruthy();
    expect(screen.queryByText('شركة أكمي')).toBeNull();
  });
  it('رمز غير موجود', async () => {
    state.mode = 'missing';
    wrap();
    expect(await screen.findByText('لم يُعثر على وثيقة بهذا الرمز.')).toBeTruthy();
  });
});
