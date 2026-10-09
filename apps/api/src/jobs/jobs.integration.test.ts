import { randomBytes } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import request from 'supertest';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
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
import {
  BOSS_SCHEMA,
  createJobQueue,
  defineJob,
  installJobSchema,
  makeRegistry,
  startWorkers,
  syncSchedules,
  type JobQueue,
} from './index.js';

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

describe('المهام الخلفية', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let apiBoss: PgBoss;
  let workerBoss: PgBoss;
  let queue: JobQueue;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  let globex: string;
  const tokens: Record<string, string> = {};
  const seen: string[] = [];

  const registry = makeRegistry([
    defineJob({
      name: 'test.ok',
      queue: 'default',
      parse: (d) => z.object({ n: z.number().default(1) }).parse(d ?? {}),
      handle: async (ctx, data) => {
        seen.push(ctx.companyId);
        return { doubled: data.n * 2 };
      },
    }),
    defineJob({
      // يفشل أول محاولتين ثم ينجح
      name: 'test.flaky',
      queue: 'critical',
      parse: (d) => z.object({}).parse(d ?? {}),
      handle: async (_ctx, _data, info) => {
        if (info.attempt < 3) throw new Error(`فشل مؤقت ${info.attempt}`);
        return { attempt: info.attempt };
      },
    }),
    defineJob({
      name: 'test.broken',
      queue: 'bulk',
      parse: (d) => z.object({}).parse(d ?? {}),
      handle: async () => {
        throw new Error('عطل دائم');
      },
    }),
  ]);

  const makeUser = (companyId: string, email: string, roleCode: string) =>
    withTenant(admin, { companyId }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', companyId)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId,
          userId: user.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
    });
  const login = async (email: string, company: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company })
    ).body.data.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const post = (who: string, p: string) => request(api).post(`/api/v1${p}`).set(as(who));

  const enqueue = (
    companyId: string,
    name: string,
    data: unknown,
    opts: Parameters<JobQueue['enqueue']>[3] = {},
  ) => withTenant(app, { companyId }, (ctx) => queue.enqueue(ctx, name, data, opts));
  const runOf = (companyId: string, id: string) =>
    withTenant(app, { companyId }, (ctx) =>
      ctx.trx.selectFrom('jobRuns').selectAll().where('id', '=', id).executeTakeFirst(),
    );

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    await installJobSchema(pgx.adminUrl);
    const mk = async (slug: string) => {
      const row = await admin
        .insertInto('companies')
        .values({ slug, nameAr: slug })
        .returning('id')
        .executeTakeFirstOrThrow();
      await withTenant(admin, { companyId: row.id }, (ctx) => seedDefaultRoles(ctx));
      return row.id;
    };
    acme = await mk('acme');
    globex = await mk('globex');

    // الـ API: دور التطبيق، بلا صيانة ولا جدولة (كما في الإنتاج)
    apiBoss = new PgBoss({
      connectionString: pgx.appUrl,
      schema: BOSS_SCHEMA,
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    await apiBoss.start();
    queue = createJobQueue(apiBoss, registry);

    const k = () => randomBytes(32).toString('base64');
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto: createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() }),
        jobs: queue,
      },
    });

    // العامل: حساب المالك لصيانة المخطط، ومهام الأعمال عبر دور التطبيق
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
      registry,
      periodic: [{ job: 'test.ok', cron: '0 3 * * *' }],
      logger: pino({ level: 'silent' }),
      pollSeconds: 0.5,
    });

    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(acme, 'emp@acme.test', 'employee');
    await makeUser(globex, 'admin@globex.test', 'admin');
    tokens['admin'] = await login('admin@acme.test', 'acme');
    tokens['emp'] = await login('emp@acme.test', 'acme');
    tokens['globex'] = await login('admin@globex.test', 'globex');
  }, 120_000);

  afterAll(async () => {
    await workerBoss?.stop({ graceful: false });
    await apiBoss?.stop({ graceful: false });
    await app?.destroy();
    await admin?.destroy();
    await pgx?.stop();
  });

  it('مهمة تُدرج وتنجح ويظهر ناتجها في المراقب', async () => {
    const id = await enqueue(acme, 'test.ok', { n: 21 });
    expect(id).toBeTruthy();
    const run = await wait(async () => {
      const r = await runOf(acme, id as string);
      return r?.status === 'succeeded' ? r : undefined;
    });
    expect(run.result).toEqual({ doubled: 42 });
    expect(run.attempt).toBe(1);
    expect(run.finishedAt).not.toBeNull();

    const detail = await get('admin', `/jobs/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe('succeeded');
    const list = await get('admin', '/jobs?status=succeeded&jobName=test.ok');
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('الإدراج داخل معاملة العمل: التراجع يلغي المهمة والسجل معاً', async () => {
    const before = await admin
      .selectFrom('jobRuns')
      .select(sql<string>`count(*)`.as('n'))
      .executeTakeFirstOrThrow();
    await expect(
      withTenant(app, { companyId: acme }, async (ctx) => {
        await queue.enqueue(ctx, 'test.ok', { n: 5 });
        throw new Error('تراجع العمل');
      }),
    ).rejects.toThrow('تراجع العمل');
    const after = await admin
      .selectFrom('jobRuns')
      .select(sql<string>`count(*)`.as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
    const orphan = await sql<{ n: string }>`
      select count(*) as n from ${sql.id(BOSS_SCHEMA, 'job')}
      where name = 'default' and data->'data'->>'n' = '5'`.execute(admin);
    expect(orphan.rows[0]?.n).toBe('0');
  });

  it('فشل مؤقت يُعاد بتراجع ثم ينجح (المحاولة 3)', async () => {
    const id = (await enqueue(acme, 'test.flaky', {}, { retryLimit: 3, retryDelay: 1 })) as string;
    const retrying = await wait(async () => {
      const r = await runOf(acme, id);
      return r?.status === 'retrying' ? r : undefined;
    });
    expect(retrying.error).toContain('فشل مؤقت');
    const done = await wait(async () => {
      const r = await runOf(acme, id);
      return r?.status === 'succeeded' ? r : undefined;
    });
    expect(done.attempt).toBe(3);
    expect(done.result).toEqual({ attempt: 3 });
    expect(done.error).toBeNull();
  });

  it('فشل دائم يظهر failed ويمكن إعادة تشغيله بصلاحيتها فقط', async () => {
    const id = (await enqueue(acme, 'test.broken', {}, { retryLimit: 1, retryDelay: 1 })) as string;
    const failed = await wait(async () => {
      const r = await runOf(acme, id);
      return r?.status === 'failed' ? r : undefined;
    });
    expect(failed.error).toBe('عطل دائم');
    expect(failed.attempt).toBe(2);
    expect(failed.maxAttempts).toBe(2);

    // لا صلاحية للموظف
    expect((await post('emp', `/jobs/${id}/retry`)).status).toBe(403);
    expect((await get('emp', '/jobs')).status).toBe(403);
    // شركة أخرى لا ترى المهمة
    expect((await get('globex', `/jobs/${id}`)).status).toBe(404);
    expect((await post('globex', `/jobs/${id}/retry`)).status).toBe(404);

    const retry = await post('admin', `/jobs/${id}/retry`);
    expect(retry.status).toBe(202);
    const created = await runOf(acme, retry.body.data.id);
    expect(created?.retryOf).toBe(id);
    expect(created?.jobName).toBe('test.broken');

    // الناجحة لا تُعاد
    const okId = (await enqueue(acme, 'test.ok', {})) as string;
    await wait(async () => (await runOf(acme, okId))?.status === 'succeeded');
    expect((await post('admin', `/jobs/${okId}/retry`)).status).toBe(409);
  });

  it('الاستحقاق الدوري يتفرّع إلى مهمة لكل شركة نشطة', async () => {
    await workerBoss.send('default', { tick: 'test.ok' });
    const both = await wait(async () => {
      const rows = await admin
        .selectFrom('jobRuns')
        .select('companyId')
        .where('jobName', '=', 'test.ok')
        .where('status', '=', 'succeeded')
        .where('requestedBy', 'is', null)
        .execute();
      const ids = new Set(rows.map((r) => r.companyId));
      return ids.has(acme) && ids.has(globex) ? ids : undefined;
    });
    expect(both.size).toBeGreaterThanOrEqual(2);
    expect(seen).toContain(globex);
  });

  it('المهام الدورية تُزامَن مع الكود وتُحذف التي أُزيلت', async () => {
    const keys = async () => (await workerBoss.getSchedules()).map((s) => s.key);
    expect(await keys()).toContain('test.ok');
    await syncSchedules(workerBoss, registry, []);
    expect(await keys()).not.toContain('test.ok');
    await expect(
      syncSchedules(workerBoss, registry, [{ job: 'nope', cron: '* * * * *' }]),
    ).rejects.toThrow('غير معرّفة');
  });

  it('مهمة بحمولة غير صالحة تُرفض عند الإدراج', async () => {
    await expect(enqueue(acme, 'test.ok', { n: 'x' })).rejects.toThrow();
    await expect(enqueue(acme, 'unknown.job', {})).rejects.toThrow('غير معرّفة');
  });
});
