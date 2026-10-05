import { Router, type RequestHandler } from 'express';
import { sql } from 'kysely';
import {
  changeInput,
  type ApiEnvelope,
  type ChangeInput,
  type EmploymentFields,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission, type AuthContext } from '../identity/index.js';
import { assertEmployeeVisible } from './access.js';
import { idOf, makeRun } from './children.routes.js';

type Row = Record<string, unknown>;

const FIELD_KEYS = [
  'contractId',
  'branchId',
  'departmentId',
  'jobTitleId',
  'jobGradeId',
  'managerEmployeeId',
  'costCenterId',
  'workLocationId',
  'employmentType',
  'workMode',
  'workCountry',
] as const;

const bad = (code: string, message: string, status = 400) => new AppError(code, status, message);

const todayOf = async (ctx: Ctx): Promise<string> => {
  const { rows } = await sql<{
    d: string;
  }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx);
  return rows[0]?.d as string;
};

const dayBefore = async (ctx: Ctx, date: string): Promise<string> => {
  const { rows } = await sql<{ d: string }>`select (${date}::date - 1)::text as d`.execute(ctx.trx);
  return rows[0]?.d as string;
};

const exists = async (ctx: Ctx, table: string, id: string): Promise<boolean> => {
  const { rows } = await sql<{
    n: number;
  }>`select 1 as n from ${sql.table(table)} where id = ${id}`.execute(ctx.trx);
  return rows.length > 0;
};

/** يتحقق أن كل مرجع موجود ضمن الشركة (RLS) ويخص الموظف/غير منتهٍ حيث يلزم. */
const validateRefs = async (
  ctx: Ctx,
  employeeId: string,
  f: Partial<EmploymentFields>,
): Promise<void> => {
  const checks: [string, string | null | undefined, string][] = [
    ['branches', f.branchId, 'الفرع'],
    ['departments', f.departmentId, 'القسم'],
    ['job_titles', f.jobTitleId, 'المسمى الوظيفي'],
    ['job_grades', f.jobGradeId, 'الدرجة الوظيفية'],
    ['cost_centers', f.costCenterId, 'مركز التكلفة'],
    ['work_locations', f.workLocationId, 'موقع العمل'],
  ];
  for (const [table, id, label] of checks) {
    if (id && !(await exists(ctx, table, id))) {
      throw bad('INVALID_REFERENCE', `${label} غير موجود ضمن الشركة`);
    }
  }
  if (f.contractId) {
    const { rows } =
      await sql`select 1 from contracts where id = ${f.contractId} and employee_id = ${employeeId}`.execute(
        ctx.trx,
      );
    if (!rows.length) throw bad('INVALID_REFERENCE', 'العقد غير موجود لهذا الموظف');
  }
  if (f.managerEmployeeId) {
    if (f.managerEmployeeId === employeeId)
      throw bad('INVALID_MANAGER', 'لا يمكن أن يكون الموظف مديراً لنفسه');
    const { rows } = await sql<{
      status: string;
    }>`select status from employees where id = ${f.managerEmployeeId}`.execute(ctx.trx);
    if (!rows.length) throw bad('INVALID_REFERENCE', 'المدير المباشر غير موجود ضمن الشركة');
    if (rows[0]?.status === 'terminated')
      throw bad('INVALID_MANAGER', 'المدير المباشر منتهي الخدمة');
  }
};

const assertDepartmentInBranch = async (ctx: Ctx, departmentId: string, branchId: string) => {
  const { rows } =
    await sql`select 1 from department_branches where department_id = ${departmentId} and branch_id = ${branchId}`.execute(
      ctx.trx,
    );
  if (!rows.length) throw bad('DEPARTMENT_NOT_IN_BRANCH', 'القسم غير متاح في الفرع المختار');
};

const pickFields = (row: Row): Partial<EmploymentFields> => {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) out[k] = row[k] ?? null;
  return out as Partial<EmploymentFields>;
};

const insertEmployment = async (
  ctx: Ctx,
  employeeId: string,
  f: Partial<EmploymentFields>,
  validFrom: string,
) => {
  if (!f.branchId || !f.departmentId || !f.employmentType) {
    throw bad('MISSING_FIELDS', 'الفرع والقسم ونوع التوظيف حقول مطلوبة');
  }
  await assertDepartmentInBranch(ctx, f.departmentId, f.branchId);
  return ctx.trx
    .insertInto('employments')
    .values({
      companyId: ctx.companyId,
      employeeId,
      contractId: f.contractId ?? null,
      branchId: f.branchId,
      departmentId: f.departmentId,
      jobTitleId: f.jobTitleId ?? null,
      jobGradeId: f.jobGradeId ?? null,
      managerEmployeeId: f.managerEmployeeId ?? null,
      costCenterId: f.costCenterId ?? null,
      workLocationId: f.workLocationId ?? null,
      employmentType: f.employmentType,
      workMode: f.workMode ?? 'onsite',
      workCountry: f.workCountry ?? null,
      validFrom,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

const stripCompany = <T extends Row>(row: T): T => {
  const rest = { ...row };
  delete rest['companyId'];
  return rest;
};

/** يطبّق حدث تغيير على الموظف داخل معاملة واحدة، ويحفظ التاريخ بإغلاق التعيين القديم وفتح جديد. */
export const applyChange = async (
  ctx: Ctx,
  employeeId: string,
  input: ChangeInput,
): Promise<{ change: Row; employment: Row | null; status: string }> => {
  const emp = await ctx.trx
    .selectFrom('employees')
    .select(['id', 'status', 'firstHireDate'])
    .where('id', '=', employeeId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const today = await todayOf(ctx);
  const eff = input.effectiveDate;
  if (Number.isNaN(Date.parse(`${eff}T00:00:00Z`)))
    throw bad('INVALID_DATE', 'تاريخ السريان غير صالح');

  const latest = await ctx.trx
    .selectFrom('employments')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .orderBy('validFrom', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (input.reasonId) {
    const r = await ctx.trx
      .selectFrom('changeReasons')
      .select('changeType')
      .where('id', '=', input.reasonId)
      .executeTakeFirst();
    if (!r) throw bad('INVALID_REFERENCE', 'سبب التغيير غير موجود');
    if (r.changeType !== input.changeType)
      throw bad('INVALID_REASON', 'سبب التغيير لا يناسب نوع الحدث');
  }
  const payload = input.employment;
  await validateRefs(ctx, employeeId, payload);

  const fromId: string | null = latest?.id ?? null;
  let toId: string | null = null;
  let employment: Row | null = null;
  let newStatus = emp.status;

  const isOpen = latest && latest.validTo === null;

  switch (input.changeType) {
    case 'hire': {
      if (latest && !(emp.status === 'terminated' && latest.validTo && eff > latest.validTo)) {
        throw bad('ALREADY_EMPLOYED', 'الموظف معيَّن بالفعل، استخدم نقل أو ترقية', 409);
      }
      const created = await insertEmployment(ctx, employeeId, payload, eff);
      toId = created.id;
      employment = created;
      newStatus = 'active';
      await ctx.trx
        .updateTable('employees')
        .set({
          status: 'active',
          firstHireDate: emp.firstHireDate ?? eff,
          version: sql`version + 1`,
        })
        .where('id', '=', employeeId)
        .execute();
      break;
    }
    case 'transfer':
    case 'promotion':
    case 'manager_change': {
      if (!latest || !isOpen) throw bad('NOT_EMPLOYED', 'لا يوجد تعيين قائم لهذا الموظف', 409);
      if (emp.status === 'terminated') throw bad('NOT_EMPLOYED', 'الموظف منتهي الخدمة', 409);
      if (eff <= latest.validFrom) {
        throw bad('INVALID_EFFECTIVE_DATE', 'تاريخ السريان يجب أن يلي بداية التعيين الحالي');
      }
      const has = (k: keyof EmploymentFields) => k in payload;
      const ok =
        input.changeType === 'transfer'
          ? has('branchId') || has('departmentId') || has('workLocationId')
          : input.changeType === 'promotion'
            ? has('jobTitleId') || has('jobGradeId')
            : has('managerEmployeeId');
      if (!ok) throw bad('MISSING_FIELDS', 'لا توجد حقول تتوافق مع نوع التغيير');
      const merged = { ...pickFields(latest), ...payload };
      await ctx.trx
        .updateTable('employments')
        .set({ validTo: await dayBefore(ctx, eff), version: sql`version + 1` })
        .where('id', '=', latest.id)
        .execute();
      const created = await insertEmployment(ctx, employeeId, merged, eff);
      toId = created.id;
      employment = created;
      break;
    }
    case 'suspension': {
      if (emp.status !== 'active') throw bad('INVALID_STATE', 'يمكن إيقاف الموظف الفعّال فقط', 409);
      if (eff > today)
        throw bad('FUTURE_STATUS_CHANGE', 'لا يُدعم تغيير الحالة بتاريخ مستقبلي حالياً');
      newStatus = 'suspended';
      await ctx.trx
        .updateTable('employees')
        .set({ status: 'suspended', version: sql`version + 1` })
        .where('id', '=', employeeId)
        .execute();
      break;
    }
    case 'reinstatement': {
      if (emp.status !== 'suspended')
        throw bad('INVALID_STATE', 'يمكن إعادة تفعيل الموظف الموقوف فقط', 409);
      if (eff > today)
        throw bad('FUTURE_STATUS_CHANGE', 'لا يُدعم تغيير الحالة بتاريخ مستقبلي حالياً');
      newStatus = 'active';
      await ctx.trx
        .updateTable('employees')
        .set({ status: 'active', version: sql`version + 1` })
        .where('id', '=', employeeId)
        .execute();
      break;
    }
    case 'termination': {
      if (emp.status === 'terminated') throw bad('INVALID_STATE', 'خدمة الموظف منتهية بالفعل', 409);
      if (!latest || !isOpen) throw bad('NOT_EMPLOYED', 'لا يوجد تعيين قائم لهذا الموظف', 409);
      if (eff > today)
        throw bad('FUTURE_STATUS_CHANGE', 'لا يُدعم تغيير الحالة بتاريخ مستقبلي حالياً');
      if (eff < latest.validFrom)
        throw bad('INVALID_EFFECTIVE_DATE', 'تاريخ الإنهاء قبل بداية التعيين الحالي');
      await ctx.trx
        .updateTable('employments')
        .set({ validTo: eff, version: sql`version + 1` })
        .where('id', '=', latest.id)
        .execute();
      await ctx.trx
        .updateTable('contracts')
        .set({ status: 'terminated', endDate: eff, version: sql`version + 1` })
        .where('employeeId', '=', employeeId)
        .where('status', '=', 'active')
        .where((eb) => eb.or([eb('endDate', 'is', null), eb('endDate', '>', eff)]))
        .execute();
      newStatus = 'terminated';
      await ctx.trx
        .updateTable('employees')
        .set({ status: 'terminated', version: sql`version + 1` })
        .where('id', '=', employeeId)
        .execute();
      break;
    }
  }

  const change = await ctx.trx
    .insertInto('employmentChanges')
    .values({
      companyId: ctx.companyId,
      employeeId,
      changeType: input.changeType,
      effectiveDate: eff,
      reasonId: input.reasonId ?? null,
      notes: input.notes ?? null,
      fromEmploymentId: fromId,
      toEmploymentId: toId,
      createdBy: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    change: stripCompany(change as Row),
    employment: employment ? stripCompany(employment) : null,
    status: newStatus,
  };
};

export const createEmploymentsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router({ mergeParams: true });
  const run = makeRun(db);
  const READ = 'employees.employment.read';
  const MANAGE = 'employees.employment.manage';

  router.get('/employments', authenticate, requirePermission(READ), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const rows = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, READ);
        return ctx.trx
          .selectFrom('employments as e')
          .leftJoin('branches as b', 'b.id', 'e.branchId')
          .leftJoin('departments as d', 'd.id', 'e.departmentId')
          .leftJoin('jobTitles as t', 't.id', 'e.jobTitleId')
          .leftJoin('jobGrades as g', 'g.id', 'e.jobGradeId')
          .leftJoin('employees as m', 'm.id', 'e.managerEmployeeId')
          .select([
            'e.id',
            'e.contractId',
            'e.branchId',
            'b.nameAr as branchNameAr',
            'e.departmentId',
            'd.nameAr as departmentNameAr',
            'e.jobTitleId',
            't.nameAr as jobTitleNameAr',
            'e.jobGradeId',
            'g.nameAr as jobGradeNameAr',
            'e.managerEmployeeId',
            'm.fullNameAr as managerNameAr',
            'e.costCenterId',
            'e.workLocationId',
            'e.employmentType',
            'e.workMode',
            'e.workCountry',
            'e.validFrom',
            'e.validTo',
            'e.version',
          ])
          .where('e.employeeId', '=', employeeId)
          .orderBy('e.validFrom', 'desc')
          .execute();
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/changes', authenticate, requirePermission(READ), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const rows = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, READ);
        return ctx.trx
          .selectFrom('employmentChanges as c')
          .leftJoin('changeReasons as r', 'r.id', 'c.reasonId')
          .leftJoin('users as u', 'u.id', 'c.createdBy')
          .select([
            'c.id',
            'c.changeType',
            'c.effectiveDate',
            'c.reasonId',
            'r.nameAr as reasonNameAr',
            'c.notes',
            'c.fromEmploymentId',
            'c.toEmploymentId',
            'u.displayName as createdByName',
            'c.createdAt',
          ])
          .where('c.employeeId', '=', employeeId)
          .orderBy('c.effectiveDate', 'desc')
          .orderBy('c.createdAt', 'desc')
          .execute();
      });
      const body: ApiEnvelope<typeof rows> = { data: rows };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/changes', authenticate, requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const input = changeInput.parse(req.body);
      const out = await run(req, async (ctx: Ctx, auth: AuthContext) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        return applyChange(ctx, employeeId, input);
      });
      res.status(201).json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
