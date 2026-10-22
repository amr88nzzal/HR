import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { randomBytes } from 'node:crypto';
import { createFieldCrypto } from '../../shared/crypto.js';
import { createLocalStorage } from '../../shared/storage.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('مستندات الرواتب: ملف البنك وكشف الإدارة وقيد المحاسبة', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const rendered: string[] = [];
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const patch = (who: string, p: string, body: object) =>
    request(api).patch(`/api/v1${p}`).set(as(who)).send(body);

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
          displayName: `مستخدم ${roleCode}`,
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

  const ids: Record<string, string> = {};
  let a: string;

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'شركة أكمي' })
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
        crypto,
        cookieSecure: false,
        rateLimit: false,
        publicUrl: 'https://hr.example.com',
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-payslip-'))),
        render: async (html: string) => {
          rendered.push(html);
          return Buffer.from('%PDF-1.4 fake payslip');
        },
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    await makeUser('emp@acme.test', 'employee');
    await makeUser('other@acme.test', 'employee');
    for (const who of ['admin', 'hr', 'emp', 'other'])
      tokens[who] = await login(`${who}@acme.test`);
    await post('admin', '/currencies', {
      code: 'SAR',
      nameAr: 'ريال',
      symbol: 'ر.س',
      isBase: true,
    });
    a = (
      await post('admin', '/employees', {
        firstNameAr: 'أحمد',
        familyNameAr: 'تجربة',
        firstHireDate: '2025-01-01',
      })
    ).body.data.id as string;
    const empUser = await admin
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'emp@acme.test')
      .executeTakeFirstOrThrow();
    await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx.updateTable('employees').set({ userId: empUser.id }).where('id', '=', a).execute(),
    );
    const comp = async (c: object) =>
      (await post('admin', '/payroll/components', c)).body.data.id as string;
    ids['housing'] = await comp({
      code: 'housing',
      nameAr: 'سكن',
      kind: 'earning',
      calcType: 'fixed',
      fixedAmount: '500',
    });
    ids['insurable'] = (
      await post('admin', '/payroll/bases', {
        code: 'insurable',
        nameAr: 'تأمينات',
        includesBasic: true,
        componentIds: [ids['housing']],
      })
    ).body.data.id;
    ids['social'] = await comp({
      code: 'social',
      nameAr: 'تأمينات',
      kind: 'deduction',
      calcType: 'percent',
      percent: '10',
      baseId: ids['insurable'],
    });
    const sal = await post('admin', `/employees/${a}/salaries`, {
      currency: 'SAR',
      basicAmount: '3000',
      validFrom: '2025-01-01',
      components: ['housing', 'social'].map((k) => ({ componentId: ids[k] })),
    });
    expect(sal.status).toBe(201);
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  let jan: string;
  const IBAN = 'SA0380000000608010167519';
  const bin = (r: request.Response) => (r.body as Buffer).toString('utf8');
  const binary = (who: string, p: string) =>
    request(api)
      .get(`/api/v1${p}`)
      .set(as(who))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it('تجهيز: موظفان (أحدهما بحساب بنكي) ودورة معتمدة', async () => {
    const b = (
      await post('admin', '/employees', {
        firstNameAr: 'سعد',
        familyNameAr: 'بلا حساب',
        firstHireDate: '2025-01-01',
      })
    ).body.data.id as string;
    expect(
      (
        await post('admin', `/employees/${b}/salaries`, {
          currency: 'SAR',
          basicAmount: '2000',
          validFrom: '2025-01-01',
          components: [],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post('admin', `/employees/${a}/bank-accounts`, {
          bankName: 'الراجحي',
          iban: IBAN,
          currency: 'SAR',
          isPrimary: true,
        })
      ).status,
    ).toBe(201);
    jan = (await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' })).body
      .data.id as string;
    expect((await post('admin', `/payroll/periods/${jan}/calculate`)).status).toBe(200);
  });

  it('المسودة: ملف البنك والقيد مرفوضان، وكشف الإدارة يحمل وسم المسودة', async () => {
    expect((await get('admin', `/payroll/periods/${jan}/bank-transfer`)).status).toBe(409);
    expect((await get('admin', `/payroll/periods/${jan}/journal`)).status).toBe(409);
    expect((await get('admin', `/payroll/periods/${jan}/management-sheet`)).status).toBe(200);
    expect(rendered.at(-1)).toContain('مسودة');
    expect((await post('admin', `/payroll/periods/${jan}/approve`)).status).toBe(200);
  });

  it('كشف الإدارة: PDF بأسطر توقيع ومجاميع، وExcel', async () => {
    const r = await get('admin', `/payroll/periods/${jan}/management-sheet`);
    expect(r.status).toBe(200);
    const html = rendered.at(-1)!;
    expect(html).not.toContain('مسودة — غير معتمدة');
    expect(html).toContain('أعدّه');
    expect(html).toContain('اعتمده');
    expect(html).toContain('المجموع الكلي');
    expect(html).toContain('أحمد');
    const x = await binary('admin', `/payroll/periods/${jan}/management-sheet?format=xlsx`);
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await get('emp', `/payroll/periods/${jan}/management-sheet`)).status).toBe(403);
  });

  it('ملف البنك: IBAN كامل لمن عنده حساب فقط، صلاحية خاصة، ويُسجَّل في التدقيق', async () => {
    expect((await get('hr', `/payroll/periods/${jan}/bank-transfer`)).status).toBe(403);
    const r = await binary('admin', `/payroll/periods/${jan}/bank-transfer?format=csv`);
    expect(r.status).toBe(200);
    expect(r.headers['x-rows']).toBe('1');
    expect(r.headers['x-skipped-no-iban']).toBe('1');
    const text = bin(r);
    expect(text).toContain(IBAN);
    expect(text).toContain('PAY-2026-01-');
    expect(text).not.toContain('بلا حساب');
    const xl = await binary('admin', `/payroll/periods/${jan}/bank-transfer`);
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const audit = await admin
      .selectFrom('auditLogs')
      .select('changes')
      .where('action', '=', 'export_bank_file')
      .where('entityId', '=', jan)
      .execute();
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit[0]!.changes)).not.toContain(IBAN);
  });

  it('حسابات المحاسبة: ربط البنود وضبط حسابات الشركة (بصلاحية manage)', async () => {
    expect((await get('hr', '/payroll/gl-settings')).status).toBe(403);
    const empty = await get('admin', '/payroll/gl-settings');
    expect(empty.body.data.salariesPayable).toBeNull();
    const bad = await put('admin', '/payroll/gl-settings', { salariesPayable: '<script>' });
    expect(bad.status).toBe(400);
    const ok = await put('admin', '/payroll/gl-settings', {
      salariesPayable: '2200',
      loansReceivable: '1300',
      defaultExpense: '5000',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await get('admin', '/payroll/gl-settings')).body.data.salariesPayable).toBe('2200');
    for (const [code, gl] of [
      ['housing', '5100'],
      ['social', '2100'],
    ] as const) {
      const cur = (await get('admin', '/payroll/components')).body.data.find(
        (c: { code: string }) => c.code === code,
      );
      const r = await patch('admin', `/payroll/components/${cur.id}`, {
        version: cur.version,
        glAccount: gl,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.glAccount).toBe(gl);
    }
  });

  it('قيد المحاسبة: متوازن، مربوط بالحسابات، ويُبلَّغ عن غير المربوط', async () => {
    const r = await binary('admin', `/payroll/periods/${jan}/journal?format=csv`);
    expect(r.status, bin(r)).toBe(200);
    expect(r.headers['x-balanced']).toBe('true');
    expect(r.headers['x-unmapped']).toBe('0');
    expect(Number(r.headers['x-debit-total'])).toBeGreaterThan(0);
    expect(r.headers['x-debit-total']).toBe(r.headers['x-credit-total']);
    const text = bin(r);
    for (const acc of ['5100', '2100', '2200', '5000']) expect(text).toContain(acc);
    expect(text).toContain('PAYROLL-2026-01');
    // إلغاء حساب الشركة الافتراضي يُظهر UNMAPPED دون كسر التوازن
    await put('admin', '/payroll/gl-settings', {
      salariesPayable: '2200',
      loansReceivable: '1300',
    });
    const chk = await get('admin', `/payroll/periods/${jan}/journal?format=check`);
    expect(chk.body.data.balanced).toBe(true);
    expect(chk.body.data.unmapped.length).toBeGreaterThan(0);
    const bchk = await get('admin', `/payroll/periods/${jan}/bank-transfer?format=check`);
    expect(bchk.body.data.rows).toBe(1);
    expect(bchk.body.data.missing).toHaveLength(1);
    expect(JSON.stringify(bchk.body)).not.toContain(IBAN);
    const r2 = await binary('admin', `/payroll/periods/${jan}/journal?format=csv`);
    expect(r2.headers['x-unmapped']).not.toBe('0');
    expect(r2.headers['x-balanced']).toBe('true');
    expect(bin(r2)).toContain('UNMAPPED');
    expect((await get('hr', `/payroll/periods/${jan}/journal`)).status).toBe(403);
  });
});
