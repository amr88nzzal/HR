import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { PlatformPage } from './PlatformPage';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('شاشة إدارة الشركات', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('تطلب المفتاح أولاً وتعرض الشركات بعد الدخول', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => json(200, { data: { token: 't1', expiresIn: 7200 } }))
      .mockImplementationOnce(() =>
        json(200, {
          data: [
            {
              id: '1',
              slug: 'acme',
              nameAr: 'شركة أكمي',
              nameEn: null,
              timezone: 'UTC',
              defaultLocale: 'ar',
              status: 'active',
              version: 1,
              userCount: 2,
              employeeCount: 5,
            },
          ],
        }),
      );
    render(
      <MantineProvider>
        <PlatformPage />
      </MantineProvider>,
    );
    await userEvent.type(screen.getByLabelText(/مفتاح مدير المنصة/), 'secret-key');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByText('شركة أكمي')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer t1' });
  });

  it('مفتاح خاطئ يعرض رسالة ولا يدخل', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }),
    );
    render(
      <MantineProvider>
        <PlatformPage />
      </MantineProvider>,
    );
    await userEvent.type(screen.getByLabelText(/مفتاح مدير المنصة/), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(screen.getByLabelText(/مفتاح مدير المنصة/)).toBeTruthy());
    expect(screen.queryByText('شركة جديدة')).toBeNull();
  });
});
