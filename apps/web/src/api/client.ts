import type { ApiEnvelope, ApiErrorBody } from '@hrms/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export type SessionInfo = {
  accessToken: string;
  expiresIn: number;
  permissionsVersion: number;
  mustChangePassword: boolean;
};

type Listener<T> = (value: T) => void;

/**
 * عميل API: رمز الوصول في الذاكرة فقط (لا localStorage)، والـ refresh عبر كوكي httpOnly.
 * عند 401 يُجدَّد الرمز مرة واحدة (طلب تجديد واحد مشترك بين الطلبات المتزامنة) ثم يُعاد الطلب.
 */
export const createApiClient = (
  baseUrl = '/api/v1',
  fetchImpl: typeof fetch = (...a) => fetch(...a),
) => {
  let accessToken: string | null = null;
  let refreshing: Promise<SessionInfo | null> | null = null;
  const onExpired = new Set<Listener<void>>();
  const onPermVersion = new Set<Listener<number>>();

  const parseError = async (res: Response): Promise<ApiError> => {
    try {
      const body = (await res.json()) as ApiErrorBody;
      return new ApiError(
        res.status,
        body.error.code,
        body.error.message,
        body.error.details,
        body.error.requestId,
      );
    } catch {
      return new ApiError(res.status, 'HTTP_ERROR', res.statusText || 'خطأ في الاتصال');
    }
  };

  const raw = (
    path: string,
    init: RequestInit & { token?: string | null } = {},
  ): Promise<Response> => {
    const { token, headers, ...rest } = init;
    return fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  };

  const adopt = (info: SessionInfo) => {
    accessToken = info.accessToken;
  };

  const refresh = (): Promise<SessionInfo | null> => {
    refreshing ??= (async () => {
      try {
        const res = await raw('/auth/refresh', { method: 'POST' });
        if (!res.ok) return null;
        const body = (await res.json()) as ApiEnvelope<SessionInfo>;
        adopt(body.data);
        return body.data;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };

  type Query = Record<string, string | number | boolean | undefined>;
  const queryString = (query?: Query): string =>
    query
      ? `?${new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]]))).toString()}`
      : '';

  /** طلب موثَّق مع تجديد الرمز عند 401 مرة واحدة؛ يرمي ApiError عند الفشل. */
  const authed = async (
    path: string,
    init: {
      method?: string;
      body?: BodyInit;
      headers?: Record<string, string>;
      query?: Query;
      retry?: boolean;
    } = {},
  ): Promise<Response> => {
    const send = () =>
      raw(`${path}${queryString(init.query)}`, {
        method: init.method ?? 'GET',
        body: init.body,
        headers: init.headers,
        token: accessToken,
      });

    let res = await send();
    if (res.status === 401 && init.retry !== false && accessToken) {
      const renewed = await refresh();
      if (!renewed) {
        accessToken = null;
        onExpired.forEach((l) => l());
        throw await parseError(res);
      }
      res = await send();
    }
    const pv = res.headers.get('X-Permissions-Version');
    if (pv) onPermVersion.forEach((l) => l(Number(pv)));
    if (!res.ok) throw await parseError(res);
    return res;
  };

  const request = async <T>(
    path: string,
    opts: { method?: string; body?: unknown; query?: Query; retry?: boolean } = {},
  ): Promise<ApiEnvelope<T>> => {
    const res = await authed(path, {
      method: opts.method,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      query: opts.query,
      retry: opts.retry,
    });
    if (res.status === 204) return { data: undefined as T };
    return (await res.json()) as ApiEnvelope<T>;
  };

  return {
    request,
    get: <T>(path: string, query?: Record<string, string | number | boolean | undefined>) =>
      request<T>(path, { query }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    del: (path: string) => request<void>(path, { method: 'DELETE' }),
    /** رفع ملف خام (الأرشيف وصورة الموظف): الاسم يُرسل مرمَّزاً في X-File-Name */
    upload: async <T>(
      path: string,
      file: Blob,
      opts: { method?: 'POST' | 'PUT'; query?: Query; name?: string } = {},
    ): Promise<ApiEnvelope<T>> => {
      const res = await authed(path, {
        method: opts.method ?? 'POST',
        body: file,
        query: opts.query,
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(opts.name ? { 'X-File-Name': encodeURIComponent(opts.name) } : {}),
        },
      });
      return (await res.json()) as ApiEnvelope<T>;
    },
    /** تنزيل ملف موثَّق (الصور لا تحمل ترويسة Authorization عبر <img>) */
    blob: async (path: string, query?: Query): Promise<Blob> =>
      (await authed(path, { query })).blob(),

    /** تسجيل دخول: لا يُعاد الطلب عند 401 (بيانات خاطئة). */
    login: async (input: {
      identifier: string;
      password: string;
      company?: string;
    }): Promise<SessionInfo> => {
      const res = await raw('/auth/login', { method: 'POST', body: JSON.stringify(input) });
      if (!res.ok) throw await parseError(res);
      const body = (await res.json()) as ApiEnvelope<SessionInfo>;
      adopt(body.data);
      return body.data;
    },
    /** استعادة الجلسة عند فتح التطبيق من كوكي refresh. */
    restore: refresh,
    logout: async (): Promise<void> => {
      try {
        await raw('/auth/logout', { method: 'POST' });
      } finally {
        accessToken = null;
      }
    },
    clearToken: () => {
      accessToken = null;
    },
    hasToken: () => accessToken !== null,
    onSessionExpired: (l: Listener<void>) => {
      onExpired.add(l);
      return () => void onExpired.delete(l);
    },
    onPermissionsVersion: (l: Listener<number>) => {
      onPermVersion.add(l);
      return () => void onPermVersion.delete(l);
    },
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
export const api: ApiClient = createApiClient();
