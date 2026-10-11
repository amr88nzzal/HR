import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb, type Db } from '../db/index.js';
import { withTenant } from '../db/tenant.js';
import { createFieldCrypto } from '../shared/crypto.js';
import { startTestPg, type TestPg } from '../test/pg.js';
import {
  hashPassword,
  seedDefaultRoles,
  syncPermissionCatalog,
} from '../modules/identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

/** خادم SMTP مصغّر للاختبار: يقبل AUTH PLAIN ويسجّل الرسائل والاعتماد. */
const startFakeSmtp = async () => {
  const received: { auth: string | null; data: string }[] = [];
  const server = net.createServer((sock) => {
    let auth: string | null = null;
    let inData = false;
    let buf = '';
    let data = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push({ auth, data });
            data = '';
            sock.write('250 queued\r\n');
          } else data += `${line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (cmd.startsWith('AUTH PLAIN')) {
          auth = Buffer.from(line.split(' ')[2] ?? '', 'base64')
            .toString('utf8')
            .replace(/\0/g, '|');
          sock.write('235 ok\r\n');
        } else if (cmd.startsWith('DATA')) {
          inData = true;
          sock.write('354 go\r\n');
        } else if (cmd.startsWith('QUIT')) {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return { port, received, stop: () => new Promise<void>((r) => server.close(() => r())) };
};

describe('قنوات الإشعار: إعداد البريد من الشاشة', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const post = (who: string, p: string, body: object) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);

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
    });
  const login = async (email: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;

  beforeAll(async () => {
    smtp = await startFakeSmtp();
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
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false, crypto },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    tokens['admin'] = await login('admin@acme.test');
    tokens['hr'] = await login('hr@acme.test');
  });

  afterAll(async () => {
    await smtp?.stop();
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  const body = (extra: object = {}) => ({
    host: '127.0.0.1',
    port: smtp?.port,
    secure: false,
    user: 'mailer',
    password: 'S3cret-pass',
    from: 'HRMS <hr@example.test>',
    ...extra,
  });

  it('بلا إعداد: GET يعيد null، والاختبار 409، والصلاحية مقيَّدة', async () => {
    expect((await get('admin', '/integrations/email')).body.data).toBeNull();
    expect((await post('admin', '/integrations/email/test', { to: 'a@b.test' })).status).toBe(409);
    expect((await get('hr', '/integrations/email')).status).toBe(403);
    expect((await put('hr', '/integrations/email', body())).status).toBe(403);
  });

  it('الحفظ يشفّر كلمة السر ولا يعيدها، وتحقق المدخلات', async () => {
    expect((await put('admin', '/integrations/email', body({ port: 70000 }))).status).toBe(400);
    expect((await put('admin', '/integrations/email', body({ from: 'bad' }))).status).toBe(400);
    expect((await put('admin', '/integrations/email', body())).status).toBe(204);
    const dto = (await get('admin', '/integrations/email')).body.data;
    expect(dto).toMatchObject({
      host: '127.0.0.1',
      user: 'mailer',
      hasPassword: true,
      source: 'db',
    });
    expect(JSON.stringify(dto)).not.toContain('S3cret-pass');
    const row = await admin.selectFrom('integrationSettings').selectAll().executeTakeFirstOrThrow();
    expect(row.secretEnc).toMatch(/^v1\./);
    expect(row.secretEnc).not.toContain('S3cret-pass');
    expect(JSON.stringify(row.config)).not.toContain('S3cret-pass');
  });

  it('الإرسال التجريبي يصل إلى الخادم بالاعتماد المحفوظ', async () => {
    const r = await post('admin', '/integrations/email/test', { to: 'target@example.test' });
    expect(r.status).toBe(200);
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0]?.auth).toBe('|mailer|S3cret-pass');
    expect(smtp.received[0]?.data).toContain('target@example.test');
  });

  it('تعديل بلا password يُبقي المحفوظ، و"" يحذفه، والتعطيل يوقف الإرسال', async () => {
    await put('admin', '/integrations/email', body({ password: undefined, host: 'localhost' }));
    const kept = (await get('admin', '/integrations/email')).body.data;
    expect(kept).toMatchObject({ host: 'localhost', hasPassword: true });
    await put('admin', '/integrations/email', body({ password: '' }));
    expect((await get('admin', '/integrations/email')).body.data.hasPassword).toBe(false);
    await put('admin', '/integrations/email', body({ enabled: false }));
    expect((await post('admin', '/integrations/email/test', { to: 'a@b.test' })).status).toBe(409);
  });

  it('فشل الاتصال يعطي 502 برسالة واضحة', async () => {
    await put('admin', '/integrations/email', body({ port: 1, user: null, password: '' }));
    const r = await post('admin', '/integrations/email/test', { to: 'a@b.test' });
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('EMAIL_SEND_FAILED');
  });
});
