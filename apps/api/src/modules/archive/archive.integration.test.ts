import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createFieldCrypto } from '../../shared/crypto.js';
import { createLocalStorage } from '../../shared/storage.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'm'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

describe('الأرشيف والملفات', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  let storageDir: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const makeUser = (
    companyId: string,
    email: string,
    roleCode: string,
    scope: { type: 'company' | 'branch'; id?: string } = { type: 'company' },
  ) =>
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
          scopeType: scope.type,
          scopeId: scope.id ?? null,
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
  const post = (who: string, p: string, body: object) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const patch = (who: string, p: string, body: object) =>
    request(api).patch(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));
  const upload = (who: string, method: 'post' | 'put', p: string, body: Buffer) =>
    (method === 'post' ? request(api).post(`/api/v1${p}`) : request(api).put(`/api/v1${p}`))
      .set(as(who))
      .set('Content-Type', 'application/octet-stream')
      .send(body);
  const files = async () => {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(full);
      }
    };
    await walk(storageDir);
    return out;
  };
  const hire = async (name: string, branchId: string) => {
    const emp = (await post('admin', '/employees', { firstNameAr: name, familyNameAr: 'تجربة' }))
      .body.data.id as string;
    const r = await post('admin', `/employees/${emp}/changes`, {
      changeType: 'hire',
      effectiveDate: '2024-01-01',
      employment: { branchId, departmentId: ids['dept'], employmentType: 'full_time' },
    });
    expect(r.status).toBe(201);
    return emp;
  };

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'hrms-files-'));
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
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto,
        storage: createLocalStorage(storageDir),
      },
    });
    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(globex, 'admin@globex.test', 'admin');
    tokens['admin'] = await login('admin@acme.test');
    tokens['globex'] = await login('admin@globex.test', 'globex');

    ids['ruh'] = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    ids['jed'] = (await post('admin', '/branches', { code: 'JED', nameAr: 'جدة' })).body.data.id;
    ids['dept'] = (
      await post('admin', '/departments', {
        code: 'HR',
        nameAr: 'الموارد',
        branchIds: [ids['ruh'], ids['jed']],
      })
    ).body.data.id;
    await post('admin', '/currencies', { code: 'USD', nameAr: 'دولار', symbol: '$' });
    await makeUser(acme, 'jed@acme.test', 'hr_manager', { type: 'branch', id: ids['jed'] });
    tokens['jed'] = await login('jed@acme.test');
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
    await rm(storageDir, { recursive: true, force: true });
  });

  describe('أنواع الوثائق وحقولها', () => {
    it('إنشاء نوع وحقول وقراءته كاملاً، والمفتاح النظامي فريد ولا يُحذف', async () => {
      const t = await post('admin', '/document-types', {
        systemKey: 'national_id',
        nameAr: 'الهوية الوطنية',
        ownerType: 'employee',
      });
      expect(t.status).toBe(201);
      ids['idType'] = t.body.data.id;
      const dup = await post('admin', '/document-types', {
        systemKey: 'national_id',
        nameAr: 'مكرر',
        ownerType: 'employee',
      });
      expect(dup.status).toBe(409);
      const f = await post('admin', `/document-types/${ids['idType']}/fields`, {
        key: 'idNumber',
        labelAr: 'رقم الهوية',
        dataType: 'text',
        isRequired: true,
        isUnique: true,
        showInList: true,
      });
      expect(f.status).toBe(201);
      const full = await get('admin', `/document-types/${ids['idType']}`);
      expect(full.body.data.fields).toHaveLength(1);
      expect((await del('admin', `/document-types/${ids['idType']}`)).body.error.code).toBe(
        'SYSTEM_RECORD',
      );
    });

    it('تحقق تعريف الحقل: القائمة تحتاج خيارات، والحساس لا يكون فريداً، والمفتاح فريد', async () => {
      const base = { labelAr: 'x' };
      const path = `/document-types/${ids['idType']}/fields`;
      expect((await post('admin', path, { ...base, key: 'a1', dataType: 'select' })).status).toBe(
        400,
      );
      expect(
        (
          await post('admin', path, {
            ...base,
            key: 'a2',
            dataType: 'text',
            isSensitive: true,
            isUnique: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (await post('admin', path, { ...base, key: 'idNumber', dataType: 'text' })).status,
      ).toBe(409);
    });
  });

  describe('الوثائق', () => {
    let emp: string;
    let type: string;

    beforeAll(async () => {
      emp = await hire('سالم', ids['ruh'] as string);
      ids['emp'] = emp;
      type = (
        await post('admin', '/document-types', {
          nameAr: 'عقد إيجار سكن',
          ownerType: 'employee',
        })
      ).body.data.id;
      const fields = [
        { key: 'title', labelAr: 'العنوان', dataType: 'text', isRequired: true },
        { key: 'contractNo', labelAr: 'رقم العقد', dataType: 'text', isUnique: true },
        { key: 'rooms', labelAr: 'الغرف', dataType: 'number', options: { min: 1, max: 20 } },
        { key: 'issuedOn', labelAr: 'تاريخ الإصدار', dataType: 'date' },
        { key: 'rent', labelAr: 'الإيجار', dataType: 'amount' },
        { key: 'furnished', labelAr: 'مفروش', dataType: 'boolean' },
        {
          key: 'kind',
          labelAr: 'النوع',
          dataType: 'select',
          options: [
            { value: 'flat', labelAr: 'شقة' },
            { value: 'villa', labelAr: 'فيلا' },
          ],
        },
        { key: 'renewOn', labelAr: 'تاريخ التجديد', dataType: 'reminder_date' },
        { key: 'ownerPhone', labelAr: 'هاتف المالك', dataType: 'text', isSensitive: true },
        { key: 'scan', labelAr: 'صورة العقد', dataType: 'file' },
      ];
      for (const f of fields) {
        const r = await post('admin', `/document-types/${type}/fields`, f);
        expect(r.status).toBe(201);
      }
    });

    const mkDoc = (values: object) =>
      post('admin', '/documents', { documentTypeId: type, ownerId: emp, values });

    it('إنشاء وثيقة بكل أنواع الحقول وتطبيع المبلغ والقناع للحساس', async () => {
      const r = await mkDoc({
        title: ' عقد الرياض ',
        contractNo: 'C-1',
        rooms: '3',
        issuedOn: '2025-01-15',
        rent: { amount: '1500.5', currency: 'USD' },
        furnished: true,
        kind: 'flat',
        renewOn: '2026-01-01',
        ownerPhone: '0501234567',
      });
      expect(r.status).toBe(201);
      ids['doc'] = r.body.data.id;
      expect(r.body.data.values).toMatchObject({
        title: 'عقد الرياض',
        rooms: 3,
        rent: { amount: '1500.5000', currency: 'USD' },
        furnished: true,
        ownerPhone: '••••••',
      });
      expect(r.body.data.versionNo).toBe(1);
      const raw = await admin
        .selectFrom('documents')
        .select('values')
        .where('id', '=', ids['doc'] as string)
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(raw.values)).not.toContain('0501234567');
    });

    it('رفض: إلزامي ناقص، نوع خاطئ، عملة مجهولة، خيار خارج القائمة، حقل ملف، حقل مجهول، فريد مكرر', async () => {
      const bad = async (values: object, field: string) => {
        const r = await mkDoc(values);
        expect(r.status, JSON.stringify(values)).toBe(400);
        expect(r.body.error.code).toBe('DOCUMENT_FIELD_INVALID');
        expect(r.body.error.details.field).toBe(field);
      };
      await bad({}, 'title');
      await bad({ title: 't', rooms: 'abc' }, 'rooms');
      await bad({ title: 't', rooms: 99 }, 'rooms');
      await bad({ title: 't', issuedOn: '2025-02-30' }, 'issuedOn');
      await bad({ title: 't', rent: { amount: '10', currency: 'EUR' } }, 'rent');
      await bad({ title: 't', rent: { amount: '1.23456', currency: 'USD' } }, 'rent');
      await bad({ title: 't', kind: 'castle' }, 'kind');
      await bad({ title: 't', scan: 'x' }, 'scan');
      await bad({ title: 't', nope: 1 }, 'nope');
      await bad({ title: 't', contractNo: 'C-1' }, 'contractNo');
    });

    it('المالك مطلوب ويجب أن يكون موجوداً ضمن الشركة', async () => {
      expect(
        (await post('admin', '/documents', { documentTypeId: type, values: { title: 'x' } }))
          .status,
      ).toBe(400);
      const other = await post('globex', '/employees', { firstNameAr: 'غريب', familyNameAr: 'ج' });
      const r = await post('admin', '/documents', {
        documentTypeId: type,
        ownerId: other.body.data.id,
        values: { title: 'x' },
      });
      expect(r.status).toBe(404);
    });

    it('قراءة الوثيقة وتعديلها بقفل متفائل، والفريد لا يمنع التعديل الذاتي، ومسح بـ null', async () => {
      const g = await get('admin', `/documents/${ids['doc']}`);
      expect(g.status).toBe(200);
      expect(g.body.data.typeNameAr).toBeUndefined();
      const u = await patch('admin', `/documents/${ids['doc']}`, {
        version: g.body.data.version,
        values: { contractNo: 'C-1', rooms: null, ownerPhone: '••••••' },
      });
      expect(u.status).toBe(200);
      expect(u.body.data.values.rooms).toBeUndefined();
      expect(u.body.data.values.ownerPhone).toBe('••••••');
      const stale = await patch('admin', `/documents/${ids['doc']}`, {
        version: g.body.data.version,
        values: { title: 'قديم' },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      // الكشف ما زال يعيد الهاتف الأصلي
      const rv = await post('admin', `/documents/${ids['doc']}/reveal`, { key: 'ownerPhone' });
      expect(rv.status).toBe(200);
      expect(rv.body.data.value).toBe('0501234567');
      expect(rv.headers['cache-control']).toContain('no-store');
      const logs = await admin
        .selectFrom('auditLogs')
        .select('changes')
        .where('entityId', '=', ids['doc'] as string)
        .where('action', '=', 'reveal')
        .execute();
      expect(logs).toHaveLength(1);
      expect(JSON.stringify(logs[0]?.changes)).not.toContain('0501234567');
      expect(
        (await post('admin', `/documents/${ids['doc']}/reveal`, { key: 'title' })).status,
      ).toBe(404);
    });

    it('القائمة تُرشَّح بالنوع والمالك وتقنّع الحساس وتعدّ الملفات', async () => {
      const l = await get('admin', `/documents?documentTypeId=${type}&ownerId=${emp}`);
      expect(l.status).toBe(200);
      expect(l.body.meta.total).toBe(1);
      expect(l.body.data[0].typeNameAr).toBe('عقد إيجار سكن');
      expect(l.body.data[0].values.ownerPhone).toBe('••••••');
      expect(l.body.data[0].fileCount).toBe(0);
    });

    it('تذكير التاريخ: يُنشأ، يُكمَّل، ويعود قيد الانتظار عند تغيير التاريخ، ويُحذف عند المسح', async () => {
      const list = await get('admin', '/document-reminders?dueBefore=2026-06-01');
      expect(list.status).toBe(200);
      const mine = list.body.data.find((r: { documentId: string }) => r.documentId === ids['doc']);
      expect(mine).toMatchObject({ fieldKey: 'renewOn', dueDate: '2026-01-01', status: 'pending' });
      expect(
        (await get('admin', '/document-reminders?dueBefore=2025-12-31')).body.data.some(
          (r: { documentId: string }) => r.documentId === ids['doc'],
        ),
      ).toBe(false);
      const done = await patch('admin', `/document-reminders/${mine.id}`, {
        version: mine.version,
        status: 'done',
      });
      expect(done.body.data.status).toBe('done');
      const cur = (await get('admin', `/documents/${ids['doc']}`)).body.data;
      // نفس التاريخ لا يعيد التذكير
      await patch('admin', `/documents/${ids['doc']}`, {
        version: cur.version,
        values: { renewOn: '2026-01-01', title: 'عقد الرياض' },
      });
      let rem = (await get('admin', `/documents/${ids['doc']}`)).body.data.reminders[0];
      expect(rem.status).toBe('done');
      // تاريخ جديد → pending
      const cur2 = (await get('admin', `/documents/${ids['doc']}`)).body.data;
      await patch('admin', `/documents/${ids['doc']}`, {
        version: cur2.version,
        values: { renewOn: '2027-01-01' },
      });
      rem = (await get('admin', `/documents/${ids['doc']}`)).body.data.reminders[0];
      expect(rem).toMatchObject({ status: 'pending', dueDate: '2027-01-01' });
      // مسح
      const cur3 = (await get('admin', `/documents/${ids['doc']}`)).body.data;
      await patch('admin', `/documents/${ids['doc']}`, {
        version: cur3.version,
        values: { renewOn: null },
      });
      expect((await get('admin', `/documents/${ids['doc']}`)).body.data.reminders).toHaveLength(0);
      // أعد التاريخ لاستخدامه لاحقاً
      const cur4 = (await get('admin', `/documents/${ids['doc']}`)).body.data;
      await patch('admin', `/documents/${ids['doc']}`, {
        version: cur4.version,
        values: { renewOn: '2028-01-01' },
      });
    });

    it('الاستبدال ينشئ نسخة جديدة ويغلق القديمة وينقل التذكير ويسمح بإعادة القيمة الفريدة', async () => {
      const r = await post('admin', `/documents/${ids['doc']}/supersede`, {
        values: { title: 'عقد الرياض 2026', renewOn: '2029-01-01' },
      });
      expect(r.status).toBe(201);
      const next = r.body.data;
      expect(next.versionNo).toBe(2);
      expect(next.values.contractNo).toBe('C-1');
      expect(next.values.title).toBe('عقد الرياض 2026');
      const old = (await get('admin', `/documents/${ids['doc']}`)).body.data;
      expect(old.status).toBe('superseded');
      expect(old.supersededBy).toBe(next.id);
      expect(old.reminders).toHaveLength(0);
      expect(
        (
          await patch('admin', `/documents/${ids['doc']}`, {
            version: old.version,
            values: { title: 'x' },
          })
        ).status,
      ).toBe(409);
      expect((await post('admin', `/documents/${ids['doc']}/supersede`, {})).status).toBe(409);
      // القائمة الافتراضية للنشطة فقط
      const active = await get('admin', `/documents?documentTypeId=${type}`);
      expect(active.body.data.map((d: { id: string }) => d.id)).toEqual([next.id]);
      const all = await get('admin', `/documents?documentTypeId=${type}&status=superseded`);
      expect(all.body.data).toHaveLength(1);
      ids['doc2'] = next.id;
    });

    it('الملفات: رفع PDF لحقل ملف، تنزيل مطابق، ورفض النوع والحجم والحقل الخاطئ', async () => {
      const up = await upload(
        'admin',
        'post',
        `/documents/${ids['doc2']}/files?fieldKey=scan&pageNo=1&name=${encodeURIComponent('عقد.pdf')}`,
        PDF,
      );
      expect(up.status).toBe(201);
      expect(up.body.data).toMatchObject({
        originalName: 'عقد.pdf',
        mimeType: 'application/pdf',
        fieldKey: 'scan',
        isEncrypted: true, // النوع فيه حقل حساس
      });
      const dl = await get('admin', `/documents/${ids['doc2']}/files/${up.body.data.id}/content`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-type']).toBe('application/pdf');
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-disposition']).toContain('attachment');
      expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
      // التخزين الفعلي مشفّر
      const stored = await files();
      expect(stored).toHaveLength(1);
      expect((await readFile(stored[0] as string)).includes(Buffer.from('%PDF-'))).toBe(false);
      // التنزيل المشفّر مدقَّق
      const aud = await admin
        .selectFrom('auditLogs')
        .select('id')
        .where('entityId', '=', ids['doc2'] as string)
        .where('action', '=', 'download')
        .execute();
      expect(aud).toHaveLength(1);

      expect(
        (
          await upload(
            'admin',
            'post',
            `/documents/${ids['doc2']}/files`,
            Buffer.from('هذا نص عادي وليس ملفاً مسموحاً'),
          )
        ).status,
      ).toBe(415);
      expect(
        (await upload('admin', 'post', `/documents/${ids['doc2']}/files`, Buffer.alloc(0))).status,
      ).toBe(400);
      const big = Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024)]);
      expect((await upload('admin', 'post', `/documents/${ids['doc2']}/files`, big)).status).toBe(
        413,
      );
      expect(
        (await upload('admin', 'post', `/documents/${ids['doc2']}/files?fieldKey=title`, PDF))
          .status,
      ).toBe(400);
      expect(
        (await upload('admin', 'post', `/documents/${ids['doc2']}/files?fieldKey=ghost`, PDF))
          .status,
      ).toBe(400);
      // الوثيقة المستبدلة لا تقبل ملفات
      expect((await upload('admin', 'post', `/documents/${ids['doc']}/files`, PDF)).status).toBe(
        409,
      );
      expect((await get('admin', `/documents/${ids['doc2']}`)).body.data.files).toHaveLength(1);
    });

    it('حذف ملف ثم حذف الوثيقة يزيل البايتات من التخزين', async () => {
      const detail = (await get('admin', `/documents/${ids['doc2']}`)).body.data;
      expect(
        (await del('admin', `/documents/${ids['doc2']}/files/${detail.files[0].id}`)).status,
      ).toBe(204);
      expect(await files()).toHaveLength(0);
      await upload('admin', 'post', `/documents/${ids['doc2']}/files`, PDF);
      expect(await files()).toHaveLength(1);
      expect((await del('admin', `/documents/${ids['doc2']}`)).status).toBe(204);
      expect(await files()).toHaveLength(0);
      expect((await get('admin', `/documents/${ids['doc2']}`)).status).toBe(404);
      // القديمة بقيت وصارت بلا إشارة
      const old = (await get('admin', `/documents/${ids['doc']}`)).body.data;
      expect(old.supersededBy).toBeNull();
    });

    it('نوع بلا حقول حساسة يحفظ الملف غير مشفّر، وحذف النوع ذي الوثائق ممنوع', async () => {
      const t2 = (
        await post('admin', '/document-types', { nameAr: 'شهادة', ownerType: 'employee' })
      ).body.data.id;
      const d = await post('admin', '/documents', { documentTypeId: t2, ownerId: emp, values: {} });
      const up = await upload('admin', 'post', `/documents/${d.body.data.id}/files`, PDF);
      expect(up.body.data.isEncrypted).toBe(false);
      expect(Buffer.compare(await readFile((await files())[0] as string), PDF)).toBe(0);
      const r = await del('admin', `/document-types/${t2}`);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('IN_USE');
      // حقل له بيانات لا يُحذف
      expect((await del('admin', `/documents/${d.body.data.id}`)).status).toBe(204);
    });

    it('لا يُحذف موظف له وثائق', async () => {
      const r = await del('admin', `/employees/${emp}`);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('IN_USE');
    });
  });

  describe('وثائق الفروع والشركة والنطاقات', () => {
    it('وثيقة فرع ووثيقة شركة، ومدير فرع جدة لا يرى غير فرعه', async () => {
      const bt = (
        await post('admin', '/document-types', { nameAr: 'ترخيص فرع', ownerType: 'branch' })
      ).body.data.id;
      const ct = (
        await post('admin', '/document-types', { nameAr: 'سجل تجاري', ownerType: 'company' })
      ).body.data.id;
      const ruhDoc = (
        await post('admin', '/documents', { documentTypeId: bt, ownerId: ids['ruh'], values: {} })
      ).body.data.id;
      const jedDoc = (
        await post('admin', '/documents', { documentTypeId: bt, ownerId: ids['jed'], values: {} })
      ).body.data.id;
      const coDoc = await post('admin', '/documents', { documentTypeId: ct, values: {} });
      expect(coDoc.status).toBe(201);
      expect(coDoc.body.data.ownerId).toBe(acme);
      const jedEmp = await hire('جميل', ids['jed'] as string);
      const et = (
        await post('admin', '/document-types', { nameAr: 'تأمين', ownerType: 'employee' })
      ).body.data.id;
      const jedEmpDoc = (
        await post('admin', '/documents', { documentTypeId: et, ownerId: jedEmp, values: {} })
      ).body.data.id;
      const ruhEmpDoc = (
        await post('admin', '/documents', { documentTypeId: et, ownerId: ids['emp'], values: {} })
      ).body.data.id;

      const seen = (await get('jed', '/documents?pageSize=200')).body.data.map(
        (d: { id: string }) => d.id,
      ) as string[];
      expect(seen).toContain(jedDoc);
      expect(seen).toContain(jedEmpDoc);
      for (const hidden of [ruhDoc, coDoc.body.data.id, ruhEmpDoc]) {
        expect(seen).not.toContain(hidden);
        expect((await get('jed', `/documents/${hidden}`)).status).toBe(404);
      }
      // الكتابة خارج النطاق مرفوضة
      expect(
        (await post('jed', '/documents', { documentTypeId: bt, ownerId: ids['ruh'], values: {} }))
          .status,
      ).toBe(404);
      expect((await post('jed', '/documents', { documentTypeId: ct, values: {} })).status).toBe(
        404,
      );
      // التذكيرات أيضاً مقيّدة
      const rt = (
        await post('admin', '/document-types', { nameAr: 'إقامة', ownerType: 'employee' })
      ).body.data.id;
      await post('admin', `/document-types/${rt}/fields`, {
        key: 'expiry',
        labelAr: 'الانتهاء',
        dataType: 'reminder_date',
      });
      const rDoc = (
        await post('admin', '/documents', {
          documentTypeId: rt,
          ownerId: ids['emp'],
          values: { expiry: '2026-05-01' },
        })
      ).body.data.id;
      const jr = (await get('jed', '/document-reminders')).body.data as { documentId: string }[];
      expect(jr.some((r) => r.documentId === rDoc)).toBe(false);
      const ar = (await get('admin', '/document-reminders')).body.data as { documentId: string }[];
      expect(ar.some((r) => r.documentId === rDoc)).toBe(true);
    });

    it('عزل الشركات: لا تُرى أنواع ولا وثائق شركة أخرى', async () => {
      expect((await get('globex', '/document-types')).body.data).toHaveLength(0);
      expect((await get('globex', '/documents')).body.meta.total).toBe(0);
      expect((await get('globex', `/documents/${ids['doc']}`)).status).toBe(404);
    });
  });

  describe('صورة الموظف', () => {
    let emp: string;
    const png = (color: string, w = 600, h = 400) =>
      sharp({ create: { width: w, height: h, channels: 3, background: color } })
        .png()
        .toBuffer();

    beforeAll(async () => {
      emp = await hire('فيصل', ids['ruh'] as string);
    });

    it('رفع صورة يعيد ترميزها WebP ويصنع مصغّرة 256 ويُقرأ الحجمان', async () => {
      const up = await upload('admin', 'put', `/employees/${emp}/photo`, await png('#3366cc'));
      expect(up.status).toBe(200);
      const thumb = await get('admin', `/employees/${emp}/photo`);
      expect(thumb.status).toBe(200);
      expect(thumb.headers['content-type']).toBe('image/webp');
      const meta = await sharp(thumb.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([256, 256]);
      const full = await get('admin', `/employees/${emp}/photo?size=full`);
      const fm = await sharp(full.body as Buffer).metadata();
      expect(fm.width).toBe(600);
      expect((await get('admin', `/employees/${emp}`)).body.data.photoFileId).toBe(
        up.body.data.photoFileId,
      );
    });

    it('استبدال الصورة يحذف القديمة (صفوفاً وبايتات)، والحذف يفرّغ الحقل', async () => {
      const before = (await files()).length;
      await upload('admin', 'put', `/employees/${emp}/photo`, await png('#cc3333', 2000, 1500));
      expect((await files()).length).toBe(before); // صورتان جديدتان بدل القديمتين
      const full = await get('admin', `/employees/${emp}/photo?size=full`);
      expect((await sharp(full.body as Buffer).metadata()).width).toBe(1024);
      const rows = await admin
        .selectFrom('storedFiles')
        .select('id')
        .where('purpose', '=', 'employee_photo')
        .execute();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect((await del('admin', `/employees/${emp}/photo`)).status).toBe(204);
      expect((await get('admin', `/employees/${emp}/photo`)).status).toBe(404);
      expect((await get('admin', `/employees/${emp}`)).body.data.photoFileId).toBeNull();
    });

    it('يرفض غير الصور والصور التالفة، ويحجب خارج النطاق والشركات الأخرى', async () => {
      expect((await upload('admin', 'put', `/employees/${emp}/photo`, PDF)).status).toBe(415);
      const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
      expect((await upload('admin', 'put', `/employees/${emp}/photo`, corrupt)).status).toBe(400);
      expect(
        (await upload('jed', 'put', `/employees/${emp}/photo`, await png('#000000'))).status,
      ).toBe(404);
      expect((await get('globex', `/employees/${emp}/photo`)).status).toBe(404);
    });
  });
});
