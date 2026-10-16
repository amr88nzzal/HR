import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { BrandPage } from './BrandPage';

const post = vi.fn(async (_p: string, _b: unknown) => ({
  data: { html: '<div class="lh-header">شركة أكمي للتجارة</div>' },
}));
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({
      data: {
        version: 2,
        legalNameAr: 'شركة أكمي للتجارة',
        slots: {
          logo_ar: false,
          logo_en: false,
          logo_dark_ar: false,
          logo_dark_en: false,
          stamp: false,
        },
      },
    }),
    post: (p: string, b: unknown) => post(p, b),
    put: vi.fn(),
    del: vi.fn(),
    upload: vi.fn(),
    blob: vi.fn(),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));

describe('الهوية البصرية', () => {
  it('تعرض خانات الصور وحقول النصوص وتطلب المعاينة بلغة محددة', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MantineProvider>
          <BrandPage />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('الشعار (عربي)')).toBeTruthy();
    expect(screen.getByText('ختم / توقيع')).toBeTruthy();
    expect(screen.getByDisplayValue('شركة أكمي للتجارة')).toBeTruthy();
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![0]).toBe('/company-brand/preview');
    expect((post.mock.calls[0]![1] as { lang: string }).lang).toBe('ar');
    expect(screen.getByTitle('معاينة الترويسة')).toBeTruthy();
  });
});
