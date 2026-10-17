import { randomUUID } from 'node:crypto';

/**
 * مُبلِّغ أخطاء متوافق مع GlitchTip/Sentry (واجهة store) بلا أي تبعية.
 * - اختياري: بلا SENTRY_DSN لا يفعل شيئاً.
 * - لا يرسل جسم الطلب ولا الترويسات ولا الكوكيز ولا المستخدم: فقط نوع الخطأ ورسالته وتتبّع المكدس
 *   ومعرّف الطلب والمسار (بلا query) ونسخة التطبيق. رسائل الأخطاء تُنقّى من الأرقام الطويلة والبريد.
 * - يحدّ المعدل (30 بلاغاً/دقيقة) ويدمج المكرر خلال دقيقة؛ والإرسال لا يحجب ولا يرمي أبداً.
 */
export type ErrorReporter = {
  capture: (err: unknown, ctx?: { requestId?: string; method?: string; path?: string }) => void;
  enabled: boolean;
};

export const noopReporter: ErrorReporter = { capture: () => undefined, enabled: false };

export const parseDsn = (dsn: string): { url: string; auth: string } | null => {
  try {
    const u = new URL(dsn);
    const key = u.username;
    const project = u.pathname.replace(/^\/+/, '').split('/').pop();
    if (!key || !project) return null;
    return {
      url: `${u.protocol}//${u.host}/api/${project}/store/`,
      auth: `Sentry sentry_version=7, sentry_key=${key}, sentry_client=hrms/1`,
    };
  } catch {
    return null;
  }
};

/** يخفي ما قد يكون بيانات شخصية في الرسائل: بريد، أرقام طويلة (هوية/حساب)، رموز طويلة */
export const scrub = (s: string): string =>
  s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d{6,}\b/g, '[num]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .slice(0, 500);

const frames = (stack: string | undefined) =>
  (stack ?? '')
    .split('\n')
    .slice(1, 30)
    .map((l) => l.trim().replace(/^at /, ''))
    .reverse()
    .map((f) => ({ function: scrub(f).slice(0, 200) }));

export const createErrorReporter = (opts: {
  dsn: string | undefined;
  release?: string;
  environment?: string;
  service: string;
  fetchImpl?: typeof fetch;
}): ErrorReporter => {
  const parsed = opts.dsn ? parseDsn(opts.dsn) : null;
  if (!parsed) return noopReporter;
  const doFetch = opts.fetchImpl ?? fetch;
  const recent = new Map<string, number>();
  let windowStart = Date.now();
  let sent = 0;
  return {
    enabled: true,
    capture: (err, ctx) => {
      try {
        const now = Date.now();
        if (now - windowStart > 60_000) {
          windowStart = now;
          sent = 0;
          for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
        }
        const e = err instanceof Error ? err : new Error(String(err));
        const msg = scrub(e.message);
        const key = `${e.name}:${msg}`;
        if (recent.has(key) || sent >= 30) return;
        recent.set(key, now);
        sent++;
        const event = {
          event_id: randomUUID().replace(/-/g, ''),
          timestamp: new Date(now).toISOString(),
          platform: 'node',
          level: 'error',
          server_name: opts.service,
          release: opts.release,
          environment: opts.environment ?? 'production',
          exception: {
            values: [{ type: e.name, value: msg, stacktrace: { frames: frames(e.stack) } }],
          },
          tags: { service: opts.service, ...(ctx?.requestId ? { requestId: ctx.requestId } : {}) },
          request: ctx?.path
            ? { method: ctx.method, url: `internal:${ctx.path.split('?')[0]}` }
            : undefined,
        };
        void doFetch(parsed.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Sentry-Auth': parsed.auth },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(3000),
        }).catch(() => undefined);
      } catch {
        /* الإبلاغ لا يكسر التطبيق أبداً */
      }
    },
  };
};
