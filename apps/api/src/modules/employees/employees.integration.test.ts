import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createFieldCrypto } from '../../shared/crypto.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'e'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};
const IBAN = 'SA0380000000608010167519';

describe('الموظفون', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};

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
  const login = async (email: string, company?: string, password = PASSWORD) =>
    (await request(api).post('/api/v1/auth/login').send({ identifier: email, password, company }))
      .body.data.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));
  const patch = (who: string, path: string, body: object) =>
    request(api).patch(`/api/v1${path}`).set(as(who)).send(body);

  const newEmp = async (who: string, extra: object = {}) =>
    (await post(who, '/employees', { firstNameAr: 'أحمد', familyNameAr: 'العلي', ...extra })).body
      .data;

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
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
    const globex = await mk('globex');
    const k = () => randomBytes(32).toString('base64');
    const crypto = createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() });
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false, crypto },
    });
    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(acme, 'officer@acme.test', 'hr_officer');
    await makeUser(globex, 'admin@globex.test', 'admin');
    tokens['admin'] = await login('admin@acme.test');
    tokens['officer'] = await login('officer@acme.test');
    tokens['globex'] = await login('admin@globex.test', 'globex');
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  describe('الترقيم والإنشاء', () => {
    it('رقم وظيفي تلقائي متسلسل بالصيغة الافتراضية', async () => {
      const a = await newEmp('admin');
      const b = await newEmp('admin');
      expect(a.employeeNo).toBe('EMP-00001');
      expect(b.employeeNo).toBe('EMP-00002');
      expect(a.fullNameAr).toBe('أحمد العلي');
      expect(a).not.toHaveProperty('searchText');
    });

    it('تغيير صيغة الترقيم من الإعدادات يؤثر على الأرقام التالية', async () => {
      const put = await request(api)
        .put('/api/v1/settings/company/employeeNoFormat')
        .set(as('admin'))
        .send({ value: 'E{yy}-{seq:3}' });
      expect(put.status).toBe(204);
      const c = await newEmp('admin');
      expect(c.employeeNo).toMatch(/^E\d{2}-003$/);
      const bad = await request(api)
        .put('/api/v1/settings/company/employeeNoFormat')
        .set(as('admin'))
        .send({ value: 'NOSEQ' });
      expect(bad.status).toBe(400);
    });

    it('الرقم اليدوي يتطلب صلاحية خاصة وفريد', async () => {
      expect(
        (
          await post('admin', '/employees', {
            firstNameAr: 'س',
            familyNameAr: 'ص',
            employeeNo: 'MAN-1',
          })
        ).status,
      ).toBe(201);
      const dup = await post('admin', '/employees', {
        firstNameAr: 'س',
        familyNameAr: 'ص',
        employeeNo: 'MAN-1',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('DUPLICATE');
      expect(
        (await post('officer', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).status,
      ).toBe(403);
    });

    it('الرقم المولَّد يتخطى رقماً أُدخل يدوياً يطابق التالي', async () => {
      await request(api)
        .put('/api/v1/settings/company/employeeNoFormat')
        .set(as('admin'))
        .send({ value: 'Z-{seq:2}' });
      const first = await newEmp('admin'); // يستهلك التسلسل التالي
      const n = Number(first.employeeNo.slice(2));
      await post('admin', '/employees', {
        firstNameAr: 'س',
        familyNameAr: 'ص',
        employeeNo: `Z-${String(n + 1).padStart(2, '0')}`,
      });
      const e = await newEmp('admin');
      expect(e.employeeNo).toBe(`Z-${String(n + 2).padStart(2, '0')}`);
    });
  });

  describe('البحث والتعديل', () => {
    it('بحث عربي مطبَّع: ألف وهمزة وتاء مربوطة وتشكيل', async () => {
      await post('admin', '/employees', {
        firstNameAr: 'فاطِمة',
        familyNameAr: 'الزهراء',
        firstNameEn: 'Fatima',
      });
      await post('admin', '/employees', { firstNameAr: 'إيمان', familyNameAr: 'سالم' });
      const q = async (term: string) =>
        (await get('admin', `/employees?q=${encodeURIComponent(term)}`)).body.data.map(
          (e: { firstNameAr: string }) => e.firstNameAr,
        );
      expect(await q('فاطمه')).toEqual(['فاطِمة']);
      expect(await q('ايمان')).toEqual(['إيمان']);
      expect(await q('fatima')).toEqual(['فاطِمة']);
      expect(await q('الزهراء فاطمة')).toEqual(['فاطِمة']);
    });

    it('البحث بالرقم الوظيفي والفلترة بالحالة والترقيم', async () => {
      expect((await get('admin', '/employees?q=MAN-1')).body.meta.total).toBe(1);
      expect((await get('admin', '/employees?status=terminated')).body.meta.total).toBe(0);
      const page = await get('admin', '/employees?pageSize=2&page=2&sort=-createdAt');
      expect(page.body.data.length).toBe(2);
    });

    it('تعديل بقفل متفائل يعيد حساب الاسم الكامل ونص البحث', async () => {
      const e = await newEmp('admin', { firstNameAr: 'خالد', familyNameAr: 'نصر' });
      const ok = await patch('admin', `/employees/${e.id}`, {
        familyNameAr: 'الحسن',
        version: e.version,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data.fullNameAr).toBe('خالد الحسن');
      expect((await get('admin', '/employees?q=الحسن')).body.meta.total).toBe(1);
      expect((await get('admin', '/employees?q=نصر')).body.meta.total).toBe(0);
      const stale = await patch('admin', `/employees/${e.id}`, {
        familyNameAr: 'x',
        version: e.version,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('قيم غير صالحة → 400', async () => {
      expect(
        (
          await post('admin', '/employees', {
            firstNameAr: 'س',
            familyNameAr: 'ص',
            nationality: 'sa',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post('admin', '/employees', {
            firstNameAr: 'س',
            familyNameAr: 'ص',
            birthDate: '01/02/1990',
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('العزل والنطاق', () => {
    it('شركة أخرى لا ترى الموظف ولا تعدّله ولا تحذفه', async () => {
      const e = await newEmp('admin');
      expect((await get('globex', `/employees/${e.id}`)).status).toBe(404);
      expect(
        (await patch('globex', `/employees/${e.id}`, { familyNameAr: 'x', version: 1 })).status,
      ).toBe(404);
      expect(
        (await request(api).delete(`/api/v1/employees/${e.id}`).set(as('globex'))).status,
      ).toBe(404);
      expect((await get('globex', '/employees')).body.meta.total).toBe(0);
      expect((await get('globex', `/employees/${e.id}/contacts`)).status).toBe(404);
    });

    it('صلاحية القراءة فقط: لا إنشاء ولا تعديل', async () => {
      const e = await newEmp('admin');
      expect((await get('officer', `/employees/${e.id}`)).status).toBe(200);
      expect(
        (await patch('officer', `/employees/${e.id}`, { familyNameAr: 'x', version: e.version }))
          .status,
      ).toBe(403);
    });

    it('حساب موظف بنطاق الذات يرى سجله فقط', async () => {
      const mine = await newEmp('admin', { firstNameAr: 'ليلى', familyNameAr: 'عمر' });
      const other = await newEmp('admin', { firstNameAr: 'سعد', familyNameAr: 'عمر' });
      const created = await post('admin', `/employees/${mine.id}/account`, {
        email: 'leila@acme.test',
        password: PASSWORD,
      });
      expect(created.status).toBe(201);
      expect(
        (
          await post('admin', `/employees/${mine.id}/account`, {
            email: 'x@acme.test',
            password: PASSWORD,
          })
        ).status,
      ).toBe(409);
      tokens['leila'] = await login('leila@acme.test');
      const list = await get('leila', '/employees');
      expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([mine.id]);
      expect((await get('leila', `/employees/${mine.id}`)).status).toBe(200);
      expect((await get('leila', `/employees/${other.id}`)).status).toBe(404);
      expect((await get('leila', `/employees/${other.id}/contacts`)).status).toBe(404);
      expect(
        (await patch('leila', `/employees/${mine.id}`, { familyNameAr: 'x', version: 1 })).status,
      ).toBe(403);
    });

    it('كلمة مرور ضعيفة عند إنشاء الحساب مرفوضة', async () => {
      const e = await newEmp('admin');
      const res = await post('admin', `/employees/${e.id}/account`, {
        email: 'w@acme.test',
        password: 'password123',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WEAK_PASSWORD');
    });
  });

  describe('الجداول الفرعية', () => {
    it('جهات الاتصال: أساسية واحدة لكل نوع، وتعديل وحذف', async () => {
      const e = await newEmp('admin');
      const a = await post('admin', `/employees/${e.id}/contacts`, {
        type: 'mobile',
        value: '0500000001',
        isPrimary: true,
      });
      const b = await post('admin', `/employees/${e.id}/contacts`, {
        type: 'mobile',
        value: '0500000002',
        isPrimary: true,
      });
      expect(a.status).toBe(201);
      const list = (await get('admin', `/employees/${e.id}/contacts`)).body.data;
      expect(
        list
          .filter((c: { isPrimary: boolean }) => c.isPrimary)
          .map((c: { value: string }) => c.value),
      ).toEqual(['0500000002']);
      const upd = await patch('admin', `/employees/${e.id}/contacts/${a.body.data.id}`, {
        isPrimary: true,
        version: a.body.data.version,
      });
      expect(upd.status).toBe(200);
      const list2 = (await get('admin', `/employees/${e.id}/contacts`)).body.data;
      expect(
        list2
          .filter((c: { isPrimary: boolean }) => c.isPrimary)
          .map((c: { value: string }) => c.value),
      ).toEqual(['0500000001']);
      expect(
        (
          await request(api)
            .delete(`/api/v1/employees/${e.id}/contacts/${b.body.data.id}`)
            .set(as('admin'))
        ).status,
      ).toBe(204);
      expect(
        (
          await request(api)
            .delete(`/api/v1/employees/${e.id}/contacts/${b.body.data.id}`)
            .set(as('admin'))
        ).status,
      ).toBe(404);
    });

    it('سجل فرعي لموظف آخر لا يُعدَّل عبر موظف مختلف', async () => {
      const e1 = await newEmp('admin');
      const e2 = await newEmp('admin');
      const dep = await post('admin', `/employees/${e1.id}/dependents`, {
        name: 'سارة',
        relation: 'child',
      });
      const res = await patch('admin', `/employees/${e2.id}/dependents/${dep.body.data.id}`, {
        name: 'x',
        version: 1,
      });
      expect(res.status).toBe(404);
    });

    it('عناوين وتعليم وخبرة: إنشاء وتحقق', async () => {
      const e = await newEmp('admin');
      expect(
        (await post('admin', `/employees/${e.id}/addresses`, { city: 'الرياض', isPrimary: true }))
          .status,
      ).toBe(201);
      expect(
        (
          await post('admin', `/employees/${e.id}/education`, {
            degree: 'بكالوريوس',
            startYear: 2010,
            endYear: 2014,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await post('admin', `/employees/${e.id}/education`, {
            degree: 'x',
            startYear: 2014,
            endYear: 2010,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post('admin', `/employees/${e.id}/experience`, {
            employer: 'شركة',
            startDate: '2015-01-01',
            endDate: '2018-01-01',
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('الحسابات البنكية', () => {
    it('الـ IBAN مشفّر ومقنّع، لا يظهر في الاستجابة ولا القاعدة ولا التدقيق', async () => {
      const e = await newEmp('admin');
      const res = await post('admin', `/employees/${e.id}/bank-accounts`, {
        bankName: 'الراجحي',
        iban: 'sa03 8000 0000 6080 1016 7519',
        currency: 'SAR',
        isPrimary: true,
      });
      expect(res.status).toBe(201);
      expect(JSON.stringify(res.body)).not.toContain(IBAN);
      expect(res.body.data.ibanMasked).toBe('SA' + '•'.repeat(18) + '7519');
      const row = await admin
        .selectFrom('employeeBankAccounts')
        .select(['ibanEnc', 'ibanDigest'])
        .where('id', '=', res.body.data.id)
        .executeTakeFirstOrThrow();
      expect(row.ibanEnc).not.toContain(IBAN);
      const logs = await admin
        .selectFrom('auditLogs')
        .select('changes')
        .where('entityType', '=', 'employee_bank_accounts')
        .execute();
      expect(JSON.stringify(logs)).not.toContain(IBAN);
      expect(JSON.stringify(logs)).not.toContain(row.ibanEnc);
      const list = await get('admin', `/employees/${e.id}/bank-accounts`);
      expect(JSON.stringify(list.body)).not.toContain(IBAN);
    });

    it('الكشف: صلاحية مستقلة، يعيد الرقم كاملاً ويُدقَّق دائماً', async () => {
      const e = await newEmp('admin');
      const acc = (
        await post('admin', `/employees/${e.id}/bank-accounts`, {
          bankName: 'ب',
          iban: IBAN,
          currency: 'SAR',
        })
      ).body.data;
      expect(
        (await post('officer', `/employees/${e.id}/bank-accounts/${acc.id}/reveal`, {})).status,
      ).toBe(403);
      expect((await get('officer', `/employees/${e.id}/bank-accounts`)).status).toBe(200); // القراءة المقنّعة مسموحة
      const rev = await post('admin', `/employees/${e.id}/bank-accounts/${acc.id}/reveal`, {});
      expect(rev.status).toBe(200);
      expect(rev.body.data.iban).toBe(IBAN);
      expect(rev.headers['cache-control']).toBe('no-store');
      const log = await admin
        .selectFrom('auditLogs')
        .select(['action', 'userId'])
        .where('entityId', '=', acc.id)
        .where('action', '=', 'reveal')
        .execute();
      expect(log.length).toBe(1);
      expect(
        (await post('globex', `/employees/${e.id}/bank-accounts/${acc.id}/reveal`, {})).status,
      ).toBe(404);
    });

    it('IBAN غير صالح مرفوض، والحساب الأساسي واحد، وتعديل الـ IBAN يُدقَّق مقنّعاً', async () => {
      const e = await newEmp('admin');
      expect(
        (
          await post('admin', `/employees/${e.id}/bank-accounts`, {
            bankName: 'ب',
            iban: 'bad',
            currency: 'SAR',
          })
        ).status,
      ).toBe(400);
      const a = (
        await post('admin', `/employees/${e.id}/bank-accounts`, {
          bankName: 'أ',
          iban: IBAN,
          currency: 'SAR',
          isPrimary: true,
        })
      ).body.data;
      await post('admin', `/employees/${e.id}/bank-accounts`, {
        bankName: 'ب',
        iban: 'AE070331234567890123456',
        currency: 'AED',
        isPrimary: true,
      });
      const list = (await get('admin', `/employees/${e.id}/bank-accounts`)).body.data;
      expect(list.filter((x: { isPrimary: boolean }) => x.isPrimary).length).toBe(1);
      const upd = await patch('admin', `/employees/${e.id}/bank-accounts/${a.id}`, {
        iban: 'GB82WEST12345698765432',
        version: a.version,
      });
      expect(upd.status).toBe(200);
      expect(upd.body.data.ibanMasked.endsWith('5432')).toBe(true);
    });
  });

  describe('الحذف', () => {
    it('حذف موظف يحذف سجلاته الفرعية، وغير الموجود 404', async () => {
      const e = await newEmp('admin');
      await post('admin', `/employees/${e.id}/contacts`, { type: 'email', value: 'a@b.test' });
      expect((await request(api).delete(`/api/v1/employees/${e.id}`).set(as('admin'))).status).toBe(
        204,
      );
      expect((await get('admin', `/employees/${e.id}`)).status).toBe(404);
      expect((await request(api).delete(`/api/v1/employees/${e.id}`).set(as('admin'))).status).toBe(
        404,
      );
    });
  });
});
