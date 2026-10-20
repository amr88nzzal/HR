import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import '../i18n';
import { LoginPage } from './LoginPage';

const fakeClient = (overrides: Partial<ApiClient>): ApiClient =>
  ({
    restore: vi.fn().mockResolvedValue(null),
    onSessionExpired: () => () => undefined,
    onPermissionsVersion: () => () => undefined,
    clearToken: vi.fn(),
    ...overrides,
  }) as unknown as ApiClient;

const renderLogin = (client: ApiClient) =>
  render(
    <MantineProvider>
      <AuthProvider client={client}>
        <LoginPage />
      </AuthProvider>
    </MantineProvider>,
  );

describe('شاشة الدخول', () => {
  it('تعرض رسالة مترجمة عند بيانات خاطئة', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x'));
    renderLogin(fakeClient({ login }));
    await userEvent.type(screen.getByLabelText(/البريد الإلكتروني/), 'a@b.test');
    await userEvent.type(screen.getByLabelText(/كلمة المرور/), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('بيانات الدخول غير صحيحة');
    expect(login).toHaveBeenCalledWith({ identifier: 'a@b.test', password: 'secret' });
  });

  it('رسالة القفل تظهر عند ACCOUNT_LOCKED', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(423, 'ACCOUNT_LOCKED', 'x'));
    renderLogin(fakeClient({ login }));
    await userEvent.type(screen.getByLabelText(/البريد الإلكتروني/), 'a@b.test');
    await userEvent.type(screen.getByLabelText(/كلمة المرور/), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('مقفل'));
  });

  it('يرسل رمز الشركة المكتوب ويتذكّره', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    localStorage.removeItem('hr.loginCompany');
    const get = vi.fn().mockResolvedValue({ data: { id: 'u1', permissions: [] } });
    renderLogin(fakeClient({ login, get }));
    await userEvent.type(screen.getByLabelText(/رمز الشركة/), ' Acme ');
    await userEvent.type(screen.getByLabelText(/البريد الإلكتروني/), 'a@b.test');
    await userEvent.type(screen.getByLabelText(/كلمة المرور/), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        identifier: 'a@b.test',
        password: 'secret',
        company: 'acme',
      }),
    );
    await waitFor(() => expect(localStorage.getItem('hr.loginCompany')).toBe('acme'));
    localStorage.removeItem('hr.loginCompany');
  });
});
