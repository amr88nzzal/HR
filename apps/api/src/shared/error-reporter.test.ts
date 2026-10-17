import { describe, expect, it, vi } from 'vitest';
import { createErrorReporter, noopReporter, parseDsn, scrub } from './error-reporter.js';

describe('مُبلِّغ الأخطاء (GlitchTip)', () => {
  it('DSN: يبني عنوان store والترويسة، ويرفض الخاطئ', () => {
    expect(parseDsn('https://abc123@glitch.example.com/7')).toEqual({
      url: 'https://glitch.example.com/api/7/store/',
      auth: 'Sentry sentry_version=7, sentry_key=abc123, sentry_client=hrms/1',
    });
    expect(parseDsn('not a url')).toBeNull();
    expect(parseDsn('https://glitch.example.com/7')).toBeNull();
  });

  it('بلا DSN لا يفعل شيئاً', () => {
    expect(createErrorReporter({ dsn: undefined, service: 'api' })).toBe(noopReporter);
    expect(() => noopReporter.capture(new Error('x'))).not.toThrow();
  });

  it('التنقية: بريد وأرقام طويلة ورموز لا تغادر الخادم', () => {
    const s = scrub(
      'فشل لـ ali@example.com رقم 123456789012 توكن abcdefghijklmnopqrstuvwxyz0123456789ABCD',
    );
    expect(s).not.toContain('ali@example.com');
    expect(s).not.toContain('123456789012');
    expect(s).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('الحمولة: بلا جسم/ترويسات/استعلام، ومعرّف الطلب والمسار فقط', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const r = createErrorReporter({
      dsn: 'https://k@g.example.com/1',
      service: 'api',
      release: 'abc',
      fetchImpl: fetchImpl as never,
    });
    r.capture(new Error('boom for x@y.com'), {
      requestId: 'req-1',
      method: 'POST',
      path: '/api/v1/employees?token=SECRET',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://g.example.com/api/1/store/');
    const body = JSON.parse(init.body as string);
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('x@y.com');
    expect(body.tags.requestId).toBe('req-1');
    expect(body.request.url).toBe('internal:/api/v1/employees');
    expect(body.release).toBe('abc');
    expect(body).not.toHaveProperty('user');
  });

  it('يدمج المكرر ويحدّ المعدل، ولا يرمي عند فشل الشبكة', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    const r = createErrorReporter({
      dsn: 'https://k@g.example.com/1',
      service: 'api',
      fetchImpl: fetchImpl as never,
    });
    r.capture(new Error('same'));
    r.capture(new Error('same'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) r.capture(new Error(`different ${i}`));
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(30);
    await Promise.resolve();
  });
});
