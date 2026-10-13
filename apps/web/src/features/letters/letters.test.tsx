import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { TemplatesPage } from './TemplatesPage';

const state = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[] }));
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/letter-templates/variables')
        return {
          data: [
            {
              key: 'employee.fullName',
              group: 'employee',
              kind: 'text',
              labelAr: 'الاسم الكامل',
              labelEn: 'Full name',
            },
          ],
        };
      if (path === '/letter-templates')
        return {
          data: [
            {
              id: 't1',
              code: 'CERT-AR',
              nameAr: 'شهادة عمل',
              nameEn: null,
              language: 'ar',
              category: 'certificate',
              isActive: true,
              version: 1,
              activeVersionId: 'v1',
              activeVersionNo: 2,
            },
          ],
        };
      return { data: [] };
    },
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: {} };
    },
    patch: async () => ({ data: {} }),
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../employees/EmployeeSelect', () => ({ EmployeeSelect: () => null }));

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <TemplatesPage />
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('مدير قوالب الوثائق', () => {
  beforeEach(() => {
    state.posts.length = 0;
  });

  it('يعرض القوالب بإصدارها المفعّل', async () => {
    wrap();
    expect(await screen.findByText('شهادة عمل')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
  });

  it('قالب جديد: إدراج متغير بالنقر ثم الإنشاء يرسل النص واللغة', async () => {
    wrap();
    await userEvent.click(await screen.findByRole('button', { name: 'قالب جديد' }));
    await userEvent.click(await screen.findByText('الاسم الكامل'));
    const body = (await screen.findByLabelText('نص القالب (HTML)')) as HTMLTextAreaElement;
    expect(body.value).toContain('{{employee.fullName}}');
    await userEvent.type(screen.getByLabelText('الرمز'), 'CERT-NEW');
    await userEvent.type(screen.getByLabelText('الاسم بالعربية'), 'شهادة جديدة');
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء القالب' }));
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]?.path).toBe('/letter-templates');
    expect(state.posts[0]?.body).toMatchObject({
      code: 'CERT-NEW',
      language: 'ar',
      nameAr: 'شهادة جديدة',
    });
  });
});
