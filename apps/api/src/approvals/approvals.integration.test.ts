import { randomBytes } from 'node:crypto';
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
import { seedDemo } from '../seed/demo.js';

const PASSWORD = 'Demo-pass-12345';
const settings = {
  jwtSecret: 'm'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('محرك الموافقات', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const login = async (email: string) =>
    (await request(api).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }))
      .body.data.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object = {}) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const put = (who: string, path: string, body: object) =>
    request(api).put(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));
  const submit = (who: string, amount: number) =>
    post(who, '/approvals', {
      requestType: 'general',
      title: `طلب ${amount}`,
      payload: { amount },
    });
  const act = (who: string, id: string, action: string, note?: string) =>
    post(who, `/approvals/${id}/actions`, { action, note });
  const inbox = async (who: string) =>
    (await get(who, '/approvals/inbox')).body.data as { id: string }[];

  const extraUser = (email: string, roleCode: string) =>
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
          scopeType: 'self',
          scopeId: null,
        })
        .execute();
      return user.id;
    });

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    const c = await admin
      .insertInto('companies')
      .values({ slug: 'acme', nameAr: 'acme' })
      .returning('id')
      .executeTakeFirstOrThrow();
    acme = c.id;
    await withTenant(admin, { companyId: acme }, async (ctx) => {
      await seedDefaultRoles(ctx);
      await seedDemo(ctx, PASSWORD);
    });
    ids['boss'] = await extraUser('boss@acme.test', 'employee');
    ids['deleg'] = await extraUser('deleg@acme.test', 'employee');
    ids['stranger'] = await extraUser('stranger@acme.test', 'employee');
    // مدير النظام
    await withTenant(admin, { companyId: acme }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', acme)
        .where('code', '=', 'admin')
        .executeTakeFirstOrThrow();
      const u = await ctx.trx
        .insertInto('users')
        .values({
          companyId: acme,
          email: 'admin@acme.test',
          displayName: 'admin',
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: acme,
          userId: u.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
    });
    const k = () => randomBytes(32).toString('base64');
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto: createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() }),
      },
    });
    for (const [k2, email] of [
      ['admin', 'admin@acme.test'],
      ['hr', 'demo.hr@demo.hrms.local'],
      ['emp', 'demo.employee@demo.hrms.local'],
      ['boss', 'boss@acme.test'],
      ['deleg', 'deleg@acme.test'],
      ['stranger', 'stranger@acme.test'],
    ] as const)
      tokens[k2] = await login(email);
  }, 180_000);

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  it('لا تُقدَّم طلبات بلا سلسلة فعّالة', async () => {
    const r = await submit('emp', 100);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_FLOW');
  });

  it('الإدارة: إنشاء سلسلة بخطوتين وشرط، والتحقق من الصلاحية', async () => {
    const body = {
      code: 'general-2',
      requestType: 'general',
      nameAr: 'سلسلة عامة',
      steps: [
        { nameAr: 'المدير المباشر', approverType: 'direct_manager' },
        {
          nameAr: 'المدير الأعلى',
          approverType: 'user',
          approverRef: ids['boss'],
          condition: { field: 'amount', op: 'gte', value: 1000 },
        },
      ],
    };
    expect((await post('emp', '/approval-flows', body)).status).toBe(403);
    const bad = await post('admin', '/approval-flows', {
      ...body,
      code: 'x',
      steps: [{ nameAr: 'س', approverType: 'user' }],
    });
    expect(bad.status).toBe(400);
    const unknown = await post('admin', '/approval-flows', {
      ...body,
      code: 'y',
      requestType: 'nope',
    });
    expect(unknown.status).toBe(400);
    const created = await post('admin', '/approval-flows', body);
    expect(created.status).toBe(201);
    expect(created.body.data.steps).toHaveLength(2);
    expect(created.body.data.isActive).toBe(true);
    ids['flow'] = created.body.data.id;
    const types = await get('admin', '/approval-flows/request-types');
    expect(types.body.data.some((t: { key: string }) => t.key === 'general')).toBe(true);
  });

  it('طلب صغير: يمرّ بالمدير المباشر فقط ويُتخطى شرط الخطوة الثانية', async () => {
    const r = await submit('emp', 500);
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('pending');
    const id = r.body.data.id as string;
    expect((await inbox('hr')).map((x) => x.id)).toContain(id);
    expect((await inbox('boss')).map((x) => x.id)).not.toContain(id);
    expect((await get('hr', '/approvals/inbox/count')).body.data.count).toBe(1);

    expect((await act('stranger', id, 'approve')).status).toBe(403);
    expect((await act('emp', id, 'approve')).status).toBe(403);
    const done = await act('hr', id, 'approve');
    expect(done.body.data.status).toBe('approved');
    expect((await act('hr', id, 'approve')).status).toBe(409);

    const detail = (await get('emp', `/approvals/${id}`)).body.data;
    expect(detail.status).toBe('approved');
    expect(detail.actions.map((a: { action: string }) => a.action)).toEqual(['submit', 'approve']);
    expect(detail.canAct).toBe(false);
    const notes = (await get('emp', '/notifications')).body.data as { eventKey: string }[];
    expect(notes.some((n) => n.eventKey === 'approval.approved')).toBe(true);
    const hrNotes = (await get('hr', '/notifications')).body.data as { eventKey: string }[];
    expect(hrNotes.some((n) => n.eventKey === 'approval.assigned')).toBe(true);
  });

  it('طلب كبير: خطوتان، والرفض يتطلب ملاحظة', async () => {
    const r = await submit('emp', 5000);
    const id = r.body.data.id as string;
    expect((await act('hr', id, 'approve')).body.data.status).toBe('pending');
    expect((await inbox('boss')).map((x) => x.id)).toContain(id);
    expect((await inbox('hr')).map((x) => x.id)).not.toContain(id);
    const noNote = await act('boss', id, 'reject');
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.code).toBe('NOTE_REQUIRED');
    expect((await act('boss', id, 'reject', 'ميزانية غير كافية')).body.data.status).toBe(
      'rejected',
    );
    const detail = (await get('emp', `/approvals/${id}`)).body.data;
    expect(detail.finalNote).toBe('ميزانية غير كافية');
    expect((await get('stranger', `/approvals/${id}`)).status).toBe(404);
    expect((await get('admin', `/approvals/${id}`)).status).toBe(200); // read_all
  });

  it('الإرجاع وإعادة التقديم ثم السحب', async () => {
    const id = (await submit('emp', 200)).body.data.id as string;
    expect((await act('hr', id, 'return', 'أضف التفاصيل')).body.data.status).toBe('returned');
    expect((await act('hr', id, 'approve')).status).toBe(409);
    expect((await post('hr', `/approvals/${id}/resubmit`, {})).status).toBe(403);
    const re = await post('emp', `/approvals/${id}/resubmit`, { payload: { amount: 3000 } });
    expect(re.body.data.status).toBe('pending');
    expect((await act('hr', id, 'approve')).body.data.status).toBe('pending'); // صار يلزم boss
    const w = await post('emp', `/approvals/${id}/withdraw`, { note: 'لم أعد بحاجة' });
    expect(w.body.data.status).toBe('withdrawn');
    expect((await inbox('boss')).map((x) => x.id)).not.toContain(id);
    expect((await post('emp', `/approvals/${id}/withdraw`)).status).toBe(409);
  });

  it('التفويض: النائب يوافق نيابة عن المعتمد ويُلغى مقعد الأصيل', async () => {
    const del = await post('hr', '/approval-delegations', {
      delegateUserId: ids['deleg'],
      validFrom: day(-1),
      validTo: day(2),
    });
    expect(del.status).toBe(201);
    expect(
      (
        await post('hr', '/approval-delegations', {
          delegateUserId: ids['deleg'],
          validFrom: day(3),
          validTo: day(1),
        })
      ).status,
    ).toBe(400);
    expect((await get('deleg', '/approval-delegations')).body.data).toHaveLength(1);
    expect((await get('deleg', '/approval-delegations?all=true')).status).toBe(403);

    const id = (await submit('emp', 10)).body.data.id as string;
    expect((await inbox('hr')).map((x) => x.id)).toContain(id);
    expect((await inbox('deleg')).map((x) => x.id)).toContain(id);
    const ok = await act('deleg', id, 'approve');
    expect(ok.body.data.status).toBe('approved');
    const detail = (await get('emp', `/approvals/${id}`)).body.data;
    const approve = detail.actions.find((a: { action: string }) => a.action === 'approve');
    expect(approve.actorUserId).toBe(ids['deleg']);
    expect(approve.onBehalfOfUserId).not.toBeNull();
    expect((await inbox('hr')).map((x) => x.id)).not.toContain(id);

    // إلغاء التفويض يوقف الإسناد للنائب
    expect((await get('hr', '/approval-delegations')).body.data).toHaveLength(1);
    const delId = del.body.data.id as string;
    expect(
      (await request(api).delete(`/api/v1/approval-delegations/${delId}`).set(as('stranger')))
        .status,
    ).toBe(403);
    expect(
      (await request(api).delete(`/api/v1/approval-delegations/${delId}`).set(as('hr'))).status,
    ).toBe(204);
    const id2 = (await submit('emp', 10)).body.data.id as string;
    expect((await inbox('deleg')).map((x) => x.id)).not.toContain(id2);
    await act('hr', id2, 'approve');
  });

  it('لا يمكن تعديل سلسلة عليها طلبات قيد الموافقة', async () => {
    const id = (await submit('emp', 9000)).body.data.id as string;
    const flow = (await get('admin', `/approval-flows/${ids['flow']}`)).body.data;
    const body = {
      requestType: 'general',
      nameAr: 'معدَّلة',
      version: flow.version,
      steps: [{ nameAr: 'المدير', approverType: 'direct_manager' }],
    };
    const r = await put('admin', `/approval-flows/${ids['flow']}`, body);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('FLOW_IN_USE');
    await post('emp', `/approvals/${id}/withdraw`);
    const ok = await put('admin', `/approval-flows/${ids['flow']}`, body);
    expect(ok.status).toBe(200);
    expect(ok.body.data.isActive).toBe(true);
    expect(ok.body.data.steps).toHaveLength(1);
    expect(
      (await request(api).delete(`/api/v1/approval-flows/${ids['flow']}`).set(as('admin'))).status,
    ).toBe(409);
  });

  it('تعذّر تحديد معتمد يُسقط التقديم كاملاً', async () => {
    // رئيس القسم (مستخدم hr) مديره المدير العام وهو بلا حساب
    const before = (await get('hr', '/approvals/mine')).body.meta.total as number;
    const r = await submit('hr', 1);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_APPROVER');
    expect((await get('hr', '/approvals/mine')).body.meta.total).toBe(before);
  });
});
