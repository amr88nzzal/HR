import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import { createApprovalEngine } from '../approvals/index.js';
import { loadFields, syncReminders } from '../modules/archive/documents.routes.js';
import { prepareValues } from '../modules/archive/field-values.js';
import { maskIban } from '../modules/employees/bank.routes.js';
import { prepareCustomFields } from '../modules/employees/custom-fields.js';
import { applyChange } from '../modules/employees/employments.routes.js';
import { hashPassword } from '../modules/identity/index.js';
import { createNotifier } from '../notifications/index.js';
import type { FieldCrypto } from '../shared/crypto.js';
import { DEMO_EMAIL_DOMAIN, DEMO_PREFIX } from './demo.js';

export type ExtrasPart = 'details' | 'lifecycle' | 'archive' | 'approvals';
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
  ];
  for (const [part, fn] of parts) {
    const note = await withTenant(db, { companyId, requestId: 'cli' }, fn);
    if (note?.startsWith('skip'))
      out.push({ part, status: 'skipped', note: note.slice(5) || undefined });
    else out.push({ part, status: 'done', note });
  }
  return out;
};
