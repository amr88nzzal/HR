import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createFieldCrypto } from '../../shared/crypto.js';
import { createLocalStorage } from '../../shared/storage.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';
import { runLeaveMaintenance } from './index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('مرفقات طلب الإجازة', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));

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
  const inTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(admin, { companyId: acme }, fn);

  let annual: string;
  let mgrEmp: string;

  let branch: string;
  let dept: string;
  const newEmployee = async (userId: string, hire: string, managerId: string | null) => {
    const id = (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body
      .data.id as string;
    await admin
      .updateTable('employees')
      .set({ firstHireDate: hire, userId })
      .where('id', '=', id)
      .execute();
    await admin
      .insertInto('employments')
      .values({
        companyId: acme,
        employeeId: id,
        branchId: branch,
        departmentId: dept,
        managerEmployeeId: managerId,
        employmentType: 'full_time',
        validFrom: '2025-01-01',
      })
      .execute();
    return id;
  };

  beforeAll(async () => {
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
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto,
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-leave-'))),
      },
    });
    await makeUser('admin@acme.test', 'admin');
    const empUser = await makeUser('emp@acme.test', 'employee');
    const mgrUser = await makeUser('mgr@acme.test', 'manager');
    await makeUser('other@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
    tokens['mgr'] = await login('mgr@acme.test');
    tokens['other'] = await login('other@acme.test');

    annual = (await post('admin', '/leave-types', { code: 'ANNUAL', nameAr: 'سنوية' })).body.data
      .id;
    const policyId = (
      await post('admin', '/leave-policies', {
        code: 'STD',
        nameAr: 'قياسية',
        leaveTypeId: annual,
        annualEntitlement: 24,
      })
    ).body.data.id;
    await post('admin', '/leave-policy-assignments', { policyId, scope: 'company' });
    branch = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    dept = (
      await post('admin', '/departments', { code: 'IT', nameAr: 'تقنية', branchIds: [branch] })
    ).body.data.id;
    mgrEmp = await newEmployee(mgrUser, '2025-01-01', null);
    await newEmployee(empUser, '2026-01-01', mgrEmp);
    await inTx((ctx) => runLeaveMaintenance(ctx, '2026-06-30')); // يناير..يونيو = 12.00 للموظف
    // الراحة الأسبوعية الافتراضية: الجمعة والسبت
    await post('admin', '/holidays', { holidayDate: '2026-06-17', nameAr: 'عطلة' });
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  const PDF = Buffer.from('%PDF-1.4\n%medical report content');
  const upload = (who: string, id: string, body: Buffer, name = 'تقرير طبي.pdf') =>
    request(api)
      .post(`/api/v1/leave-requests/${id}/attachments`)
      .set(as(who))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(name))
      .send(body);
  const download = (who: string, id: string, att: string) =>
    request(api)
      .get(`/api/v1/leave-requests/${id}/attachments/${att}/content`)
      .set(as(who))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  let reqId: string;
  let attId: string;

  it('النوع الذي يتطلب مرفقاً: الطلب يُقبل بلا مرفق (اختياري) ويظهر التنبيه في التفاصيل', async () => {
    await admin
      .updateTable('leaveTypes')
      .set({ requiresAttachment: true })
      .where('id', '=', annual)
      .execute();
    const r = await post('emp', '/leave-requests', {
      leaveTypeId: annual,
      startDate: '2026-06-22',
      endDate: '2026-06-23',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    reqId = r.body.data.id;
    const d = (await get('emp', `/leave-requests/${reqId}`)).body.data;
    expect(d.requiresAttachment).toBe(true);
    expect(d.attachments).toEqual([]);
  });

  it('صاحب الطلب يرفع PDF: يُخزَّن مشفّراً ويظهر في التفاصيل والقائمة', async () => {
    const up = await upload('emp', reqId, PDF);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    attId = up.body.data.id;
    const list = (await get('emp', `/leave-requests/${reqId}/attachments`)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('تقرير طبي.pdf');
    expect(list[0].mimeType).toBe('application/pdf');
    expect((await get('emp', `/leave-requests/${reqId}`)).body.data.attachments).toHaveLength(1);
    const stored = await admin
      .selectFrom('storedFiles')
      .select(['isEncrypted', 'purpose'])
      .where('purpose', '=', 'leave_request')
      .executeTakeFirstOrThrow();
    expect(stored.isEncrypted).toBe(true);
  });

  it('نوع غير مسموح وملف فارغ مرفوضان', async () => {
    const exe = await upload('emp', reqId, Buffer.from('MZ-not-allowed-binary-content'));
    expect(exe.status).toBe(415);
    const empty = await upload('emp', reqId, Buffer.alloc(0));
    expect(empty.status).toBe(400);
  });

  it('الرؤية: المالك والمعتمد والإدارة ينزّلون، وغيرهم 403، والتنزيل يُسجَّل', async () => {
    for (const who of ['emp', 'mgr', 'admin']) {
      const d = await download(who, reqId, attId);
      expect(d.status, who).toBe(200);
      expect((d.body as Buffer).equals(PDF)).toBe(true);
      expect(d.headers['content-disposition']).toContain("filename*=UTF-8''");
    }
    expect((await download('other', reqId, attId)).status).toBe(403);
    expect((await get('other', `/leave-requests/${reqId}/attachments`)).status).toBe(403);
    const logs = await admin
      .selectFrom('auditLogs')
      .select('id')
      .where('action', '=', 'download')
      .where('entityId', '=', attId)
      .execute();
    expect(logs).toHaveLength(3);
  });

  it('رفع غير المالك مرفوض، والإدارة تستطيع، والحد الأقصى 5', async () => {
    expect((await upload('other', reqId, PDF)).status).toBe(403);
    expect((await upload('mgr', reqId, PDF)).status).toBe(403);
    expect((await upload('admin', reqId, PDF, 'من الموارد.pdf')).status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await upload('emp', reqId, PDF)).status).toBe(201);
    const over = await upload('emp', reqId, PDF);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('TOO_MANY_ATTACHMENTS');
  });

  it('الحذف للمالك أثناء الانتظار، وبعد الاعتماد المالك لا يعدّل والإدارة تعدّل', async () => {
    expect(
      (
        await request(api)
          .delete(`/api/v1/leave-requests/${reqId}/attachments/${attId}`)
          .set(as('other'))
      ).status,
    ).toBe(403);
    const r = await request(api)
      .delete(`/api/v1/leave-requests/${reqId}/attachments/${attId}`)
      .set(as('emp'));
    expect(r.status).toBe(204);
    expect(
      (
        await request(api)
          .delete(`/api/v1/leave-requests/${reqId}/attachments/${attId}`)
          .set(as('emp'))
      ).status,
    ).toBe(404);
    const approval = (await get('emp', `/leave-requests/${reqId}`)).body.data.approvalRequestId;
    expect(
      (await post('mgr', `/approvals/${approval}/actions`, { action: 'approve', note: 'ok' }))
        .status,
    ).toBe(200);
    expect((await upload('emp', reqId, PDF)).status).toBe(409);
    expect((await upload('admin', reqId, PDF, 'متأخر.pdf')).status).toBe(201);
  });
});
