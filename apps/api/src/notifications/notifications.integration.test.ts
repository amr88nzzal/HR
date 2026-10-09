import { randomBytes } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb, type Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import { BOSS_SCHEMA, createJobQueue, installJobSchema, startWorkers } from '../jobs/index.js';
import { buildRegistry } from '../jobs/registry.js';
import {
  hashPassword,
  seedDefaultRoles,
  syncPermissionCatalog,
} from '../modules/identity/index.js';
import { createFieldCrypto } from '../shared/crypto.js';
import { startTestPg, type TestPg } from '../test/pg.js';
import { createNotifier, type MailMessage, type MailTransport } from './index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'm'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

const wait = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('انتهت مهلة الانتظار');
    await new Promise((r) => setTimeout(r, 150));
  }
};

describe('الإشعارات', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let apiBoss: PgBoss;
  let workerBoss: PgBoss;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sent: MailMessage[] = [];
  let failMail = false;

  const mail: MailTransport = {
    send: async (msg) => {
      if (failMail) throw new Error('SMTP down');
      sent.push(msg);
    },
  };

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
          displayName: email.split('@')[0] as string,
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
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));
  const deliveries = () =>
    admin.selectFrom('notificationDeliveries').selectAll().orderBy('createdAt', 'desc').execute();

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    await installJobSchema(pgx.adminUrl);
    const row = await admin
      .insertInto('companies')
      .values({ slug: 'acme', nameAr: 'acme' })
      .returning('id')
      .executeTakeFirstOrThrow();
    acme = row.id;
    await withTenant(admin, { companyId: acme }, (ctx) => seedDefaultRoles(ctx));

    apiBoss = new PgBoss({
      connectionString: pgx.appUrl,
      schema: BOSS_SCHEMA,
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    await apiBoss.start();
    const queue = createJobQueue(apiBoss, buildRegistry(undefined));
    // محاولة إعادة واحدة بتأخير ثانية ليظهر الفشل النهائي بسرعة في الاختبار
    const fastQueue = {
      enqueue: (...a: Parameters<typeof queue.enqueue>) =>
        queue.enqueue(a[0], a[1], a[2], { retryLimit: 1, retryDelay: 1, ...a[3] }),
    };
    const k = () => randomBytes(32).toString('base64');
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto: createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() }),
        jobs: fastQueue,
      },
    });

    workerBoss = new PgBoss({
      connectionString: pgx.adminUrl,
      schema: BOSS_SCHEMA,
      migrate: false,
      createSchema: false,
      supervise: true,
      schedule: true,
    });
    await workerBoss.start();
    await startWorkers({
      boss: workerBoss,
      db: app,
      adminDb: admin,
      registry: buildRegistry(mail),
      periodic: [],
      logger: pino({ level: 'silent' }),
      pollSeconds: 0.5,
    });

    ids['admin'] = await makeUser('admin@acme.test', 'admin');
    ids['emp'] = await makeUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
  }, 120_000);

  afterAll(async () => {
    await workerBoss?.stop({ graceful: false });
    await apiBoss?.stop({ graceful: false });
    await app?.destroy();
    await admin?.destroy();
    await pgx?.stop();
  });

  it('إشعار تجريبي: داخل التطبيق + بريد، ثم القراءة', async () => {
    expect((await post('admin', '/notifications/test')).status).toBe(201);
    const list = await get('admin', '/notifications');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].title).toBe('إشعار تجريبي');
    expect(list.body.data[0].body).toContain('admin');
    expect((await get('admin', '/notifications/unread-count')).body.data.count).toBe(1);

    // البريد يُسلَّم عبر العامل
    const mailSent = await wait(async () => (sent.length > 0 ? sent[0] : undefined));
    expect(mailSent.to).toBe('admin@acme.test');
    expect(mailSent.subject).toBe('إشعار تجريبي');
    expect(mailSent.html).toContain('dir="rtl"');
    const d = await wait(async () => {
      const rows = await deliveries();
      return rows[0]?.status === 'sent' ? rows[0] : undefined;
    });
    expect(d.attempts).toBe(1);

    const id = list.body.data[0].id as string;
    expect((await post('emp', `/notifications/${id}/read`)).status).toBe(404); // ليس إشعاره
    expect((await post('admin', `/notifications/${id}/read`)).status).toBe(200);
    expect((await post('admin', `/notifications/${id}/read`)).status).toBe(200); // مكرر آمن
    expect((await get('admin', '/notifications/unread-count')).body.data.count).toBe(0);
    expect((await get('emp', '/notifications')).body.data).toHaveLength(0);
  });

  it('الاختبار التجريبي يتطلب صلاحية القوالب', async () => {
    expect((await post('emp', '/notifications/test')).status).toBe(403);
    expect((await get('emp', '/notification-templates')).status).toBe(403);
  });

  it('التفضيلات: تعطيل البريد يمنع التسليم، وتعطيل الداخل يخفي الإشعار', async () => {
    const before = (await deliveries()).length;
    expect(
      (
        await put('admin', '/notifications/preferences', {
          items: [{ category: 'system', channel: 'email', enabled: false }],
        })
      ).status,
    ).toBe(200);
    await post('admin', '/notifications/test');
    expect((await get('admin', '/notifications')).body.data).toHaveLength(2);
    expect((await deliveries()).length).toBe(before);

    await put('admin', '/notifications/preferences', {
      items: [
        { category: 'system', channel: 'email', enabled: true },
        { category: 'system', channel: 'in_app', enabled: false },
      ],
    });
    await post('admin', '/notifications/test');
    expect((await get('admin', '/notifications')).body.data).toHaveLength(2); // الجديد مخفي
    await wait(async () => (await deliveries()).length === before + 1);

    const matrix = (await get('admin', '/notifications/preferences')).body.data;
    const system = matrix.find((m: { category: string }) => m.category === 'system');
    expect(system.channels).toEqual({ in_app: false, email: true });
    expect(
      (
        await put('admin', '/notifications/preferences', {
          items: [{ category: 'nope', channel: 'email', enabled: false }],
        })
      ).status,
    ).toBe(400);
    await put('admin', '/notifications/preferences', {
      items: [{ category: 'system', channel: 'in_app', enabled: true }],
    });
  });

  it('قالب مخصص يُستعمل، والمتغير غير المسموح يُرفض، والحذف يعيد الافتراضي', async () => {
    const url = '/notification-templates/system.test/in_app/ar';
    expect((await put('admin', url, { subject: 'س {{bad}}', body: 'ب' })).status).toBe(400);
    expect(
      (await put('admin', url, { subject: 'تجربة {{user}}', body: 'نص مخصص لـ {{user}}' })).status,
    ).toBe(200);
    await post('admin', '/notifications/test');
    const first = (await get('admin', '/notifications')).body.data[0];
    expect(first.title).toBe('تجربة admin');
    expect(first.body).toBe('نص مخصص لـ admin');

    const tpl = (await get('admin', '/notification-templates')).body.data.find(
      (e: { eventKey: string }) => e.eventKey === 'system.test',
    );
    expect(tpl.overrides).toHaveLength(1);
    expect(tpl.variables).toEqual(['user']);

    expect((await del('admin', url)).status).toBe(204);
    await post('admin', '/notifications/test');
    expect((await get('admin', '/notifications')).body.data[0].title).toBe('إشعار تجريبي');
    expect(
      (await put('admin', '/notification-templates/nope/email/ar', { subject: 'a', body: 'b' }))
        .status,
    ).toBe(404);
  });

  it('فشل البريد النهائي يُسجَّل failed على التسليم بعد إعادة المحاولة', async () => {
    failMail = true;
    const before = (await deliveries()).length;
    await post('admin', '/notifications/test');
    const failed = await wait(async () => {
      const rows = await deliveries();
      return rows.length === before + 1 && rows[0]?.status === 'failed' ? rows[0] : undefined;
    });
    expect(failed.error).toContain('SMTP down');
    expect(failed.attempts).toBe(2);
    failMail = false;
  });

  it('بلا قائمة مهام يُعلَّم التسليم skipped ولا يفشل الإشعار', async () => {
    const before = (await deliveries()).length;
    const notifier = createNotifier(undefined);
    await withTenant(app, { companyId: acme }, (ctx) =>
      notifier.notify(ctx, {
        userId: ids['admin'] as string,
        event: 'system.test',
        vars: { user: 'x' },
      }),
    );
    const rows = await deliveries();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]?.status).toBe('skipped');
  });
});
