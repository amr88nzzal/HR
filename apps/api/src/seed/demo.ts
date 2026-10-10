import type { Ctx } from '../db/tenant.js';
import { applyChange } from '../modules/employees/employments.routes.js';
import { insertEmployee } from '../modules/employees/employees.routes.js';
import { seedDefaultExternalSystems } from '../modules/employees/external.routes.js';
import { hashPassword, seedDefaultRoles } from '../modules/identity/index.js';

/** بادئة الرقم الوظيفي للبيانات التجريبية؛ وجود أي موظف بها يعني أن البذر تم سابقاً. */
export const DEMO_PREFIX = 'DEMO-';
export const DEMO_EMAIL_DOMAIN = 'demo.hrms.local';

export type DemoUser = { email: string; role: string; employeeNo: string };
export type DemoResult = { skipped: boolean; employees: number; users: DemoUser[] };

const BRANCHES = [
  { code: 'DEMO-AMM', nameAr: 'فرع عمّان', nameEn: 'Amman Branch', city: 'Amman' },
  { code: 'DEMO-IRB', nameAr: 'فرع إربد', nameEn: 'Irbid Branch', city: 'Irbid' },
] as const;

const DEPARTMENTS = [
  { code: 'DEMO-MGT', nameAr: 'الإدارة العامة', nameEn: 'Management', branches: [0] },
  { code: 'DEMO-HR', nameAr: 'الموارد البشرية', nameEn: 'Human Resources', branches: [0] },
  { code: 'DEMO-FIN', nameAr: 'المالية', nameEn: 'Finance', branches: [0] },
  { code: 'DEMO-IT', nameAr: 'تقنية المعلومات', nameEn: 'IT', branches: [0, 1] },
  { code: 'DEMO-SAL', nameAr: 'المبيعات', nameEn: 'Sales', branches: [0, 1] },
] as const;

const GRADES = [
  { code: 'DEMO-G1', nameAr: 'مبتدئ', nameEn: 'Junior', level: 1 },
  { code: 'DEMO-G2', nameAr: 'متوسط', nameEn: 'Mid', level: 2 },
  { code: 'DEMO-G3', nameAr: 'أول', nameEn: 'Senior', level: 3 },
  { code: 'DEMO-G4', nameAr: 'إدارة', nameEn: 'Management', level: 4 },
] as const;

const TITLES = [
  { code: 'DEMO-CEO', nameAr: 'المدير العام', nameEn: 'General Manager', grade: 3 },
  { code: 'DEMO-HEAD', nameAr: 'رئيس قسم', nameEn: 'Department Head', grade: 3 },
  { code: 'DEMO-SPEC', nameAr: 'أخصائي', nameEn: 'Specialist', grade: 2 },
  { code: 'DEMO-OFF', nameAr: 'موظف', nameEn: 'Officer', grade: 1 },
] as const;

const MALE = ['محمد', 'أحمد', 'خالد', 'عمر', 'يوسف', 'سامر', 'ليث', 'فادي', 'طارق', 'زياد'];
const FEMALE = ['سارة', 'ليلى', 'رنا', 'دانا', 'هبة', 'نور', 'ريم', 'لينا'];
const MALE_EN = [
  'Mohammad',
  'Ahmad',
  'Khaled',
  'Omar',
  'Yousef',
  'Samer',
  'Laith',
  'Fadi',
  'Tariq',
  'Ziad',
];
const FEMALE_EN = ['Sara', 'Layla', 'Rana', 'Dana', 'Heba', 'Nour', 'Reem', 'Lina'];
const FAMILIES = [
  ['الخطيب', 'Khatib'],
  ['النابلسي', 'Nabulsi'],
  ['حداد', 'Haddad'],
  ['المصري', 'Masri'],
  ['العلي', 'Ali'],
  ['القاسم', 'Qasem'],
] as const;

const EMPLOYEE_COUNT = 30;

const pad = (n: number, w = 3) => String(n).padStart(w, '0');

/**
 * يبذر شركة ببيانات تجريبية (فروع، أقسام، درجات ومسميات، موظفون بسلاسل مديرين، تعيينات، عقود،
 * جهات اتصال، مراجع خارجية، وثلاثة مستخدمين). آمن لإعادة التشغيل: يتوقف إن وُجدت بيانات تجريبية.
 * يعمل داخل معاملة المستأجر (ctx) ويستخدم نفس مسارات الإدراج الفعلية للتطبيق.
 */
export const seedDemo = async (ctx: Ctx, password: string): Promise<DemoResult> => {
  const { trx, companyId } = ctx;
  const existing = await trx
    .selectFrom('employees')
    .select('id')
    .where('companyId', '=', companyId)
    .where('employeeNo', 'like', `${DEMO_PREFIX}%`)
    .limit(1)
    .executeTakeFirst();
  if (existing) return { skipped: true, employees: 0, users: [] };

  await seedDefaultRoles(ctx);
  await seedDefaultExternalSystems(ctx);

  // ── الهيكل التنظيمي ──
  const branchIds: string[] = [];
  for (const b of BRANCHES) {
    const row = await trx
      .insertInto('branches')
      .values({
        companyId,
        code: b.code,
        nameAr: b.nameAr,
        nameEn: b.nameEn,
        country: 'JO',
        city: b.city,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    branchIds.push(row.id);
    await trx
      .insertInto('workLocations')
      .values({
        companyId,
        branchId: row.id,
        code: `${b.code}-HQ`,
        nameAr: `مقر ${b.nameAr}`,
        nameEn: `${b.nameEn} Office`,
      })
      .execute();
  }
  const workLocations = await trx
    .selectFrom('workLocations')
    .select(['id', 'branchId'])
    .where('companyId', '=', companyId)
    .where('code', 'like', 'DEMO-%')
    .execute();

  const deptIds: string[] = [];
  for (const d of DEPARTMENTS) {
    const row = await trx
      .insertInto('departments')
      .values({ companyId, code: d.code, nameAr: d.nameAr, nameEn: d.nameEn })
      .returning('id')
      .executeTakeFirstOrThrow();
    deptIds.push(row.id);
    for (const bi of d.branches) {
      await trx
        .insertInto('departmentBranches')
        .values({ companyId, departmentId: row.id, branchId: branchIds[bi] as string })
        .execute();
    }
  }
  const costCenterIds: string[] = [];
  for (const d of DEPARTMENTS) {
    const row = await trx
      .insertInto('costCenters')
      .values({
        companyId,
        code: `CC-${d.code}`,
        nameAr: `مركز تكلفة ${d.nameAr}`,
        nameEn: `${d.nameEn} CC`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    costCenterIds.push(row.id);
  }
  const gradeIds: string[] = [];
  for (const g of GRADES) {
    const row = await trx
      .insertInto('jobGrades')
      .values({ companyId, code: g.code, nameAr: g.nameAr, nameEn: g.nameEn, level: g.level })
      .returning('id')
      .executeTakeFirstOrThrow();
    gradeIds.push(row.id);
  }
  const titleIds: string[] = [];
  for (const t of TITLES) {
    const row = await trx
      .insertInto('jobTitles')
      .values({
        companyId,
        code: t.code,
        nameAr: t.nameAr,
        nameEn: t.nameEn,
        jobGradeId: gradeIds[t.grade] as string,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    titleIds.push(row.id);
  }
  const hireReason = await trx
    .insertInto('changeReasons')
    .values({
      companyId,
      code: 'DEMO-HIRE',
      changeType: 'hire',
      nameAr: 'تعيين جديد',
      nameEn: 'New hire',
    })
    .onConflict((oc) => oc.columns(['companyId', 'code']).doNothing())
    .returning('id')
    .executeTakeFirst();
  const accounting = await trx
    .selectFrom('externalSystems')
    .select('id')
    .where('companyId', '=', companyId)
    .where('key', '=', 'accounting')
    .executeTakeFirstOrThrow();
  const device = await trx
    .selectFrom('externalSystems')
    .select('id')
    .where('companyId', '=', companyId)
    .where('key', '=', 'attendance_device')
    .executeTakeFirstOrThrow();

  // ── الموظفون: الأول مدير عام، ثم رئيس لكل قسم، والباقي موظفون تحت رؤساء الأقسام ──
  const employeeIds: string[] = [];
  const deptHeadIdx = [-1, 1, 2, 3, 4]; // فهرس موظف رئيس كل قسم (القسم 0 يرأسه المدير العام)
  const used: { no: string; deptIdx: number }[] = [];
  for (let i = 0; i < EMPLOYEE_COUNT; i += 1) {
    const female = i % 3 === 2;
    const n = Math.floor(i / 2);
    const family = FAMILIES[i % FAMILIES.length] as readonly [string, string];
    const father = MALE[(i + 3) % MALE.length] as string;
    const fatherEn = MALE_EN[(i + 3) % MALE_EN.length] as string;
    const first = female
      ? (FEMALE[n % FEMALE.length] as string)
      : (MALE[n % MALE.length] as string);
    const firstEn = female
      ? (FEMALE_EN[n % FEMALE_EN.length] as string)
      : (MALE_EN[n % MALE_EN.length] as string);
    const employeeNo = `${DEMO_PREFIX}${pad(i + 1)}`;
    const deptIdx = i === 0 ? 0 : i <= 4 ? i : 1 + ((i - 5) % 4);
    const hireDate = `${2021 + (i % 5)}-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`;
    const emp = await insertEmployee(
      ctx,
      {
        firstNameAr: first,
        fatherNameAr: father,
        familyNameAr: family[0],
        firstNameEn: firstEn,
        fatherNameEn: fatherEn,
        familyNameEn: family[1],
        birthDate: `${1975 + ((i * 3) % 25)}-${pad((i % 12) + 1, 2)}-${pad(((i * 5) % 27) + 1, 2)}`,
        gender: female ? 'female' : 'male',
        maritalStatus: i % 2 === 0 ? 'married' : 'single',
        nationality: 'JO',
        firstHireDate: hireDate,
      },
      employeeNo,
      {},
    );
    employeeIds.push(emp.id);
    used.push({ no: employeeNo, deptIdx });

    // تعيين
    const branchIdx = DEPARTMENTS[deptIdx]?.branches.includes(1 as never) && i % 2 === 1 ? 1 : 0;
    const managerIdx = i === 0 ? null : i <= 4 ? 0 : (deptHeadIdx[deptIdx] as number);
    const contract = await trx
      .insertInto('contracts')
      .values({
        companyId,
        employeeId: emp.id,
        contractType: 'permanent',
        startDate: hireDate,
        probationEndDate: null,
        noticeDays: 30,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const titleIdx = i === 0 ? 0 : i <= 4 ? 1 : i % 3 === 0 ? 2 : 3;
    await applyChange(ctx, emp.id, {
      changeType: 'hire',
      effectiveDate: hireDate,
      reasonId: hireReason?.id ?? null,
      employment: {
        contractId: contract.id,
        branchId: branchIds[branchIdx] as string,
        departmentId: deptIds[deptIdx] as string,
        jobTitleId: titleIds[titleIdx] as string,
        jobGradeId: gradeIds[TITLES[titleIdx]?.grade ?? 0] as string,
        managerEmployeeId: managerIdx === null ? null : (employeeIds[managerIdx] ?? null),
        costCenterId: costCenterIds[deptIdx] as string,
        workLocationId: workLocations.find((w) => w.branchId === branchIds[branchIdx])?.id ?? null,
        employmentType: 'full_time',
        workMode: 'onsite',
        workCountry: 'JO',
      },
    });

    // جهات اتصال ومراجع خارجية
    await trx
      .insertInto('employeeContacts')
      .values([
        {
          companyId,
          employeeId: emp.id,
          type: 'mobile',
          value: `+96279${pad(1000000 + i * 137, 7)}`,
          contactName: null,
          relation: null,
          isPrimary: true,
        },
        {
          companyId,
          employeeId: emp.id,
          type: 'email',
          value: `${employeeNo.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`,
          contactName: null,
          relation: null,
          isPrimary: true,
        },
      ])
      .execute();
    await trx
      .insertInto('employeeExternalRefs')
      .values([
        { companyId, employeeId: emp.id, systemId: accounting.id, value: `ACC-${pad(i + 1, 4)}` },
        {
          companyId,
          employeeId: emp.id,
          systemId: device.id,
          value: String(100 + i),
          branchId: branchIds[branchIdx] as string,
        },
      ])
      .execute();
  }

  // ── المستخدمون ──
  const roleId = async (code: string) =>
    (
      await trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', companyId)
        .where('code', '=', code)
        .executeTakeFirstOrThrow()
    ).id;
  const passwordHash = await hashPassword(password);
  const plan = [
    { key: 'hr', role: 'hr_manager', empIdx: 1, scope: 'company' as const },
    { key: 'manager', role: 'manager', empIdx: 4, scope: 'department' as const },
    { key: 'employee', role: 'employee', empIdx: 9, scope: 'self' as const },
  ];
  const users: DemoUser[] = [];
  for (const p of plan) {
    const empId = employeeIds[p.empIdx] as string;
    const email = `demo.${p.key}@${DEMO_EMAIL_DOMAIN}`;
    const emp = await trx
      .selectFrom('employees')
      .select(['fullNameAr', 'employeeNo'])
      .where('id', '=', empId)
      .executeTakeFirstOrThrow();
    const user = await trx
      .insertInto('users')
      .values({ companyId, email, displayName: emp.fullNameAr, passwordHash })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('userRoleAssignments')
      .values({
        companyId,
        userId: user.id,
        roleId: await roleId(p.role),
        scopeType: p.scope,
        scopeId:
          p.scope === 'department' ? (deptIds[used[p.empIdx]?.deptIdx ?? 0] as string) : null,
      })
      .execute();
    await trx.updateTable('employees').set({ userId: user.id }).where('id', '=', empId).execute();
    users.push({ email, role: p.role, employeeNo: emp.employeeNo });
  }
  return { skipped: false, employees: EMPLOYEE_COUNT, users };
};
