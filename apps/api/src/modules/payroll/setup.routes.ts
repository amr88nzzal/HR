import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  PAYROLL_VARIABLES,
  checkFormulaRefs,
  formulaRefs,
  parseFormula,
  payComponentInput,
  payComponentUpdate,
  payrollBaseInput,
  payrollBaseUpdate,
  rateTableInput,
  rateTableUpdate,
  salaryStructureInput,
  salaryStructureUpdate,
} from '@hrms/shared';
import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { assertAcyclic } from './graph.js';

const idParam = z.object({ id: z.string().uuid() });
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');
const conflict = () =>
  new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
const dupCode = (e: unknown) => {
  if ((e as { code?: string }).code === '23505')
    throw new AppError('DUPLICATE_CODE', 409, 'الرمز مستعمل');
  throw e;
};
const inUse = (e: unknown) => {
  if ((e as { code?: string }).code === '23503')
    throw new AppError('IN_USE', 409, 'لا يمكن الحذف لأن السجل مستخدم، عطّله بدلاً من ذلك');
  throw e;
};

export const makeRun =
  (db: Db) =>
  <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };

const ensureIds = async (
  ctx: Ctx,
  table: 'payrollBases' | 'rateTables' | 'payComponents',
  ids: string[],
) => {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await ctx.trx
    .selectFrom(table)
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('id', 'in', unique)
    .execute();
  if (found.length !== unique.length)
    throw new AppError('INVALID_REFERENCE', 400, 'مرجع غير موجود ضمن الشركة');
};

/** صيغة المكوّن: مراجعها (متغيرات/مكونات/أسس/جداول) معروفة ولا يشير إلى نفسه. */
const checkFormula = async (ctx: Ctx, selfCode: string, formula: string) => {
  const [comps, bases, tables] = await Promise.all([
    ctx.trx
      .selectFrom('payComponents')
      .select('code')
      .where('companyId', '=', ctx.companyId)
      .execute(),
    ctx.trx
      .selectFrom('payrollBases')
      .select('code')
      .where('companyId', '=', ctx.companyId)
      .execute(),
    ctx.trx
      .selectFrom('rateTables')
      .select('code')
      .where('companyId', '=', ctx.companyId)
      .execute(),
  ]);
  const problems = checkFormulaRefs(formula, {
    components: new Set(comps.map((c) => c.code).filter((c) => c !== selfCode)),
    bases: new Set(bases.map((b) => b.code)),
    tables: new Set(tables.map((t) => t.code)),
  });
  if (formulaRefs(parseFormula(formula)).vars.has(selfCode))
    problems.push('المكوّن لا يشير إلى نفسه');
  if (problems.length) throw new AppError('INVALID_FORMULA', 400, 'الصيغة غير صالحة', { problems });
};

const strip = <T extends { companyId: string }>(r: T): Omit<T, 'companyId'> => {
  const { companyId, ...rest } = r;
  void companyId;
  return rest;
};

const parseBody = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => schema.parse(body);

/** إعدادات الرواتب: الأسس، المكونات، جداول النسب، والهياكل. */
export const createPayrollSetupRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get('/variables', (_req, res) => {
    res.json({ data: PAYROLL_VARIABLES });
  });

  // ───── أسس الاحتساب ─────
  const baseRows = (ctx: Ctx, id?: string) =>
    sql<Record<string, unknown>>`
      select b.id, b.code, b.name_ar, b.name_en, b.includes_basic, b.is_active, b.version,
             coalesce(array_agg(l.component_id) filter (where l.component_id is not null), '{}') as component_ids
        from payroll_bases b
        left join pay_component_bases l on l.base_id = b.id
       where b.company_id = ${ctx.companyId} ${id ? sql`and b.id = ${id}` : sql``}
       group by b.id order by b.code`.execute(ctx.trx);
  const setBaseMembers = async (ctx: Ctx, baseId: string, ids: string[]) => {
    await ensureIds(ctx, 'payComponents', ids);
    await ctx.trx.deleteFrom('payComponentBases').where('baseId', '=', baseId).execute();
    if (ids.length)
      await ctx.trx
        .insertInto('payComponentBases')
        .values(
          [...new Set(ids)].map((componentId) => ({
            companyId: ctx.companyId,
            baseId,
            componentId,
          })),
        )
        .execute();
  };

  router.get(
    '/bases',
    requirePermission('payroll.base.read'),
    wrap(async (req, res) => {
      res.json({ data: (await run(req, (ctx) => baseRows(ctx))).rows });
    }),
  );
  router.post(
    '/bases',
    requirePermission('payroll.base.create'),
    wrap(async (req, res) => {
      const b = parseBody(payrollBaseInput, req.body);
      const data = await run(req, async (ctx) => {
        const row = await ctx.trx
          .insertInto('payrollBases')
          .values({
            companyId: ctx.companyId,
            code: b.code,
            nameAr: b.nameAr,
            nameEn: b.nameEn ?? null,
            includesBasic: b.includesBasic,
            isActive: b.isActive,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
          .catch(dupCode);
        await setBaseMembers(ctx, row.id, b.componentIds);
        await assertAcyclic(ctx);
        return (await baseRows(ctx, row.id)).rows[0];
      });
      res.status(201).json({ data });
    }),
  );
  router.patch(
    '/bases/:id',
    requirePermission('payroll.base.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const b = parseBody(payrollBaseUpdate, req.body);
      const touchMembers = (req.body as Record<string, unknown>)['componentIds'] !== undefined;
      const data = await run(req, async (ctx) => {
        const upd = await ctx.trx
          .updateTable('payrollBases')
          .set({
            ...(b.nameAr !== undefined && { nameAr: b.nameAr }),
            ...(b.nameEn !== undefined && { nameEn: b.nameEn ?? null }),
            ...(b.includesBasic !== undefined && { includesBasic: b.includesBasic }),
            ...(b.isActive !== undefined && { isActive: b.isActive }),
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .where('version', '=', b.version)
          .returning('id')
          .executeTakeFirst();
        if (!upd) {
          const e = await ctx.trx
            .selectFrom('payrollBases')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();
          throw e ? conflict() : notFound();
        }
        if (touchMembers) {
          await setBaseMembers(ctx, id, b.componentIds ?? []);
          await assertAcyclic(ctx);
        }
        return (await baseRows(ctx, id)).rows[0];
      });
      res.json({ data });
    }),
  );
  router.delete(
    '/bases/:id',
    requirePermission('payroll.base.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const used = await ctx.trx
          .selectFrom('payComponents')
          .select('id')
          .where('baseId', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (used) throw new AppError('IN_USE', 409, 'الأساس مستخدم في مكوّن');
        await ctx.trx.deleteFrom('payComponentBases').where('baseId', '=', id).execute();
        const r = await ctx.trx.deleteFrom('payrollBases').where('id', '=', id).executeTakeFirst();
        if (!r.numDeletedRows) throw notFound();
      });
      res.status(204).end();
    }),
  );

  // ───── جداول النسب ─────
  router.get(
    '/rate-tables',
    requirePermission('payroll.rate_table.read'),
    wrap(async (req, res) => {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('rateTables')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .orderBy('code')
          .execute(),
      );
      res.json({ data: rows.map(strip) });
    }),
  );
  router.post(
    '/rate-tables',
    requirePermission('payroll.rate_table.create'),
    wrap(async (req, res) => {
      const b = parseBody(rateTableInput, req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .insertInto('rateTables')
          .values({
            companyId: ctx.companyId,
            code: b.code,
            nameAr: b.nameAr,
            nameEn: b.nameEn ?? null,
            mode: b.mode,
            brackets: JSON.stringify(b.brackets),
            isActive: b.isActive,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch(dupCode),
      );
      res.status(201).json({ data: strip(row) });
    }),
  );
  router.patch(
    '/rate-tables/:id',
    requirePermission('payroll.rate_table.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const raw = req.body as Record<string, unknown>;
      const b = parseBody(rateTableUpdate, raw);
      // الشرائح تُفحص كاملةً عند تغييرها
      if (b.brackets !== undefined)
        parseBody(rateTableInput, {
          code: 'X',
          nameAr: 'x',
          mode: b.mode ?? 'progressive',
          brackets: b.brackets,
        });
      const row = await run(req, async (ctx) => {
        const r = await ctx.trx
          .updateTable('rateTables')
          .set({
            ...(b.nameAr !== undefined && { nameAr: b.nameAr }),
            ...(b.nameEn !== undefined && { nameEn: b.nameEn ?? null }),
            ...(b.mode !== undefined && { mode: b.mode }),
            ...(b.brackets !== undefined && { brackets: JSON.stringify(b.brackets) }),
            ...(b.isActive !== undefined && { isActive: b.isActive }),
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .where('version', '=', b.version)
          .returningAll()
          .executeTakeFirst();
        if (r) return r;
        const e = await ctx.trx
          .selectFrom('rateTables')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst();
        throw e ? conflict() : notFound();
      });
      res.json({ data: strip(row) });
    }),
  );
  router.delete(
    '/rate-tables/:id',
    requirePermission('payroll.rate_table.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const r = await ctx.trx
          .deleteFrom('rateTables')
          .where('id', '=', id)
          .executeTakeFirst()
          .catch(inUse);
        if (!r.numDeletedRows) throw notFound();
      });
      res.status(204).end();
    }),
  );

  // ───── المكونات ─────
  router.get(
    '/components',
    requirePermission('payroll.component.read'),
    wrap(async (req, res) => {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('payComponents')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .orderBy('displayOrder')
          .orderBy('code')
          .execute(),
      );
      res.json({ data: rows.map(strip) });
    }),
  );
  const refCheck = async (ctx: Ctx, v: { baseId?: string | null; rateTableId?: string | null }) => {
    if (v.baseId) await ensureIds(ctx, 'payrollBases', [v.baseId]);
    if (v.rateTableId) await ensureIds(ctx, 'rateTables', [v.rateTableId]);
  };
  router.post(
    '/components',
    requirePermission('payroll.component.create'),
    wrap(async (req, res) => {
      const b = parseBody(payComponentInput, req.body);
      const row = await run(req, async (ctx) => {
        await refCheck(ctx, b);
        if (b.calcType === 'formula') await checkFormula(ctx, b.code, b.formula as string);
        const r = await ctx.trx
          .insertInto('payComponents')
          .values({
            companyId: ctx.companyId,
            code: b.code,
            nameAr: b.nameAr,
            nameEn: b.nameEn ?? null,
            kind: b.kind,
            calcType: b.calcType,
            fixedAmount: b.calcType === 'fixed' ? (b.fixedAmount ?? null) : null,
            percent: b.calcType === 'percent' ? (b.percent ?? null) : null,
            baseId:
              b.calcType === 'percent' || b.calcType === 'rate_table' ? (b.baseId ?? null) : null,
            formula: b.calcType === 'formula' ? (b.formula ?? null) : null,
            rateTableId: b.calcType === 'rate_table' ? (b.rateTableId ?? null) : null,
            roundingDecimals: b.roundingDecimals,
            displayOrder: b.displayOrder,
            isActive: b.isActive,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch(dupCode);
        await assertAcyclic(ctx);
        return r;
      });
      res.status(201).json({ data: strip(row) });
    }),
  );
  router.patch(
    '/components/:id',
    requirePermission('payroll.component.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const b = parseBody(payComponentUpdate, req.body) as z.infer<typeof payComponentInput> & {
        version: number;
      };
      const row = await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('payComponents')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!cur) throw notFound();
        if (cur.version !== b.version) throw conflict();
        // الحقول النهائية بعد الدمج ثم فحص كامل للنوع
        const merged = {
          code: cur.code,
          nameAr: b.nameAr ?? cur.nameAr,
          nameEn: b.nameEn === undefined ? cur.nameEn : b.nameEn,
          kind: b.kind ?? cur.kind,
          calcType: b.calcType ?? cur.calcType,
          fixedAmount: b.fixedAmount === undefined ? cur.fixedAmount : b.fixedAmount,
          percent: b.percent === undefined ? cur.percent : b.percent,
          baseId: b.baseId === undefined ? cur.baseId : b.baseId,
          formula: b.formula === undefined ? cur.formula : b.formula,
          rateTableId: b.rateTableId === undefined ? cur.rateTableId : b.rateTableId,
          roundingDecimals: b.roundingDecimals ?? cur.roundingDecimals,
          displayOrder: b.displayOrder ?? cur.displayOrder,
          isActive: b.isActive ?? cur.isActive,
        };
        const m = parseBody(payComponentInput, merged);
        await refCheck(ctx, m);
        if (m.calcType === 'formula') await checkFormula(ctx, m.code, m.formula as string);
        const r = await ctx.trx
          .updateTable('payComponents')
          .set({
            nameAr: m.nameAr,
            nameEn: m.nameEn ?? null,
            kind: m.kind,
            calcType: m.calcType,
            fixedAmount: m.calcType === 'fixed' ? (m.fixedAmount ?? null) : null,
            percent: m.calcType === 'percent' ? (m.percent ?? null) : null,
            baseId:
              m.calcType === 'percent' || m.calcType === 'rate_table' ? (m.baseId ?? null) : null,
            formula: m.calcType === 'formula' ? (m.formula ?? null) : null,
            rateTableId: m.calcType === 'rate_table' ? (m.rateTableId ?? null) : null,
            roundingDecimals: m.roundingDecimals,
            displayOrder: m.displayOrder,
            isActive: m.isActive,
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await assertAcyclic(ctx);
        return r;
      });
      res.json({ data: strip(row) });
    }),
  );
  router.delete(
    '/components/:id',
    requirePermission('payroll.component.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('payComponents')
          .select('code')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!cur) throw notFound();
        const others = await ctx.trx
          .selectFrom('payComponents')
          .select(['code', 'formula'])
          .where('companyId', '=', ctx.companyId)
          .where('calcType', '=', 'formula')
          .execute();
        for (const o of others)
          if (o.formula && formulaRefs(parseFormula(o.formula)).vars.has(cur.code))
            throw new AppError('IN_USE', 409, `المكوّن مذكور في صيغة ${o.code}`);
        await ctx.trx.deleteFrom('payComponents').where('id', '=', id).execute().catch(inUse);
      });
      res.status(204).end();
    }),
  );

  // ───── هياكل الرواتب ─────
  const structRows = (ctx: Ctx, id?: string) =>
    sql<Record<string, unknown>>`
      select s.id, s.code, s.name_ar, s.name_en, s.currency, s.is_active, s.version,
             coalesce(jsonb_agg(jsonb_build_object('componentId', i.component_id, 'amount', i.amount::text, 'percent', i.percent::text)
                      order by c.display_order, c.code) filter (where i.id is not null), '[]') as items
        from salary_structures s
        left join salary_structure_components i on i.structure_id = s.id
        left join pay_components c on c.id = i.component_id
       where s.company_id = ${ctx.companyId} ${id ? sql`and s.id = ${id}` : sql``}
       group by s.id order by s.code`.execute(ctx.trx);
  const setItems = async (
    ctx: Ctx,
    structureId: string,
    items: z.infer<typeof salaryStructureInput>['items'],
  ) => {
    const ids = items.map((i) => i.componentId);
    if (new Set(ids).size !== ids.length)
      throw new AppError('DUPLICATE_COMPONENT', 400, 'مكوّن مكرر في الهيكل');
    await ensureIds(ctx, 'payComponents', ids);
    await ctx.trx
      .deleteFrom('salaryStructureComponents')
      .where('structureId', '=', structureId)
      .execute();
    if (items.length)
      await ctx.trx
        .insertInto('salaryStructureComponents')
        .values(
          items.map((i) => ({
            companyId: ctx.companyId,
            structureId,
            componentId: i.componentId,
            amount: i.amount ?? null,
            percent: i.percent ?? null,
          })),
        )
        .execute();
  };
  router.get(
    '/structures',
    requirePermission('payroll.structure.read'),
    wrap(async (req, res) => {
      res.json({ data: (await run(req, (ctx) => structRows(ctx))).rows });
    }),
  );
  router.post(
    '/structures',
    requirePermission('payroll.structure.create'),
    wrap(async (req, res) => {
      const b = parseBody(salaryStructureInput, req.body);
      const data = await run(req, async (ctx) => {
        const row = await ctx.trx
          .insertInto('salaryStructures')
          .values({
            companyId: ctx.companyId,
            code: b.code,
            nameAr: b.nameAr,
            nameEn: b.nameEn ?? null,
            currency: b.currency ?? null,
            isActive: b.isActive,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
          .catch(dupCode);
        await setItems(ctx, row.id, b.items);
        return (await structRows(ctx, row.id)).rows[0];
      });
      res.status(201).json({ data });
    }),
  );
  router.patch(
    '/structures/:id',
    requirePermission('payroll.structure.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const b = parseBody(salaryStructureUpdate, req.body);
      const touchItems = (req.body as Record<string, unknown>)['items'] !== undefined;
      const data = await run(req, async (ctx) => {
        const upd = await ctx.trx
          .updateTable('salaryStructures')
          .set({
            ...(b.nameAr !== undefined && { nameAr: b.nameAr }),
            ...(b.nameEn !== undefined && { nameEn: b.nameEn ?? null }),
            ...(b.currency !== undefined && { currency: b.currency ?? null }),
            ...(b.isActive !== undefined && { isActive: b.isActive }),
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .where('version', '=', b.version)
          .returning('id')
          .executeTakeFirst();
        if (!upd) {
          const e = await ctx.trx
            .selectFrom('salaryStructures')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();
          throw e ? conflict() : notFound();
        }
        if (touchItems) await setItems(ctx, id, b.items ?? []);
        return (await structRows(ctx, id)).rows[0];
      });
      res.json({ data });
    }),
  );
  router.delete(
    '/structures/:id',
    requirePermission('payroll.structure.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const used = await ctx.trx
          .selectFrom('employeeSalaries')
          .select('id')
          .where('structureId', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (used)
          throw new AppError('IN_USE', 409, 'الهيكل مستعمل في رواتب موظفين، عطّله بدلاً من ذلك');
        await ctx.trx
          .deleteFrom('salaryStructureComponents')
          .where('structureId', '=', id)
          .execute();
        const r = await ctx.trx
          .deleteFrom('salaryStructures')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r.numDeletedRows) throw notFound();
      });
      res.status(204).end();
    }),
  );
  return router;
};
