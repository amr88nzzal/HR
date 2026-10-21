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

describe('نموذج الشركة', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('الكتابة في الحقول لا تكسر الصفحة، والإرسال يحمل القيم المكتوبة', async () => {
    sessionStorage.setItem('hr.platformToken', 't1');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_url, init) =>
        init?.method === 'POST'
          ? json(201, { data: { admin: { email: 'a@b.test', temporaryPassword: 'pw-123456789' } } })
          : json(200, { data: [] }),
      );
    render(
      <MantineProvider>
        <PlatformPage />
      </MantineProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'شركة جديدة' }));
    await userEvent.type(await screen.findByLabelText(/رمز الشركة/), 'acme');
    await userEvent.type(screen.getByLabelText(/الاسم بالعربية/), 'شركة أكمي');
    await userEvent.type(screen.getByLabelText(/اسم المدير/), 'مدير');
    await userEvent.type(screen.getByLabelText(/بريد المدير/), 'a@b.test');
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء' }));
    expect(await screen.findByText('pw-123456789')).toBeTruthy();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      slug: 'acme',
      nameAr: 'شركة أكمي',
      admin: { email: 'a@b.test', name: 'مدير' },
    });
  });
});
