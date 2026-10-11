export type TelegramApi = {
  call: <T = unknown>(
    token: string,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<T>;
};

/** عميل Bot API بسيط عبر fetch؛ base قابل للاستبدال في الاختبار. */
export const createTelegramApi = (base = 'https://api.telegram.org'): TelegramApi => ({
  call: async <T>(token: string, method: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
    } | null;
    if (!res.ok || !body?.ok) {
      throw new Error(`Telegram ${method}: ${body?.description ?? `HTTP ${res.status}`}`);
    }
    return body.result as T;
  },
});
