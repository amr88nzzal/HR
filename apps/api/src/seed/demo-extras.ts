import { sql } from 'kysely';
import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import { createApprovalEngine } from '../approvals/index.js';
import { loadFields, syncReminders } from '../modules/archive/documents.routes.js';
import { prepareValues } from '../modules/archive/field-values.js';
import { maskIban } from '../modules/employees/bank.routes.js';
import { prepareCustomFields } from '../modules/employees/custom-fields.js';
import { applyChange } from '../modules/employees/employments.routes.js';
import { recomputeDays } from '../modules/attendance/index.js';
import { hashPassword } from '../modules/identity/index.js';
import {
  adjust,
  cancelRequest,
  runLeaveMaintenance,
  submitRequest,
} from '../modules/leave/index.js';
import { createNotifier } from '../notifications/index.js';
import type { FieldCrypto } from '../shared/crypto.js';
import { DEMO_EMAIL_DOMAIN, DEMO_PREFIX } from './demo.js';

export type ExtrasPart =
  'details' | 'lifecycle' | 'archive' | 'approvals' | 'leave' | 'attendance' | 'punches';
export type ExtrasResult = { part: ExtrasPart; status: 'done' | 'skipped'; note?: string }[];

const pad = (n: number, w = 3) => String(n).padStart(w, '0');
const isoDay = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Emp = {
  id: string;
  employeeNo: string;
  fullNameAr: string;
  gender: 'male' | 'female' | null;
  maritalStatus: string | null;
  userId: string | null;
};

const loadEmployees = async (ctx: Ctx): Promise<Emp[]> =>
  ctx.trx
    .selectFrom('employees')
    .select(['id', 'employeeNo', 'fullNameAr', 'gender', 'maritalStatus', 'userId'])
    .where('companyId', '=', ctx.companyId)
    .where('employeeNo', 'like', `${DEMO_PREFIX}%`)
    .orderBy('employeeNo')
    .execute();

const byNo = (emps: Emp[], n: number): Emp => {
  const e = emps.find((x) => x.employeeNo === `${DEMO_PREFIX}${pad(n)}`);
  if (!e) throw new Error(`الموظف التجريبي ${DEMO_PREFIX}${pad(n)} غير موجود`);
  return e;
};

// ───────────────────────── 1) تفاصيل الموظفين ─────────────────────────
const seedDetails = async (
  ctx: Ctx,
  crypto: FieldCrypto | undefined,
): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('customFieldDefinitions')
    .select('id')
    .where('companyId', '=', companyId)
    .where('key', '=', 'demoBloodType')
    .executeTakeFirst();
  if (marker) return 'skip';

  const base = await trx
    .selectFrom('currencies')
    .select('id')
    .where('companyId', '=', companyId)
    .where('isBase', '=', true)
    .executeTakeFirst();
  if (!base)
    await trx
      .insertInto('currencies')
      .values({
        companyId,
        code: 'JOD',
        nameAr: 'دينار أردني',
        nameEn: 'Jordanian dinar',
        symbol: 'د.أ',
        displayDecimals: 3,
        isBase: true,
      })
      .onConflict((oc) => oc.columns(['companyId', 'code']).doNothing())
      .execute();

  const blood = ['A+', 'A-', 'B+', 'O+', 'O-', 'AB+'].map((v) => ({ value: v, labelAr: v }));
  const shirts = ['S', 'M', 'L', 'XL'].map((v) => ({ value: v, labelAr: v }));
  await trx
    .insertInto('customFieldDefinitions')
    .values([
      {
        companyId,
        key: 'demoBloodType',
        labelAr: 'فصيلة الدم',
        labelEn: 'Blood type',
        fieldType: 'select',
        options: JSON.stringify(blood),
        sortOrder: 1,
      },
      {
        companyId,
        key: 'demoShirtSize',
        labelAr: 'مقاس الزي',
        labelEn: 'Uniform size',
        fieldType: 'select',
        options: JSON.stringify(shirts),
        sortOrder: 2,
      },
      ...(crypto
        ? [
            {
              companyId,
              key: 'demoNationalId',
              labelAr: 'الرقم الوطني',
              labelEn: 'National ID',
              fieldType: 'text' as const,
              isSensitive: true,
              sortOrder: 3,
            },
          ]
        : []),
    ])
    .execute();

  const emps = await loadEmployees(ctx);
  const departments = await trx
    .selectFrom('employments as m')
    .innerJoin('departments as d', 'd.id', 'm.departmentId')
    .select(['m.employeeId', 'd.nameAr'])
    .where('m.companyId', '=', companyId)
    .where('m.validTo', 'is', null)
    .execute();
  const deptOf = new Map(departments.map((d) => [d.employeeId, d.nameAr]));

  for (const [i, e] of emps.entries()) {
    const city = i % 3 === 0 ? 'Irbid' : 'Amman';
    await trx
      .insertInto('employeeAddresses')
      .values({
        companyId,
        employeeId: e.id,
        type: 'home',
        country: 'JO',
        city,
        line1: `شارع ${10 + i}، حي ${['الجبيهة', 'الرابية', 'تلاع العلي', 'الصويفية'][i % 4]}`,
        postalCode: `${11100 + i}`,
        isPrimary: true,
      })
      .execute();
    await trx
      .insertInto('employeeContacts')
      .values({
        companyId,
        employeeId: e.id,
        type: 'emergency',
        value: `+96277${pad(2000000 + i * 211, 7)}`,
        contactName: e.gender === 'female' ? 'الزوج / الأخ' : 'الأخ / الوالد',
        relation: e.gender === 'female' ? 'ولي أمر' : 'قريب',
      })
      .execute();

    if (e.maritalStatus === 'married') {
      await trx
        .insertInto('employeeDependents')
        .values({
          companyId,
          employeeId: e.id,
          name: e.gender === 'female' ? 'زوج' : 'زوجة',
          relation: 'spouse',
          gender: e.gender === 'female' ? 'male' : 'female',
          birthDate: `${1982 + (i % 12)}-0${(i % 9) + 1}-15`,
          isCovered: true,
        })
        .execute();
      for (let k = 0; k < i % 3; k += 1)
        await trx
          .insertInto('employeeDependents')
          .values({
            companyId,
            employeeId: e.id,
            name: `ابن/ابنة ${k + 1}`,
            relation: 'child',
            gender: k % 2 === 0 ? 'male' : 'female',
            birthDate: `${2012 + k * 3}-0${(k % 9) + 1}-10`,
            isCovered: true,
          })
          .execute();
    }

    await trx
      .insertInto('employeeEducation')
      .values({
        companyId,
        employeeId: e.id,
        degree: i % 4 === 0 ? 'ماجستير' : 'بكالوريوس',
        field: deptOf.get(e.id) ?? 'إدارة أعمال',
        institution: i % 2 === 0 ? 'الجامعة الأردنية' : 'جامعة اليرموك',
        country: 'JO',
        startYear: 2004 + (i % 8),
        endYear: 2008 + (i % 8),
        grade: i % 3 === 0 ? 'جيد جداً' : 'جيد',
      })
      .execute();
    if (i % 2 === 0)
      await trx
        .insertInto('employeeExperience')
        .values({
          companyId,
          employeeId: e.id,
          employer: ['شركة الأفق', 'مجموعة النور', 'مؤسسة البناء'][i % 3] as string,
          title: 'موظف',
          startDate: `${2014 + (i % 4)}-01-01`,
          endDate: `${2018 + (i % 3)}-12-31`,
        })
        .execute();

    if (crypto) {
      const iban = `JO94CBJO${String(1_000_000 + i).padStart(22, '0')}`;
      await trx
        .insertInto('employeeBankAccounts')
        .values({
          companyId,
          employeeId: e.id,
          bankName: i % 2 === 0 ? 'البنك العربي' : 'بنك الإسكان',
          accountHolder: e.fullNameAr,
          currency: 'JOD',
          isPrimary: true,
          ibanEnc: crypto.encrypt(iban, 'employee_bank_accounts.iban'),
          ibanDigest: crypto.digest(iban),
          ibanMasked: maskIban(iban),
        })
        .execute();
    }
    const custom = await prepareCustomFields(
      ctx,
      crypto,
      {
        demoBloodType: (blood[i % blood.length] as { value: string }).value,
        demoShirtSize: (shirts[i % shirts.length] as { value: string }).value,
        ...(crypto ? { demoNationalId: `99${pad(i, 8)}` } : {}),
      },
      {},
    );
    await trx
      .updateTable('employees')
      .set({ customFields: JSON.stringify(custom) })
      .where('id', '=', e.id)
      .execute();
  }
  return crypto
    ? undefined
    : 'بلا مفاتيح تشفير: لم تُضَف الحسابات البنكية ولا حقل الرقم الوطني الحساس';
};

// ───────────────────────── 2) أحداث وظيفية ─────────────────────────
const seedLifecycle = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('changeReasons')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-PROMOTION')
    .executeTakeFirst();
  if (marker) return 'skip';

  const reasonIds: Record<string, string> = {};
  for (const [type, nameAr, nameEn] of [
    ['transfer', 'نقل لحاجة العمل', 'Business need transfer'],
    ['promotion', 'ترقية سنوية', 'Annual promotion'],
    ['manager_change', 'إعادة هيكلة', 'Restructuring'],
    ['suspension', 'إيقاف مؤقت', 'Temporary suspension'],
    ['reinstatement', 'عودة للعمل', 'Back to work'],
    ['termination', 'استقالة', 'Resignation'],
  ] as const) {
    const row = await trx
      .insertInto('changeReasons')
      .values({ companyId, code: `DEMO-${type.toUpperCase()}`, changeType: type, nameAr, nameEn })
      .returning('id')
      .executeTakeFirstOrThrow();
    reasonIds[type] = row.id;
  }
  const emps = await loadEmployees(ctx);
  const irbid = await trx
    .selectFrom('branches')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-IRB')
    .executeTakeFirstOrThrow();
  const irbidWl = await trx
    .selectFrom('workLocations')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-IRB-HQ')
    .executeTakeFirstOrThrow();
  const spec = await trx
    .selectFrom('jobTitles')
    .select(['id', 'jobGradeId'])
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-SPEC')
    .executeTakeFirstOrThrow();
  const ceo = byNo(emps, 1);

  for (const n of [16, 17])
    await applyChange(ctx, byNo(emps, n).id, {
      changeType: 'transfer',
      effectiveDate: isoDay(-120),
      reasonId: reasonIds['transfer'],
      notes: 'نقل إلى فرع إربد',
      employment: { branchId: irbid.id, workLocationId: irbidWl.id },
    });
  await applyChange(ctx, byNo(emps, 14).id, {
    changeType: 'promotion',
    effectiveDate: isoDay(-90),
    reasonId: reasonIds['promotion'],
    notes: 'ترقية إلى أخصائي',
    employment: { jobTitleId: spec.id, jobGradeId: spec.jobGradeId },
  });
  await applyChange(ctx, byNo(emps, 20).id, {
    changeType: 'manager_change',
    effectiveDate: isoDay(-60),
    reasonId: reasonIds['manager_change'],
    employment: { managerEmployeeId: ceo.id },
  });
  await applyChange(ctx, byNo(emps, 28).id, {
    changeType: 'suspension',
    effectiveDate: isoDay(-10),
    reasonId: reasonIds['suspension'],
    notes: 'إيقاف مؤقت للتحقيق',
    employment: {},
  });
  await applyChange(ctx, byNo(emps, 29).id, {
    changeType: 'suspension',
    effectiveDate: isoDay(-30),
    reasonId: reasonIds['suspension'],
    employment: {},
  });
  await applyChange(ctx, byNo(emps, 29).id, {
    changeType: 'reinstatement',
    effectiveDate: isoDay(-20),
    reasonId: reasonIds['reinstatement'],
    employment: {},
  });
  await applyChange(ctx, byNo(emps, 30).id, {
    changeType: 'termination',
    effectiveDate: isoDay(-45),
    reasonId: reasonIds['termination'],
    notes: 'استقالة بإشعار مسبق',
    employment: {},
  });
  return undefined;
};

// ───────────────────────── 3) الأرشيف والتذكيرات ─────────────────────────
type FieldSeed = {
  key: string;
  labelAr: string;
  dataType: 'text' | 'date' | 'amount' | 'reminder_date';
  isRequired?: boolean;
  isUnique?: boolean;
  showInList?: boolean;
};

const seedArchive = async (
  ctx: Ctx,
  crypto: FieldCrypto | undefined,
): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('documentTypes')
    .select('id')
    .where('companyId', '=', companyId)
    .where('systemKey', '=', 'demo_residence')
    .executeTakeFirst();
  if (marker) return 'skip';

  const mkType = async (
    systemKey: string,
    nameAr: string,
    nameEn: string,
    ownerType: 'employee' | 'branch' | 'company',
    fields: FieldSeed[],
  ) => {
    const t = await trx
      .insertInto('documentTypes')
      .values({ companyId, systemKey, nameAr, nameEn, ownerType, category: 'تجريبي' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('documentTypeFields')
      .values(
        fields.map((f, i) => ({
          companyId,
          documentTypeId: t.id,
          key: f.key,
          labelAr: f.labelAr,
          dataType: f.dataType,
          isRequired: f.isRequired ?? false,
          isUnique: f.isUnique ?? false,
          showInList: f.showInList ?? i < 2,
          sortOrder: i + 1,
          options: '[]',
        })),
      )
      .execute();
    return t.id;
  };
  const addDoc = async (
    typeId: string,
    ownerType: 'employee' | 'branch' | 'company',
    ownerId: string,
    values: Record<string, unknown>,
  ) => {
    const defs = await loadFields(ctx, typeId);
    const prepared = await prepareValues(ctx, crypto, typeId, defs, values, {}, null);
    const doc = await trx
      .insertInto('documents')
      .values({
        companyId,
        documentTypeId: typeId,
        ownerType,
        ownerId,
        values: JSON.stringify(prepared.values),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await syncReminders(ctx, doc.id, prepared.reminders);
  };

  const residence = await mkType('demo_residence', 'هوية / إقامة', 'ID / Residence', 'employee', [
    { key: 'number', labelAr: 'الرقم', dataType: 'text', isRequired: true, isUnique: true },
    { key: 'issueDate', labelAr: 'تاريخ الإصدار', dataType: 'date' },
    { key: 'expiryDate', labelAr: 'تاريخ الانتهاء', dataType: 'reminder_date', isRequired: true },
  ]);
  const license = await mkType('demo_license', 'رخصة المنشأة', 'Business license', 'company', [
    { key: 'licenseNo', labelAr: 'رقم الرخصة', dataType: 'text', isRequired: true },
    { key: 'renewOn', labelAr: 'تاريخ التجديد', dataType: 'reminder_date', isRequired: true },
  ]);
  const lease = await mkType('demo_lease', 'عقد إيجار الفرع', 'Branch lease', 'branch', [
    { key: 'rent', labelAr: 'الإيجار الشهري', dataType: 'amount' },
    { key: 'leaseEnd', labelAr: 'نهاية العقد', dataType: 'reminder_date', isRequired: true },
  ]);

  const emps = await loadEmployees(ctx);
  // متأخرة، قريبة، متوسطة، بعيدة (خارج أفق الملخص)، لتغطية كل الحالات
  const offsets = [-20, 5, 12, 25, 60, 120, 365];
  for (const [i, e] of emps.slice(0, 14).entries())
    await addDoc(residence, 'employee', e.id, {
      number: `RES-${pad(i + 1, 6)}`,
      issueDate: isoDay(-700 + i * 10),
      expiryDate: isoDay(offsets[i % offsets.length] as number),
    });
  await addDoc(license, 'company', companyId, {
    licenseNo: 'LIC-2026-0042',
    renewOn: isoDay(18),
  });
  const branches = await trx
    .selectFrom('branches')
    .select(['id', 'code'])
    .where('companyId', '=', companyId)
    .where('code', 'like', 'DEMO-%')
    .execute();
  for (const b of branches)
    await addDoc(lease, 'branch', b.id, {
      rent: { amount: b.code === 'DEMO-AMM' ? '1200.000' : '800.000', currency: 'JOD' },
      leaseEnd: isoDay(b.code === 'DEMO-AMM' ? 45 : -5),
    });
  return undefined;
};

// ───────────────────────── 4) الموافقات والتفويض ─────────────────────────
const seedApprovals = async (ctx: Ctx, password: string): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('approvalFlows')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'demo-general')
    .executeTakeFirst();
  if (marker) return 'skip';
  const active = await trx
    .selectFrom('approvalFlows')
    .select('code')
    .where('companyId', '=', companyId)
    .where('requestType', '=', 'general')
    .where('isActive', '=', true)
    .executeTakeFirst();
  if (active) return `skip:توجد سلسلة فعّالة للنوع العام (${active.code}) ولم تُستبدل`;

  const emps = await loadEmployees(ctx);
  const userOf = async (email: string) =>
    (
      await trx
        .selectFrom('users')
        .select('id')
        .where('companyId', '=', companyId)
        .where('email', '=', email)
        .executeTakeFirst()
    )?.id;
  const hr = await userOf(`demo.hr@${DEMO_EMAIL_DOMAIN}`);
  const mgr = await userOf(`demo.manager@${DEMO_EMAIL_DOMAIN}`);
  const emp = await userOf(`demo.employee@${DEMO_EMAIL_DOMAIN}`);
  if (!hr || !mgr || !emp) return 'skip:مستخدمو التجربة الأساسيون غير موجودين';

  // مستخدم للمدير العام لتمرّ طلبات رؤساء الأقسام عبره
  const hrRole = await trx
    .selectFrom('roles')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'hr_manager')
    .executeTakeFirstOrThrow();
  let ceo = await userOf(`demo.ceo@${DEMO_EMAIL_DOMAIN}`);
  if (!ceo) {
    const c = byNo(emps, 1);
    ceo = (
      await trx
        .insertInto('users')
        .values({
          companyId,
          email: `demo.ceo@${DEMO_EMAIL_DOMAIN}`,
          displayName: c.fullNameAr,
          passwordHash: await hashPassword(password),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await trx
      .insertInto('userRoleAssignments')
      .values({ companyId, userId: ceo, roleId: hrRole.id, scopeType: 'company', scopeId: null })
      .execute();
    await trx.updateTable('employees').set({ userId: ceo }).where('id', '=', c.id).execute();
  }

  const flow = await trx
    .insertInto('approvalFlows')
    .values({
      companyId,
      code: 'demo-general',
      requestType: 'general',
      nameAr: 'الموافقة العامة (تجريبية)',
      nameEn: 'General approval (demo)',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('approvalSteps')
    .values([
      {
        companyId,
        flowId: flow.id,
        position: 1,
        nameAr: 'المدير المباشر',
        nameEn: 'Direct manager',
        approverType: 'direct_manager',
        fallbackRoleId: hrRole.id,
      },
      {
        companyId,
        flowId: flow.id,
        position: 2,
        nameAr: 'مدير الموارد البشرية (للمبالغ ≥ 1000)',
        nameEn: 'HR manager (amount ≥ 1000)',
        approverType: 'role',
        approverRef: hrRole.id,
        condition: JSON.stringify({ field: 'amount', op: 'gte', value: 1000 }),
      },
    ])
    .execute();
  await trx
    .updateTable('approvalFlows')
    .set({ isActive: true })
    .where('id', '=', flow.id)
    .execute();

  await trx
    .insertInto('approverDelegations')
    .values({
      companyId,
      delegatorUserId: hr,
      delegateUserId: mgr,
      validFrom: isoDay(-1),
      validTo: isoDay(7),
      note: 'تفويض أثناء الإجازة (تجريبي)',
    })
    .execute();

  const engine = createApprovalEngine(createNotifier(undefined));
  const submit = (who: string, title: string, amount: number) =>
    engine.submit(ctx, {
      requestType: 'general',
      title,
      requesterUserId: who,
      payload: { amount },
    });

  await submit(emp, 'طلب شراء حاسوب محمول', 900); // معلّق عند المدير المباشر (مع النائب)
  const b = await submit(emp, 'طلب معدات مكتبية', 2500);
  await engine.act(ctx, b.id, hr, { action: 'approve' }); // معلّق عند الخطوة الثانية
  const c = await submit(emp, 'طلب سلفة صغيرة', 300);
  await engine.act(ctx, c.id, hr, { action: 'approve' }); // موافَق
  const d = await submit(mgr, 'طلب دورة تدريبية', 1500);
  await engine.act(ctx, d.id, ceo, { action: 'approve' });
  await engine.act(ctx, d.id, hr, { action: 'approve' }); // موافَق بخطوتين
  const e = await submit(emp, 'طلب ميزانية مشروع', 5000);
  await engine.act(ctx, e.id, hr, { action: 'approve' });
  await engine.act(ctx, e.id, ceo, { action: 'reject', note: 'الميزانية غير متاحة هذا الربع' });
  const f = await submit(emp, 'طلب يحتاج استكمال بيانات', 700);
  await engine.act(ctx, f.id, hr, { action: 'return', note: 'أرفق عرض السعر' });
  const g = await submit(emp, 'طلب سُحب', 100);
  await engine.withdraw(ctx, g.id, emp, 'لم أعد بحاجة إليه');
  return undefined;
};

// ───────────────────────── 5) الإجازات (المرحلة 4) ─────────────────────────
/** أول أحد في/بعد اليوم + offset (الراحة الأسبوعية الافتراضية الجمعة والسبت فتبدأ الفترات بالأحد). */
const sundayOnOrAfter = (offset: number): string => {
  const d = new Date(Date.now() + offset * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
};
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const seedLeave = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('leaveTypes')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-ANNUAL')
    .executeTakeFirst();
  if (marker) return 'skip';
  const userEmp = async (email: string) =>
    trx
      .selectFrom('users as u')
      .innerJoin('employees as e', 'e.userId', 'u.id')
      .select(['u.id as userId', 'e.id as employeeId'])
      .where('u.companyId', '=', companyId)
      .where('u.email', '=', email)
      .executeTakeFirst();
  const emp = await userEmp(`demo.employee@${DEMO_EMAIL_DOMAIN}`);
  const mgr = await userEmp(`demo.manager@${DEMO_EMAIL_DOMAIN}`);
  const hr = await userEmp(`demo.hr@${DEMO_EMAIL_DOMAIN}`);
  if (!emp || !mgr || !hr) return 'skip:مستخدمو التجربة الأساسيون غير موجودين';

  // الأنواع والسياسات
  const mkType = async (v: {
    code: string;
    nameAr: string;
    nameEn: string;
    isPaid?: boolean;
    requiresAttachment?: boolean;
    color: string;
  }) =>
    (
      await trx
        .insertInto('leaveTypes')
        .values({ companyId, ...v })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const annual = await mkType({
    code: 'DEMO-ANNUAL',
    nameAr: 'إجازة سنوية',
    nameEn: 'Annual leave',
    color: '#228be6',
  });
  const sick = await mkType({
    code: 'DEMO-SICK',
    nameAr: 'إجازة مرضية',
    nameEn: 'Sick leave',
    requiresAttachment: true,
    color: '#fa5252',
  });
  const unpaid = await mkType({
    code: 'DEMO-UNPAID',
    nameAr: 'إجازة بلا راتب',
    nameEn: 'Unpaid leave',
    isPaid: false,
    color: '#868e96',
  });
  const mkPolicy = async (v: {
    code: string;
    nameAr: string;
    nameEn: string;
    leaveTypeId: string;
    annualEntitlement: string;
    accrualMethod?: 'monthly' | 'upfront';
    carryOverMax?: string;
    carryOverValidMonths?: number;
  }) =>
    (
      await trx
        .insertInto('leavePolicies')
        .values({ companyId, ...v })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const stdPolicy = await mkPolicy({
    code: 'DEMO-STD',
    nameAr: 'السنوية القياسية (21 يوماً)',
    nameEn: 'Standard annual (21 days)',
    leaveTypeId: annual,
    annualEntitlement: '21.00',
    carryOverMax: '5.00',
    carryOverValidMonths: 3,
  });
  const seniorPolicy = await mkPolicy({
    code: 'DEMO-SENIOR',
    nameAr: 'السنوية للإدارة (30 يوماً)',
    nameEn: 'Management annual (30 days)',
    leaveTypeId: annual,
    annualEntitlement: '30.00',
    carryOverMax: '10.00',
    carryOverValidMonths: 6,
  });
  const sickPolicy = await mkPolicy({
    code: 'DEMO-SICKP',
    nameAr: 'المرضية (14 يوماً مقدَّمة)',
    nameEn: 'Sick (14 days upfront)',
    leaveTypeId: sick,
    annualEntitlement: '14.00',
    accrualMethod: 'upfront',
  });
  const assign = (policyId: string, scope: 'company' | 'employee', scopeRef: string | null) =>
    trx
      .insertInto('leavePolicyAssignments')
      .values({ companyId, policyId, scope, scopeRef, validFrom: '2020-01-01' })
      .execute();
  await assign(stdPolicy, 'company', null);
  await assign(sickPolicy, 'company', null);
  await assign(seniorPolicy, 'employee', mgr.employeeId); // الأخص يغلب: المدير بسياسة 30 يوماً

  // العطل الرسمية (سنة جارية) + عطلة تجريبية قريبة تمرّ بها إجازة
  const year = new Date().getUTCFullYear();
  const nearMonday = addDays(sundayOnOrAfter(56), 1);
  const holidays: [string, string, string][] = [
    [`${year}-01-01`, 'رأس السنة الميلادية', "New Year's Day"],
    [`${year}-05-01`, 'عيد العمال', 'Labour Day'],
    [`${year}-05-25`, 'عيد الاستقلال', 'Independence Day'],
    [`${year}-12-25`, 'عيد الميلاد المجيد', 'Christmas Day'],
    [nearMonday, 'عطلة تجريبية', 'Demo holiday'],
  ];
  for (const [d, ar, en] of holidays)
    await trx
      .insertInto('holidays')
      .values({ companyId, holidayDate: d, nameAr: ar, nameEn: en })
      .onConflict((oc) => oc.columns(['companyId', 'holidayDate']).doNothing())
      .execute();

  // الاستحقاق: السنة الماضية كاملة ثم الحالية (فيظهر الترحيل بالسقف وانتهاء المرحَّل)
  await runLeaveMaintenance(ctx, `${year - 1}-12-31`);
  await runLeaveMaintenance(ctx);

  // طلبات بكل الحالات (تمرّ بالموافقات الفعلية)
  const engine = createApprovalEngine(createNotifier(undefined));
  const ask = async (
    who: { userId: string; employeeId: string },
    typeId: string,
    start: string,
    len: number,
    extra: { firstDayHalf?: boolean; reason?: string } = {},
  ) => {
    const id = await submitRequest(ctx, engine, who.userId, who.employeeId, {
      leaveTypeId: typeId,
      startDate: start,
      endDate: addDays(start, len - 1),
      firstDayHalf: extra.firstDayHalf ?? false,
      lastDayHalf: false,
      reason: extra.reason ?? null,
    });
    const r = await trx
      .selectFrom('leaveRequests')
      .select('approvalRequestId')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { id, approvalId: r.approvalRequestId as string };
  };
  const decide = async (approvalId: string, action: 'approve' | 'reject', note?: string) => {
    const a = await trx
      .selectFrom('approvalRequestAssignees')
      .select('userId')
      .where('requestId', '=', approvalId)
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow();
    await engine.act(ctx, approvalId, a.userId, { action, note: note ?? null });
  };

  const past = await ask(emp, annual, sundayOnOrAfter(-21), 3, { reason: 'سفر عائلي' });
  await decide(past.approvalId, 'approve'); // معتمدة (منتهية)
  await ask(emp, annual, sundayOnOrAfter(14), 3, { reason: 'إجازة قصيرة' }); // معلّقة
  const rej = await ask(emp, annual, sundayOnOrAfter(28), 2);
  await decide(rej.approvalId, 'reject', 'ضغط عمل في هذه الفترة'); // مرفوضة (الرصيد معاد)
  const wd = await ask(emp, annual, sundayOnOrAfter(35), 2);
  await engine.withdraw(ctx, wd.approvalId, emp.userId, 'تغيّرت الخطة'); // مسحوبة
  const cn = await ask(emp, annual, sundayOnOrAfter(42), 2);
  await decide(cn.approvalId, 'approve');
  await cancelRequest(ctx, engine, cn.id, { userId: emp.userId, canManage: false }); // معتمدة ثم ملغاة
  const half = await ask(emp, annual, sundayOnOrAfter(21), 2, { firstDayHalf: true });
  await decide(half.approvalId, 'approve'); // نصف يوم في أولها
  const hol = await ask(emp, annual, addDays(nearMonday, -1), 3, { reason: 'تمرّ بعطلة رسمية' });
  await decide(hol.approvalId, 'approve'); // عطلة الاثنين لا تُحتسب
  const sk = await ask(emp, sick, sundayOnOrAfter(-45), 2, { reason: 'وعكة صحية' });
  await decide(sk.approvalId, 'approve'); // مرضية
  await ask(emp, unpaid, sundayOnOrAfter(70), 5); // بلا راتب: لا تمسّ الرصيد
  await ask(mgr, annual, sundayOnOrAfter(30), 4); // طلب المدير (يوجَّه لمن فوقه أو بديله)

  // تعديلات يدوية من الموارد البشرية
  await adjust(ctx, {
    employeeId: emp.employeeId,
    leaveTypeId: annual,
    days: 2,
    reason: 'مكافأة أداء (تجريبي)',
    userId: hr.userId,
  });
  await adjust(ctx, {
    employeeId: emp.employeeId,
    leaveTypeId: annual,
    days: -0.5,
    reason: 'تصحيح خطأ إدخال (تجريبي)',
    userId: hr.userId,
  });
  return undefined;
};

// ───────────────────────── 6) الحضور (المرحلة 5) ─────────────────────────
const seedAttendance = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('shifts')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-DAY')
    .executeTakeFirst();
  if (marker) return 'skip';

  const mkShift = async (
    code: string,
    nameAr: string,
    color: string,
    segments: [string, string, boolean][],
    grace = 10,
  ) => {
    const row = await trx
      .insertInto('shifts')
      .values({
        companyId,
        code,
        nameAr,
        color,
        lateGraceMinutes: grace,
        earlyLeaveGraceMinutes: 5,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('shiftSegments')
      .values(
        segments.map(([startTime, endTime, endsNextDay], i) => ({
          companyId,
          shiftId: row.id,
          position: i + 1,
          startTime,
          endTime,
          endsNextDay,
        })),
      )
      .execute();
    return row.id;
  };
  const day = await mkShift('DEMO-DAY', 'صباحية (08:00–16:00)', '#228be6', [
    ['08:00', '16:00', false],
  ]);
  const split = await mkShift('DEMO-SPLIT', 'مقسومة (08–12 و16–20)', '#fd7e14', [
    ['08:00', '12:00', false],
    ['16:00', '20:00', false],
  ]);
  const night = await mkShift(
    'DEMO-NIGHT',
    'ليلية (22:00–06:00)',
    '#7048e8',
    [['22:00', '06:00', true]],
    15,
  );

  // الأحد..الخميس عمل، الجمعة والسبت راحة (يوافق الإعداد الافتراضي)
  const mkSchedule = async (code: string, nameAr: string, shiftId: string) => {
    const row = await trx
      .insertInto('workSchedules')
      .values({ companyId, code, nameAr })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('workScheduleDays')
      .values(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          companyId,
          scheduleId: row.id,
          weekday,
          shiftId: weekday <= 4 ? shiftId : null,
        })),
      )
      .execute();
    return row.id;
  };
  const std = await mkSchedule('DEMO-STD', 'الدوام القياسي', day);
  const sales = await mkSchedule('DEMO-SALES', 'دوام المبيعات المقسوم', split);
  const guard = await mkSchedule('DEMO-NIGHT', 'الدوام الليلي', night);

  const assign = (
    scheduleId: string,
    scope: 'company' | 'department' | 'employee',
    scopeRef: string | null,
    validFrom: string,
    validTo: string | null = null,
  ) =>
    trx
      .insertInto('scheduleAssignments')
      .values({ companyId, scheduleId, scope, scopeRef, validFrom, validTo })
      .execute();
  await assign(std, 'company', null, '2020-01-01');
  const salesDept = await trx
    .selectFrom('departments')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-SAL')
    .executeTakeFirst();
  if (salesDept) await assign(sales, 'department', salesDept.id, '2020-01-01');
  // موظف بجدول ليلي مؤقت لشهرين (تجاوز الأخص)
  const night1 = await trx
    .selectFrom('employees')
    .select('id')
    .where('companyId', '=', companyId)
    .where('employeeNo', '=', `${DEMO_PREFIX}010`)
    .executeTakeFirst();
  if (night1) await assign(guard, 'employee', night1.id, isoDay(-30), isoDay(30));
  return undefined;
};

/** بصمات الأسبوعين الماضيين: التزام وتأخير وخروج مبكر وغياب ووردية ليلية، ثم الاحتساب وتجاوز مفتوح. */
const seedPunches = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('attendanceRecords')
    .select('id')
    .where('companyId', '=', companyId)
    .where('note', '=', 'DEMO')
    .limit(1)
    .executeTakeFirst();
  if (marker) return 'skip';
  const hasShifts = await trx
    .selectFrom('shifts')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-DAY')
    .executeTakeFirst();
  if (!hasShifts) return 'skip لا جداول حضور';

  const emps = await trx
    .selectFrom('employees as e')
    .leftJoin('employments as m', (j) =>
      j.onRef('m.employeeId', '=', 'e.id').on('m.validTo', 'is', null),
    )
    .leftJoin('departments as d', 'd.id', 'm.departmentId')
    .select(['e.id', 'e.employeeNo', 'd.code as deptCode'])
    .where('e.companyId', '=', companyId)
    .where('e.status', '=', 'active')
    .where('e.employeeNo', 'like', `${DEMO_PREFIX}%`)
    .orderBy('e.employeeNo')
    .execute();

  const addMin = (hhmm: string, delta: number): string => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    const t = h * 60 + m + delta;
    return `${pad(Math.floor(t / 60), 2)}:${pad(t % 60, 2)}`;
  };
  const plus1 = (d: string) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);
  type Row = { employeeId: string; date: string; time: string };
  const rows: Row[] = [];
  emps.forEach((e, i) => {
    const night = e.employeeNo === `${DEMO_PREFIX}010`;
    const [start, end] = night
      ? ['22:00', '06:00']
      : e.deptCode === 'DEMO-SAL'
        ? ['08:00', '20:00']
        : ['08:00', '16:00'];
    for (let back = 14; back >= 1; back--) {
      const date = isoDay(-back);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() > 4) continue; // الجمعة والسبت راحة
      const k = i * 3 + back;
      if (k % 13 === 0) continue; // غياب
      const late = k % 5 === 0 ? 25 : (k % 4) - 1; // تأخير واضح أو فرق بسيط
      const early = k % 11 === 0 ? -40 : (k % 3) - 1;
      rows.push({ employeeId: e.id, date, time: addMin(start, late) });
      rows.push({
        employeeId: e.id,
        date: night ? plus1(date) : date,
        time: addMin(end, early),
      });
    }
  });
  const tz = (
    await trx
      .selectFrom('companies')
      .select('timezone')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow()
  ).timezone;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await sql`insert into attendance_records (company_id, employee_id, punched_at, source, note)
      select ${companyId}, v.employee_id::uuid, ((v.d::date + v.t::time) at time zone ${tz}), 'manual', 'DEMO'
        from (values ${sql.join(
          chunk.map((r) => sql`(${r.employeeId}, ${r.date}, ${r.time})`),
        )}) as v(employee_id, d, t)
      on conflict do nothing`.execute(trx);
  }
  await recomputeDays(ctx, 'all', isoDay(-14), isoDay(-1));

  // تجاوز مفتوح: غياب محتسب يحوّله الموارد البشرية إلى حضور (مع ملاحظة)
  const absent = await trx
    .selectFrom('attendanceDays')
    .select(['id', 'status', 'workedMinutes'])
    .where('companyId', '=', companyId)
    .where('status', '=', 'absent')
    .orderBy('dayDate', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (absent)
    await trx
      .updateTable('attendanceDays')
      .set({
        overrideStatus: 'present',
        overrideNote: 'عطل في جهاز البصمة (بيانات تجريبية)',
        overrideAt: new Date(),
        baselineStatus: absent.status,
        baselineWorked: absent.workedMinutes,
      })
      .where('id', '=', absent.id)
      .execute();
  return undefined;
};

/**
 * يضيف طبقات البيانات التجريبية الموسَّعة فوق الأساس. كل طبقة آمنة لإعادة التشغيل (لها علامة)،
 * فتُضاف الطبقات الجديدة فقط على قاعدة بُذرت سابقاً. كل طبقة في معاملة مستقلة.
 */
export const seedDemoExtras = async (
  db: Db,
  companyId: string,
  opts: { crypto?: FieldCrypto | undefined; password: string },
): Promise<ExtrasResult> => {
  const out: ExtrasResult = [];
  const parts: [ExtrasPart, (ctx: Ctx) => Promise<string | undefined>][] = [
    ['details', (ctx) => seedDetails(ctx, opts.crypto)],
    ['lifecycle', (ctx) => seedLifecycle(ctx)],
    ['archive', (ctx) => seedArchive(ctx, opts.crypto)],
    ['approvals', (ctx) => seedApprovals(ctx, opts.password)],
    ['leave', (ctx) => seedLeave(ctx)],
    ['attendance', (ctx) => seedAttendance(ctx)],
    ['punches', (ctx) => seedPunches(ctx)],
  ];
  for (const [part, fn] of parts) {
    const note = await withTenant(db, { companyId, requestId: 'cli' }, fn);
    if (note?.startsWith('skip'))
      out.push({ part, status: 'skipped', note: note.slice(5) || undefined });
    else out.push({ part, status: 'done', note });
  }
  return out;
};
