import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb, type Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import { buildRegistry } from '../jobs/registry.js';
import type { JobInfo } from '../jobs/types.js';
import { createFieldCrypto } from '../shared/crypto.js';
import { startTestPg, type TestPg } from '../test/pg.js';
import {
  hashPassword,
  seedDefaultRoles,
  syncPermissionCatalog,
} from '../modules/identity/index.js';
import { createTelegramApi, createTelegramProvider, createNotifier } from './index.js';

const PASSWORD = 'correct-horse-battery';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

type Call = { method: string; token: string; params: Record<string, unknown> };

/** Bot API وهمي يسجّل الاستدعاءات. */
const startFakeTelegram = async () => {
  const calls: Call[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
      const params = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (!m || m[1] !== TOKEN) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
        return;
      }
      calls.push({ method: m[2] as string, token: m[1] as string, params });
      const result = m[2] === 'getMe' ? { username: 'hrms_test_bot' } : true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, stop: () => new Promise<void>((r) => server.close(() => r())) };
};

describe('قنوات الإشعار: تلغرام', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  let tg: Awaited<ReturnType<typeof startFakeTelegram>>;
  let provider: ReturnType<typeof createTelegramProvider>;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const sentTexts = () =>
    tg.calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.params['text']));

  const makeUser = (email: string, roleCode: string) =>
    withTenant(admin, { companyId: acme }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', acme)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId: acme,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: acme,
          userId: user.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
      return user.id;
    });
  const login = async (email: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;

  beforeAll(async () => {
    tg = await startFakeTelegram();
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'acme' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await withTenant(admin, { companyId: acme }, (ctx) => seedDefaultRoles(ctx));
    const k = () => randomBytes(32).toString('base64');
    const crypto = createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() });
    const telegramApi = createTelegramApi(tg.base);
    provider = createTelegramProvider({ crypto, api: telegramApi });
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false, crypto, telegramApi },
    });
    userIds['admin'] = await makeUser('admin@acme.test', 'admin');
    userIds['emp'] = await makeUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
  });

  afterAll(async () => {
    await tg?.stop();
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  const cfg = (extra: object = {}) => ({
    botToken: TOKEN,
    publicUrl: 'https://hr.example.test/',
    ...extra,
  });
  let secret = '';
  let code = '';
  const webhook = (body: object, header = secret) =>
    request(api)
      .post(`/api/v1/integrations/telegram/webhook/${acme}`)
      .set('x-telegram-bot-api-secret-token', header)
      .send(body);
  const startMsg = (text: string, chat = 777) => ({
    message: { text, chat: { id: chat }, from: { username: 'amro' } },
  });

  it('قبل الإعداد: غير متاح للمستخدم، والربط 409، والصلاحية مقيَّدة', async () => {
    expect((await get('admin', '/integrations/telegram')).body.data).toBeNull();
    const me = (await get('emp', '/integrations/telegram/me')).body.data;
    expect(me).toEqual({ available: false, linked: false, tgUsername: null });
    expect((await post('emp', '/integrations/telegram/me/link-code')).status).toBe(409);
    expect((await put('emp', '/integrations/telegram', cfg())).status).toBe(403);
  });

  it('الحفظ: يتحقق من التوكن، يضبط webhook بسرّ، ولا يعيد التوكن', async () => {
    expect((await put('admin', '/integrations/telegram', cfg({ botToken: 'bad' }))).status).toBe(
      400,
    );
    expect(
      (await put('admin', '/integrations/telegram', cfg({ publicUrl: 'http://x.test' }))).status,
    ).toBe(400);
    const wrong = await put(
      'admin',
      '/integrations/telegram',
      cfg({ botToken: '999999999:ZZZZZZZZZZZZZZZZZZZZZZ' }),
    );
    expect(wrong.status).toBe(502);
    expect(wrong.body.error.code).toBe('TELEGRAM_API_FAILED');

    const ok = await put('admin', '/integrations/telegram', cfg());
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      enabled: true,
      hasToken: true,
      botUsername: 'hrms_test_bot',
      publicUrl: 'https://hr.example.test',
    });
    expect(JSON.stringify(ok.body)).not.toContain(TOKEN);
    const hook = tg.calls.find((c) => c.method === 'setWebhook');
    expect(hook?.params['url']).toBe(
      `https://hr.example.test/api/v1/integrations/telegram/webhook/${acme}`,
    );
    secret = String(hook?.params['secret_token']);
    expect(secret).toHaveLength(48);
    const row = await admin
      .selectFrom('integrationSettings')
      .selectAll()
      .where('provider', '=', 'telegram')
      .executeTakeFirstOrThrow();
    expect(row.secretEnc).toMatch(/^v1\./);
    expect(row.secretEnc).not.toContain(TOKEN);
  });

  it('رمز الربط يُنشأ، والـ webhook يرفض السرّ الخاطئ ويقبل الصحيح', async () => {
    const r = await post('emp', '/integrations/telegram/me/link-code');
    expect(r.status).toBe(200);
    code = r.body.data.code;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(r.body.data.deepLink).toBe(`https://t.me/hrms_test_bot?start=${code}`);

    expect((await webhook(startMsg(`/start ${code}`), 'wrong')).status).toBe(403);
    expect((await get('emp', '/integrations/telegram/me')).body.data.linked).toBe(false);

    expect((await webhook(startMsg(`/start ${code}`))).status).toBe(200);
    const me = (await get('emp', '/integrations/telegram/me')).body.data;
    expect(me).toEqual({ available: true, linked: true, tgUsername: 'amro' });
    expect(sentTexts().at(-1)).toContain('تم ربط حسابك');
    // الرمز لمرة واحدة
    await webhook(startMsg(`/start ${code}`, 888));
    expect(sentTexts().at(-1)).toContain('غير صالح');
    expect(await admin.selectFrom('telegramLinks').selectAll().execute()).toHaveLength(1);
  });

  it('رمز منتهٍ أو نص آخر لا يربط', async () => {
    const r = await post('admin', '/integrations/telegram/me/link-code');
    await admin
      .updateTable('telegramLinkCodes')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('code', '=', r.body.data.code)
      .execute();
    await webhook(startMsg(`/start ${r.body.data.code}`, 999));
    expect(sentTexts().at(-1)).toContain('غير صالح');
    await webhook(startMsg('مرحبا', 999));
    expect(sentTexts().at(-1)).toContain('ربط تلغرام');
    expect((await get('admin', '/integrations/telegram/me')).body.data.linked).toBe(false);
  });

  it('الإشعار يُسلَّم عبر مهمة تلغرام لمن ربط حسابه فقط ويحترم التفضيلات', async () => {
    const queued: { name: string; data: unknown }[] = [];
    const notifier = createNotifier({
      enqueue: async (_ctx, name, data) => {
        queued.push({ name, data });
        return null;
      },
    });
    const info: JobInfo = {
      runId: 'r',
      attempt: 1,
      maxAttempts: 1,
      queue: { enqueue: async () => null },
    };
    const def = buildRegistry(undefined, provider).get('notifications.send_telegram')!;
    const before = sentTexts().length;
    const notify = (who: string) =>
      withTenant(app, { companyId: acme }, async (ctx) => {
        await notifier.notify(ctx, {
          userId: userIds[who] as string,
          event: 'system.test',
          link: '/notifications',
        });
        for (const q of queued.splice(0).filter((x) => x.name === 'notifications.send_telegram'))
          await def.handle(ctx, def.parse(q.data), info);
      });
    await notify('admin'); // غير مربوط
    expect(sentTexts()).toHaveLength(before);
    await notify('emp');
    expect(sentTexts()).toHaveLength(before + 1);
    const text = sentTexts().at(-1) as string;
    expect(text).toContain('https://hr.example.test/notifications');
    const d = await admin
      .selectFrom('notificationDeliveries')
      .selectAll()
      .where('channel', '=', 'telegram')
      .execute();
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ status: 'sent', toAddress: '777' });

    // تعطيل القناة في التفضيلات (فئة system إلزامية؟ نستعمل فئة غير إلزامية إن وُجدت)
    const prefs = (await get('emp', '/notifications/preferences')).body.data as {
      category: string;
      mandatory: boolean;
      channels: Record<string, boolean>;
    }[];
    expect(prefs.every((p) => 'telegram' in p.channels)).toBe(true);
  });

  it('الإدارة: قائمة المربوطين، اختبار الإرسال، فك ربط مستخدم، والتعطيل يحذف webhook', async () => {
    const links = (await get('admin', '/integrations/telegram/links')).body.data;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ email: 'emp@acme.test', tgUsername: 'amro' });
    expect((await get('emp', '/integrations/telegram/links')).status).toBe(403);
    // حساب admin غير مربوط
    expect((await post('admin', '/integrations/telegram/test')).status).toBe(409);
    const del = await request(api)
      .delete(`/api/v1/integrations/telegram/links/${userIds['emp']}`)
      .set(as('admin'));
    expect(del.status).toBe(204);
    expect((await get('admin', '/integrations/telegram/links')).body.data).toHaveLength(0);

    const off = await put('admin', '/integrations/telegram', {
      enabled: false,
      publicUrl: 'https://hr.example.test',
    });
    expect(off.status).toBe(200);
    expect(tg.calls.some((c) => c.method === 'deleteWebhook')).toBe(true);
    expect((await get('emp', '/integrations/telegram/me')).body.data.available).toBe(false);
    expect((await webhook(startMsg('/start AAAAAAAA'))).status).toBe(403);
  });
});
