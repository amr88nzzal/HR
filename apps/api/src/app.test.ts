import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { createApp } from './app.js';

const logger = pino({ level: 'silent' });

describe('health', () => {
  it('live يرجع ok داخل غلاف data', async () => {
    const res = await request(createApp({ logger })).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('ready يرجع 503 عند فشل القاعدة', async () => {
    const app = createApp({
      logger,
      checkDb: async () => {
        throw new Error('down');
      },
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks.database).toBe('down');
  });

  it('ready يرجع 200 عندما تعمل القاعدة', async () => {
    const app = createApp({ logger, checkDb: async () => undefined });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
  });
});

describe('health: فحوص إضافية', () => {
  const ok = async () => undefined;
  const bad = async () => {
    throw new Error('down');
  };
  it('فحص حرج فاشل (التخزين) = 503', async () => {
    const app = createApp({
      logger,
      checkDb: ok,
      checks: [{ name: 'storage', critical: true, run: bad }],
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks).toMatchObject({ database: 'up', storage: 'down' });
  });
  it('فحص غير حرج فاشل (render/worker) = 200 مع degraded', async () => {
    const app = createApp({
      logger,
      checkDb: ok,
      checks: [
        { name: 'storage', critical: true, run: ok },
        { name: 'render', critical: false, run: bad },
      ],
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.checks.render).toBe('down');
  });
  it('كل الفحوص سليمة = ok', async () => {
    const app = createApp({
      logger,
      checkDb: ok,
      checks: [{ name: 'render', critical: false, run: ok }],
    });
    const res = await request(app).get('/health/ready');
    expect(res.body.data).toEqual({ status: 'ok', checks: { database: 'up', render: 'up' } });
  });
});

describe('errors', () => {
  it('مسار مجهول يرجع شكل الخطأ الموحّد', async () => {
    const res = await request(createApp({ logger })).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(res.body.error.requestId).toBeTruthy();
  });
});
