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

describe('errors', () => {
  it('مسار مجهول يرجع شكل الخطأ الموحّد', async () => {
    const res = await request(createApp({ logger })).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(res.body.error.requestId).toBeTruthy();
  });
});
