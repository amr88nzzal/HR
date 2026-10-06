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
import { seedDefaultExternalSystems } from './external.routes.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'm'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('المراجع الخارجية والحقول المخصصة', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

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
      return user.id;
    });
  const login = async (email: string, company?: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company })
    ).body.data.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const patch = (who: string, path: string, body: object) =>
    request(api).patch(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));
  const newEmp = async (name: string, extra: object = {}) =>
    (await post('admin', '/employees', { firstNameAr: name, familyNameAr: 'تجربة', ...extra })).body
      .data.id as string;

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
      await withTenant(admin, { companyId: row.id }, async (ctx) => {
        await seedDefaultRoles(ctx);
        await seedDefaultExternalSystems(ctx);
      });
      return row.id;
    };
    acme = await mk('acme');
    const globex = await mk('globex');
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
    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(acme, 'officer@acme.test', 'hr_officer');
    await makeUser(globex, 'admin@globex.test', 'admin');
    tokens['admin'] = await login('admin@acme.test');
    tokens['officer'] = await login('officer@acme.test');
    tokens['globex'] = await login('admin@globex.test', 'globex');

    ids['ruh'] = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    ids['jed'] = (await post('admin', '/branches', { code: 'JED', nameAr: 'جدة' })).body.data.id;
    const systems = (await get('admin', '/external-systems')).body.data as {
      id: string;
      key: string;
    }[];
    for (const s of systems) ids[s.key] = s.id;
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  describe('الأنظمة الخارجية', () => {
    it('تُبذر النظامان الافتراضيان ولا يُحذفان', async () => {
      expect(ids['accounting']).toBeTruthy();
      expect(ids['attendance_device']).toBeTruthy();
      const del = await request(api)
        .delete(`/api/v1/external-systems/${ids['accounting']}`)
        .set(as('admin'));
      expect(del.status).toBe(409);
      expect(del.body.error.code).toBe('SYSTEM_RECORD');
    });

    it('إنشاء نظام جديد وتعديله وحذفه، والمفتاح فريد', async () => {
      const c = await post('admin', '/external-systems', {
        key: 'payroll_bank',
        nameAr: 'رقم البنك',
      });
      expect(c.status).toBe(201);
      expect(c.body.data.refScope).toBe('company');
      expect(
        (await post('admin', '/external-systems', { key: 'payroll_bank', nameAr: 'x' })).status,
      ).toBe(409);
      const u = await patch('admin', `/external-systems/${c.body.data.id}`, {
        version: 1,
        nameAr: 'رقم حساب البنك',
      });
      expect(u.status).toBe(200);
      expect(u.body.data.version).toBe(2);
      const stale = await patch('admin', `/external-systems/${c.body.data.id}`, {
        version: 1,
        nameAr: 'قديم',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      const del = await request(api)
        .delete(`/api/v1/external-systems/${c.body.data.id}`)
        .set(as('admin'));
      expect(del.status).toBe(204);
    });

    it('تعبير نمطي غير صالح مرفوض، والموظف العادي لا يملك الإدارة', async () => {
      expect(
        (
          await post('admin', '/external-systems', {
            key: 'bad_rx',
            nameAr: 'x',
            validationRegex: '(',
          })
        ).status,
      ).toBe(400);
      expect((await post('officer', '/external-systems', { key: 'zzz', nameAr: 'x' })).status).toBe(
        403,
      );
      expect((await get('officer', '/external-systems')).status).toBe(200);
    });

    it('الشركات معزولة', async () => {
      const mine = (await get('globex', '/external-systems')).body.data as { id: string }[];
      expect(mine.some((s) => s.id === ids['accounting'])).toBe(false);
    });
  });

  describe('مراجع الموظف', () => {
    let emp: string;
    let other: string;

    it('تُطبَّع الأرقام العربية وتُحفظ الأصفار البادئة', async () => {
      emp = await newEmp('أحمد');
      other = await newEmp('بسام');
      const r = await post('admin', `/employees/${emp}/external-refs`, {
        systemId: ids['accounting'],
        value: ' ٠٠١٢٣ ',
      });
      expect(r.status).toBe(201);
      expect(r.body.data.value).toBe('00123');
      expect(r.body.data.isPrimary).toBe(true);
      expect(r.body.data.enforceUnique).toBe(true);
    });

    it('نظام الشركة يمنع تكرار القيمة بين موظفين ويقبلها بعد انتهاء الصلاحية', async () => {
      const dup = await post('admin', `/employees/${other}/external-refs`, {
        systemId: ids['accounting'],
        value: '00123',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('REF_DUPLICATE');
      // نفس القيمة بعد إغلاق فترة الأول
      const first = (await get('admin', `/employees/${emp}/external-refs`)).body.data[0];
      await patch('admin', `/employees/${emp}/external-refs/${first.id}`, {
        version: first.version,
        validTo: '2024-12-31',
      });
      const later = await post('admin', `/employees/${other}/external-refs`, {
        systemId: ids['accounting'],
        value: '00123',
        validFrom: '2025-01-01',
      });
      expect(later.status).toBe(201);
    });

    it('نظام الفرع يتطلب الفرع ويسمح بتكرار الكود بين فرعين', async () => {
      const a = await newEmp('جميل');
      const b = await newEmp('خالد');
      const noBranch = await post('admin', `/employees/${a}/external-refs`, {
        systemId: ids['attendance_device'],
        value: '7',
      });
      expect(noBranch.status).toBe(400);
      const ra = await post('admin', `/employees/${a}/external-refs`, {
        systemId: ids['attendance_device'],
        value: '7',
        branchId: ids['ruh'],
      });
      const rb = await post('admin', `/employees/${b}/external-refs`, {
        systemId: ids['attendance_device'],
        value: '7',
        branchId: ids['jed'],
      });
      expect(ra.status).toBe(201);
      expect(rb.status).toBe(201);
      const clash = await post('admin', `/employees/${b}/external-refs`, {
        systemId: ids['attendance_device'],
        value: '7',
        branchId: ids['ruh'],
      });
      expect(clash.status).toBe(409);
      // نظام الشركة لا يقبل فرعاً
      expect(
        (
          await post('admin', `/employees/${a}/external-refs`, {
            systemId: ids['accounting'],
            value: '555',
            branchId: ids['ruh'],
          })
        ).status,
      ).toBe(400);
    });

    it('المرجع الأساسي الجديد يُنزل السابق تلقائياً، وغير الفريد يقبل التكرار', async () => {
      const e = await newEmp('داود');
      const sys = (
        await post('admin', '/external-systems', {
          key: 'badge',
          nameAr: 'بطاقة',
          isUnique: false,
        })
      ).body.data.id;
      await post('admin', `/employees/${e}/external-refs`, { systemId: sys, value: 'A1' });
      await post('admin', `/employees/${e}/external-refs`, { systemId: sys, value: 'A2' });
      const rows = (await get('admin', `/employees/${e}/external-refs`)).body.data as {
        value: string;
        isPrimary: boolean;
      }[];
      expect(rows.find((r) => r.value === 'A1')?.isPrimary).toBe(false);
      expect(rows.find((r) => r.value === 'A2')?.isPrimary).toBe(true);
      const e2 = await newEmp('هاني');
      expect(
        (await post('admin', `/employees/${e2}/external-refs`, { systemId: sys, value: 'A2' }))
          .status,
      ).toBe(201);
      // جعل النظام فريداً مع وجود تكرار يُرفض
      const cur = (await get('admin', '/external-systems')).body.data.find(
        (s: { id: string }) => s.id === sys,
      );
      const make = await patch('admin', `/external-systems/${sys}`, {
        version: cur.version,
        isUnique: true,
      });
      expect(make.status).toBe(409);
      expect(make.body.error.code).toBe('REF_DUPLICATE');
    });

    it('صيغة التحقق من النظام تُفرض', async () => {
      const sys = (
        await post('admin', '/external-systems', {
          key: 'digits_only',
          nameAr: 'أرقام',
          validationRegex: '^\\d{4}$',
        })
      ).body.data.id;
      const e = await newEmp('وليد');
      expect(
        (await post('admin', `/employees/${e}/external-refs`, { systemId: sys, value: 'abcd' }))
          .status,
      ).toBe(400);
      expect(
        (await post('admin', `/employees/${e}/external-refs`, { systemId: sys, value: '١٢٣٤' }))
          .body.data.value,
      ).toBe('1234');
    });

    it('البحث في قائمة الموظفين يشمل المراجع الخارجية', async () => {
      const e = await newEmp('يوسف');
      await post('admin', `/employees/${e}/external-refs`, {
        systemId: ids['accounting'],
        value: 'AC-9981',
      });
      const res = await get('admin', '/employees?q=ac-99');
      expect(res.status).toBe(200);
      expect((res.body.data as { id: string }[]).map((r) => r.id)).toEqual([e]);
      const arabicDigits = await get('admin', `/employees?q=${encodeURIComponent('AC-٩٩٨١')}`);
      expect(arabicDigits.body.data).toHaveLength(1);
    });

    it('resolve يحدد الموظف حسب التاريخ والفرع ويرجع 404 والتباس', async () => {
      const hit = await get('admin', '/external-refs/resolve?system=accounting&value=AC-9981');
      expect(hit.status).toBe(200);
      expect(hit.body.data.employeeNo).toBeTruthy();
      // فترة منتهية: القيمة 00123 كانت للأول حتى 2024 وللثاني من 2025
      const old = await get(
        'admin',
        '/external-refs/resolve?system=accounting&value=00123&date=2024-06-01',
      );
      const now = await get(
        'admin',
        '/external-refs/resolve?system=accounting&value=00123&date=2025-06-01',
      );
      expect(old.body.data.employeeId).toBe(emp);
      expect(now.body.data.employeeId).toBe(other);
      expect(
        (await get('admin', '/external-refs/resolve?system=accounting&value=nope')).status,
      ).toBe(404);
      expect(
        (await get('admin', '/external-refs/resolve?system=attendance_device&value=7')).status,
      ).toBe(400);
      const byBranch = await get(
        'admin',
        `/external-refs/resolve?system=attendance_device&value=7&branchId=${ids['jed']}`,
      );
      expect(byBranch.status).toBe(200);
      // الالتباس: نظام غير فريد
      const sys = (
        await post('admin', '/external-systems', { key: 'dupe', nameAr: 'مكرر', isUnique: false })
      ).body.data.id;
      const p1 = await newEmp('ن1');
      const p2 = await newEmp('ن2');
      await post('admin', `/employees/${p1}/external-refs`, { systemId: sys, value: 'Z' });
      await post('admin', `/employees/${p2}/external-refs`, { systemId: sys, value: 'Z' });
      const amb = await get('admin', '/external-refs/resolve?system=dupe&value=Z');
      expect(amb.status).toBe(409);
      expect(amb.body.error.code).toBe('AMBIGUOUS');
    });

    it('الحذف والعزل بين الشركات', async () => {
      const e = await newEmp('رامي');
      const r = await post('admin', `/employees/${e}/external-refs`, {
        systemId: ids['accounting'],
        value: 'DEL-1',
      });
      expect((await get('globex', `/employees/${e}/external-refs`)).status).toBe(404);
      const del = await request(api)
        .delete(`/api/v1/employees/${e}/external-refs/${r.body.data.id}`)
        .set(as('admin'));
      expect(del.status).toBe(204);
      expect((await get('admin', `/employees/${e}/external-refs`)).body.data).toHaveLength(0);
    });
  });

  describe('الحقول المخصصة', () => {
    it('تعريف الحقول والتحقق من الأنواع والإلزامي والقوائم', async () => {
      const text = await post('admin', '/custom-field-definitions', {
        key: 'bloodNote',
        labelAr: 'ملاحظة',
        fieldType: 'text',
      });
      expect(text.status).toBe(201);
      const sel = await post('admin', '/custom-field-definitions', {
        key: 'shirtSize',
        labelAr: 'مقاس القميص',
        fieldType: 'select',
        options: [
          { value: 'S', labelAr: 'صغير' },
          { value: 'L', labelAr: 'كبير' },
        ],
      });
      expect(sel.status).toBe(201);
      await post('admin', '/custom-field-definitions', {
        key: 'carPlate',
        labelAr: 'رقم السيارة',
        fieldType: 'number',
      });
      // قائمة بلا خيارات مرفوضة
      expect(
        (
          await post('admin', '/custom-field-definitions', {
            key: 'noOpt',
            labelAr: 'x',
            fieldType: 'select',
          })
        ).status,
      ).toBe(400);
      // مفتاح مكرر
      expect(
        (
          await post('admin', '/custom-field-definitions', {
            key: 'shirtSize',
            labelAr: 'x',
            fieldType: 'text',
          })
        ).status,
      ).toBe(409);

      const ok = await post('admin', '/employees', {
        firstNameAr: 'سامر',
        familyNameAr: 'ح',
        customFields: { shirtSize: 'L', carPlate: '1234', bloodNote: 'لا شيء' },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.customFields).toEqual({
        shirtSize: 'L',
        carPlate: 1234,
        bloodNote: 'لا شيء',
      });

      const badSel = await post('admin', '/employees', {
        firstNameAr: 'x',
        familyNameAr: 'y',
        customFields: { shirtSize: 'XL' },
      });
      expect(badSel.status).toBe(400);
      expect(badSel.body.error.code).toBe('CUSTOM_FIELD_INVALID');
      expect(
        (
          await post('admin', '/employees', {
            firstNameAr: 'x',
            familyNameAr: 'y',
            customFields: { unknown: 1 },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post('admin', '/employees', {
            firstNameAr: 'x',
            familyNameAr: 'y',
            customFields: { carPlate: 'abc' },
          })
        ).status,
      ).toBe(400);
    });

    it('التحديث دمج: يمسح بـ null ويحافظ على غير المذكور', async () => {
      const e = await post('admin', '/employees', {
        firstNameAr: 'تامر',
        familyNameAr: 'ك',
        customFields: { shirtSize: 'S', carPlate: 5 },
      });
      const u = await patch('admin', `/employees/${e.body.data.id}`, {
        version: e.body.data.version,
        customFields: { carPlate: null },
      });
      expect(u.status).toBe(200);
      expect(u.body.data.customFields).toEqual({ shirtSize: 'S' });
    });

    it('الحقل الإلزامي يُفرض عند الإنشاء ويمنع تعطيل البيانات عند الحذف', async () => {
      const def = await post('admin', '/custom-field-definitions', {
        key: 'emergencyNote',
        labelAr: 'ملاحظة طوارئ',
        fieldType: 'text',
        isRequired: true,
      });
      const miss = await post('admin', '/employees', { firstNameAr: 'x', familyNameAr: 'y' });
      expect(miss.status).toBe(400);
      expect(miss.body.error.details.field).toBe('emergencyNote');
      const ok = await post('admin', '/employees', {
        firstNameAr: 'x',
        familyNameAr: 'y',
        customFields: { emergencyNote: 'نعم' },
      });
      expect(ok.status).toBe(201);
      const del = await request(api)
        .delete(`/api/v1/custom-field-definitions/${def.body.data.id}`)
        .set(as('admin'));
      expect(del.status).toBe(409);
      // التعطيل يسمح بإنشاء موظفين بلا هذا الحقل
      const off = await patch('admin', `/custom-field-definitions/${def.body.data.id}`, {
        version: def.body.data.version,
        isActive: false,
      });
      expect(off.status).toBe(200);
      expect(
        (await post('admin', '/employees', { firstNameAr: 'z', familyNameAr: 'y' })).status,
      ).toBe(201);
    });

    it('الحقل الحساس يُشفَّر ويُقنَّع ولا يُكشف إلا بصلاحية ويُدقَّق', async () => {
      await post('admin', '/custom-field-definitions', {
        key: 'medicalCardNo',
        labelAr: 'رقم البطاقة الطبية',
        fieldType: 'text',
        isSensitive: true,
      });
      const e = await post('admin', '/employees', {
        firstNameAr: 'حسام',
        familyNameAr: 'ر',
        customFields: { medicalCardNo: 'MED-778899' },
      });
      expect(e.status).toBe(201);
      expect(e.body.data.customFields.medicalCardNo).toBe('••••••');
      const id = e.body.data.id as string;
      // في قاعدة البيانات مشفّر
      const raw = await admin
        .selectFrom('employees')
        .select('customFields')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(raw.customFields)).not.toContain('MED-778899');
      // القوائم أيضاً مقنّعة
      const list = await get('admin', `/employees?q=${encodeURIComponent('حسام')}`);
      expect(list.body.data[0].customFields.medicalCardNo).toBe('••••••');
      // إعادة إرسال القناع تُبقي القيمة
      const keep = await patch('admin', `/employees/${id}`, {
        version: e.body.data.version,
        customFields: { medicalCardNo: '••••••' },
      });
      expect(keep.status).toBe(200);
      // الكشف
      const reveal = await post('admin', `/employees/${id}/reveal`, { key: 'medicalCardNo' });
      expect(reveal.status).toBe(200);
      expect(reveal.body.data.value).toBe('MED-778899');
      expect(reveal.headers['cache-control']).toContain('no-store');
      // مدقَّق
      const logs = await admin
        .selectFrom('auditLogs')
        .select(['action', 'changes'])
        .where('entityId', '=', id)
        .where('action', '=', 'reveal')
        .execute();
      expect(logs).toHaveLength(1);
      expect(JSON.stringify(logs[0]?.changes)).not.toContain('MED-778899');
      // بلا صلاحية
      expect(
        (await post('officer', `/employees/${id}/reveal`, { key: 'medicalCardNo' })).status,
      ).toBe(403);
      // حقل غير حساس/غير موجود
      expect((await post('admin', `/employees/${id}/reveal`, { key: 'shirtSize' })).status).toBe(
        404,
      );
    });

    it('لا يمكن تغيير حساسية حقل له قيم', async () => {
      const defs = (await get('admin', '/custom-field-definitions')).body.data as {
        id: string;
        key: string;
        version: number;
      }[];
      const d = defs.find((x) => x.key === 'medicalCardNo');
      const r = await patch('admin', `/custom-field-definitions/${d?.id}`, {
        version: d?.version,
        isSensitive: false,
      });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('IN_USE');
    });
  });
});
