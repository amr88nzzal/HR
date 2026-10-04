import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const session = (token: string) => ({
  data: { accessToken: token, expiresIn: 900, permissionsVersion: 1, mustChangePassword: false },
});
const errBody = (code: string, status: number) => ({
  error: { code, status, message: 'm', requestId: 'r' },
});

describe('عميل API', () => {
  it('يرسل الرمز بعد الدخول ويفك الغلاف', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, session('t1')))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));
    const c = createApiClient('/api/v1', fetchMock);
    await c.login({ identifier: 'a', password: 'b' });
    const res = await c.get<{ ok: boolean }>('/me');
    expect(res.data.ok).toBe(true);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer t1',
    });
  });

  it('عند 401 يجدّد مرة واحدة مشتركة بين الطلبات المتزامنة ثم يعيد الطلب', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return json(200, session('old'));
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return json(200, session('new'));
      }
      const auth = (init.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer new'
        ? json(200, { data: 'ok' })
        : json(401, errBody('UNAUTHORIZED', 401));
    });
    const c = createApiClient('/api/v1', fetchMock as unknown as typeof fetch);
    await c.login({ identifier: 'a', password: 'b' });
    const [a, b] = await Promise.all([c.get<string>('/x'), c.get<string>('/y')]);
    expect(a.data).toBe('ok');
    expect(b.data).toBe('ok');
    expect(refreshCalls).toBe(1);
  });

  it('فشل التجديد ينهي الجلسة ويُشعر المستمعين', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/login')) return json(200, session('old'));
      if (url.endsWith('/auth/refresh')) return json(401, errBody('INVALID_REFRESH_TOKEN', 401));
      return json(401, errBody('UNAUTHORIZED', 401));
    });
    const c = createApiClient('/api/v1', fetchMock as unknown as typeof fetch);
    const expired = vi.fn();
    c.onSessionExpired(expired);
    await c.login({ identifier: 'a', password: 'b' });
    await expect(c.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
    expect(c.hasToken()).toBe(false);
  });

  it('يبلّغ بتغيّر نسخة الصلاحيات من الترويسة', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, session('t')))
      .mockResolvedValueOnce(json(200, { data: 1 }, { 'X-Permissions-Version': '7' }));
    const c = createApiClient('/api/v1', fetchMock);
    const seen = vi.fn();
    c.onPermissionsVersion(seen);
    await c.login({ identifier: 'a', password: 'b' });
    await c.get('/x');
    expect(seen).toHaveBeenCalledWith(7);
  });

  it('أخطاء الخادم تتحول إلى ApiError بالرمز والرسالة', async () => {
    const c = createApiClient(
      '/api/v1',
      vi.fn().mockResolvedValue(json(403, errBody('FORBIDDEN', 403))),
    );
    await expect(c.login({ identifier: 'a', password: 'b' })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});
