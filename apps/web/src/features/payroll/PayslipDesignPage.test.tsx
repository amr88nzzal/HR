import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { PayslipDesignPage } from './PayslipDesignPage';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
const calls: { path: string; body?: unknown }[] = [];
vi.mock('../../api/client', () => ({
  api: {
    get: async () => ({ data: [] }),
    post: async (path: string, body?: unknown) => {
      calls.push({ path, body });
      return { data: { html: '<p>معاينة</p>', id: 'x', version: 1 } };
    },
    put: async () => ({ data: {} }),
    del: async () => undefined,
  },
}));

describe('تصميم قسيمة الراتب', () => {
  afterEach(() => {
    calls.length = 0;
  });

  it('اختيار تصميم جاهز يفتح المحرر ويطلب معاينة، والحفظ ينشئ القالب', async () => {
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <PayslipDesignPage />
        </QueryClientProvider>
      </MantineProvider>,
    );
    await userEvent.click(await screen.findByPlaceholderText('…'));
    await userEvent.click(await screen.findByText('جانبي (دخل | اقتطاعات)'));
    expect(await screen.findByLabelText(/اسم القالب \(عربي\)/)).toBeTruthy();
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/payroll/payslip-templates/preview')).toBe(true),
    );
    const preview = calls.find((c) => c.path.endsWith('/preview'))!.body as {
      config: { layout: string };
    };
    expect(preview.config.layout).toBe('side_by_side');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/payroll/payslip-templates')).toBe(true),
    );
  });
});
