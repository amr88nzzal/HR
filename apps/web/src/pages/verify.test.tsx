import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { VerifyPage } from './VerifyPage';

const state = vi.hoisted(() => ({ mode: 'valid' as 'valid' | 'revoked' | 'missing' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ token: 'abc' }) }));
vi.mock('../api/client', () => ({
  api: {
    get: async () => {
      if (state.mode === 'missing') throw new Error('404');
      return {
        data: {
          valid: state.mode === 'valid',
          status: state.mode,
          number: 'CERT-2026-000007',
          type: 'شهادة عمل',
          holder: 'أح*** ال***',
          company: 'شركة أكمي',
          issuedAt: '2026-10-14',
          fileSha256: 'a'.repeat(64),
        },
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
        <VerifyPage />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('صفحة التحقق العامة', () => {
  it('وثيقة صحيحة: الرقم والاسم المقنّع', async () => {
    state.mode = 'valid';
    wrap();
    expect(await screen.findByText('وثيقة صحيحة')).toBeTruthy();
    expect(screen.getByText('CERT-2026-000007')).toBeTruthy();
    expect(screen.getByText('أح*** ال***')).toBeTruthy();
  });
  it('وثيقة مُبطلة', async () => {
    state.mode = 'revoked';
    wrap();
    expect(await screen.findByText('وثيقة مُبطلة')).toBeTruthy();
  });
  it('رمز غير معروف', async () => {
    state.mode = 'missing';
    wrap();
    expect(await screen.findByText('لم يُعثر على وثيقة بهذا الرمز.')).toBeTruthy();
  });
});
