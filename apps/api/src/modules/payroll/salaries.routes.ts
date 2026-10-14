import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { employeeSalaryInput, employeeSalaryUpdate } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { assertEmployeeVisible } from '../employees/index.js';
import { requirePermission } from '../identity/index.js';
import { makeRun } from './setup.routes.js';

const READ = 'payroll.salary.read';
const MANAGE = 'payroll.salary.manage';
const uuid = z.string().uuid();
const params = z.object({ employeeId: uuid, salaryId: uuid.optional() });
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');

type CompInput = z.infer<typeof employeeSalaryInput>['components'];

const loadRows = async (ctx: Ctx, employeeId: string, salaryId?: string) => {
  const { rows } = await sql<Record<string, unknown>>`
    select s.id, s.employee_id, s.structure_id, st.name_ar as structure_name, s.currency, s.basic_amount,
           s.valid_from::text as valid_from, s.valid_to::text as valid_to, s.note, s.version, s.created_at,
           coalesce(jsonb_agg(jsonb_build_object('componentId', c.component_id, 'amount', c.amount::text, 'percent', c.percent::text))
                    filter (where c.id is not null), '[]') as components
      from employee_salaries s
      left join salary_structures st on st.id = s.structure_id
      left join employee_salary_components c on c.employee_salary_id = s.id
     where s.company_id = ${ctx.companyId} and s.employee_id = ${employeeId}
       ${salaryId ? sql`and s.id = ${salaryId}` : sql``}
     group by s.id, st.name_ar order by s.valid_from desc`.execute(ctx.trx);
  return rows;
};

const setComponents = async (ctx: Ctx, salaryId: string, comps: CompInput) => {
  const ids = comps.map((c) => c.componentId);
  if (new Set(ids).size !== ids.length)
    throw new AppError('DUPLICATE_COMPONENT', 400, 'مكوّن مكرر');
  if (ids.length) {
    const found = await ctx.trx
      .selectFrom('payComponents')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('id', 'in', ids)
      .execute();
    if (found.length !== ids.length)
      throw new AppError('INVALID_REFERENCE', 400, 'مكوّن غير موجود ضمن الشركة');
  }
  await ctx.trx
    .deleteFrom('employeeSalaryComponents')
    .where('employeeSalaryId', '=', salaryId)
    .execute();
  if (comps.length)
    await ctx.trx
      .insertInto('employeeSalaryComponents')
      .values(
        comps.map((c) => ({
          companyId: ctx.companyId,
          employeeSalaryId: salaryId,
          componentId: c.componentId,
          amount: c.amount ?? null,
          percent: c.percent ?? null,
        })),
      )
      .execute();
};

/** رواتب الموظف بخط زمني: كل راتب جديد يُنهي السابق قبل تاريخ سريانه بيوم. */
export const createSalariesRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router({ mergeParams: true });
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/',
    requirePermission(READ),
    wrap(async (req, res) => {
      const { employeeId } = params.parse(req.params);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, employeeId, READ);
        return loadRows(ctx, employeeId);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const { employeeId } = params.parse(req.params);
      const b = employeeSalaryInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        // قفل صف الموظف لتسلسل الإضافات المتزامنة
        await ctx.trx
          .selectFrom('employees')
          .select('id')
          .where('id', '=', employeeId)
          .forUpdate()
          .execute();
        if (b.structureId) {
          const st = await ctx.trx
            .selectFrom('salaryStructures')
            .select(['currency', 'isActive'])
            .where('id', '=', b.structureId)
            .executeTakeFirst();
          if (!st) throw new AppError('INVALID_REFERENCE', 400, 'الهيكل غير موجود');
          if (!st.isActive) throw new AppError('STRUCTURE_INACTIVE', 409, 'الهيكل معطّل');
          if (st.currency && st.currency !== b.currency)
            throw new AppError(
              'CURRENCY_MISMATCH',
              400,
              `عملة الهيكل ${st.currency} تخالف عملة الراتب`,
            );
        }
        const cur = await ctx.trx
          .selectFrom('currencies')
          .select('id')
          .where('companyId', '=', ctx.companyId)
          .where('code', '=', b.currency)
          .executeTakeFirst();
        if (!cur) throw new AppError('INVALID_REFERENCE', 400, 'العملة غير معرّفة في الشركة');
        const last = await ctx.trx
          .selectFrom('employeeSalaries')
          .select(['id', 'validFrom', 'validTo'])
          .where('employeeId', '=', employeeId)
          .orderBy('validFrom', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (last) {
          const from = String(last.validFrom).slice(0, 10);
          if (b.validFrom <= from)
            throw new AppError(
              'SALARY_DATE_ORDER',
              409,
              'تاريخ السريان يجب أن يلي تاريخ آخر راتب مسجّل',
            );
          if (last.validTo === null)
            await ctx.trx
              .updateTable('employeeSalaries')
              .set({ validTo: sql`${b.validFrom}::date - 1`, version: sql`version + 1` })
              .where('id', '=', last.id)
              .execute();
          else if (String(last.validTo).slice(0, 10) >= b.validFrom)
            throw new AppError('SALARY_OVERLAP', 409, 'يتداخل مع راتب سابق');
        }
        const row = await ctx.trx
          .insertInto('employeeSalaries')
          .values({
            companyId: ctx.companyId,
            employeeId,
            structureId: b.structureId ?? null,
            currency: b.currency,
            basicAmount: b.basicAmount,
            validFrom: b.validFrom,
            note: b.note ?? null,
            createdBy: ctx.userId ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await setComponents(ctx, row.id, b.components);
        return (await loadRows(ctx, employeeId, row.id))[0];
      });
      res.status(201).json({ data });
    }),
  );

  router.patch(
    '/:salaryId',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const { employeeId, salaryId } = params.parse(req.params);
      if (!salaryId) throw notFound();
      const b = employeeSalaryUpdate.parse(req.body);
      const touch = (req.body as Record<string, unknown>)['components'] !== undefined;
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const upd = await ctx.trx
          .updateTable('employeeSalaries')
          .set({
            ...(b.basicAmount !== undefined && { basicAmount: b.basicAmount }),
            ...(b.note !== undefined && { note: b.note ?? null }),
            version: sql`version + 1`,
          })
          .where('id', '=', salaryId)
          .where('employeeId', '=', employeeId)
          .where('version', '=', b.version)
          .returning('id')
          .executeTakeFirst();
        if (!upd) {
          const e = await ctx.trx
            .selectFrom('employeeSalaries')
            .select('id')
            .where('id', '=', salaryId)
            .where('employeeId', '=', employeeId)
            .executeTakeFirst();
          throw e
            ? new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل')
            : notFound();
        }
        if (touch) await setComponents(ctx, salaryId, b.components ?? []);
        return (await loadRows(ctx, employeeId, salaryId))[0];
      });
      res.json({ data });
    }),
  );

  /** حذف أحدث راتب فقط (تصحيح إدخال خاطئ) فيُعاد فتح السابق. */
  router.delete(
    '/:salaryId',
    requirePermission(MANAGE),
    wrap(async (req, res) => {
      const { employeeId, salaryId } = params.parse(req.params);
      if (!salaryId) throw notFound();
      const auth = req.auth as NonNullable<Request['auth']>;
      await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const rows = await ctx.trx
          .selectFrom('employeeSalaries')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .orderBy('validFrom', 'desc')
          .limit(2)
          .execute();
        if (rows[0]?.id !== salaryId)
          throw rows.some((r) => r.id === salaryId) || !rows.length
            ? new AppError('NOT_LATEST', 409, 'يُحذف أحدث راتب فقط')
            : notFound();
        await ctx.trx
          .deleteFrom('employeeSalaryComponents')
          .where('employeeSalaryId', '=', salaryId)
          .execute();
        await ctx.trx.deleteFrom('employeeSalaries').where('id', '=', salaryId).execute();
        if (rows[1])
          await ctx.trx
            .updateTable('employeeSalaries')
            .set({ validTo: null, version: sql`version + 1` })
            .where('id', '=', rows[1].id)
            .execute();
      });
      res.status(204).end();
    }),
  );
  return router;
};
