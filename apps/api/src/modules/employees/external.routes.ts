import { Router, type RequestHandler } from 'express';
import { sql } from 'kysely';
import {
  customFieldDefinitionInput,
  customFieldDefinitionUpdateInput,
  externalRefInput,
  externalRefResolveQuery,
  externalRefUpdateInput,
  externalSystemInput,
  externalSystemUpdateInput,
  normalizeRefValue,
  type ApiEnvelope,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { assertEmployeeVisible, employeeScope } from './access.js';
import { idOf, makeRun } from './children.routes.js';

type Row = Record<string, unknown>;
const strip = (row: Row): Row => {
  const rest = { ...row };
  delete rest['companyId'];
  return rest;
};
const conflict = (err: unknown): never => {
  const code = (err as { code?: string }).code;
  if (code === '23P01' || code === '23505')
    throw new AppError('REF_DUPLICATE', 409, 'القيمة مستخدمة لموظف آخر في الفترة نفسها');
  throw err;
};

/** الأنظمة الافتراضية للشركة (تُبذر مرة واحدة، لا تُحذف). */
export const DEFAULT_EXTERNAL_SYSTEMS = [
  {
    key: 'accounting',
    nameAr: 'رقم الموظف في برنامج المحاسبة',
    nameEn: 'Accounting system number',
    purpose: 'accounting',
    refScope: 'company',
  },
  {
    key: 'attendance_device',
    nameAr: 'كود الموظف في جهاز البصمة',
    nameEn: 'Fingerprint device code',
    purpose: 'attendance_device',
    refScope: 'branch',
  },
] as const;

export const seedDefaultExternalSystems = async (ctx: Ctx): Promise<void> => {
  for (const s of DEFAULT_EXTERNAL_SYSTEMS) {
    await ctx.trx
      .insertInto('externalSystems')
      .values({ ...s, companyId: ctx.companyId, isUnique: true, isSystem: true })
      .onConflict((oc) => oc.columns(['companyId', 'key']).doNothing())
      .execute();
  }
};

/** /external-systems — تعريف الأنظمة الخارجية التي تحمل مراجع للموظفين */
export const createExternalSystemsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);
  const P = 'org.external_system';

  router.get('/', requirePermission(`${P}.read`), async (req, res, next) => {
    try {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('externalSystems')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .orderBy('key')
          .execute(),
      );
      const body: ApiEnvelope<Row[]> = {
        data: rows.map(strip),
        meta: { total: rows.length },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(`${P}.create`), async (req, res, next) => {
    try {
      const input = externalSystemInput.parse(req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .insertInto('externalSystems')
          .values({
            ...input,
            nameEn: input.nameEn ?? null,
            validationRegex: input.validationRegex ?? null,
            companyId: ctx.companyId,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
      res.status(201).json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(`${P}.update`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const { version, ...changes } = externalSystemUpdateInput.parse(req.body);
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(defined).length === 0)
        throw new AppError('VALIDATION_ERROR', 400, 'لا توجد تغييرات');
      const row = await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('externalSystems')
          .selectAll()
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!cur) throw new AppError('NOT_FOUND', 404, 'النظام غير موجود');
        const hasRefs = !!(await ctx.trx
          .selectFrom('employeeExternalRefs')
          .select('id')
          .where('systemId', '=', id)
          .limit(1)
          .executeTakeFirst());
        if (cur.isSystem && (defined['key'] !== undefined || defined['purpose'] !== undefined))
          throw new AppError('SYSTEM_RECORD', 409, 'لا يمكن تغيير مفتاح النظام الأساسي أو غرضه');
        if (defined['key'] !== undefined && defined['key'] !== cur.key && hasRefs)
          throw new AppError('IN_USE', 409, 'لا يمكن تغيير مفتاح نظام له مراجع');
        if (defined['refScope'] !== undefined && defined['refScope'] !== cur.refScope && hasRefs)
          throw new AppError('IN_USE', 409, 'لا يمكن تغيير نطاق نظام له مراجع');
        const updated = await ctx.trx
          .updateTable('externalSystems')
          .set({ ...defined, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        // تغيير التفرّد ينعكس على المراجع القائمة (قد يفشل إن وُجد تكرار)
        if (defined['isUnique'] !== undefined && defined['isUnique'] !== cur.isUnique) {
          try {
            await ctx.trx
              .updateTable('employeeExternalRefs')
              .set({ enforceUnique: updated.isUnique })
              .where('systemId', '=', id)
              .execute();
          } catch (err) {
            if ((err as { code?: string }).code === '23P01')
              throw new AppError(
                'REF_DUPLICATE',
                409,
                'توجد قيم مكررة بين موظفين؛ عالجها قبل جعل النظام فريداً',
              );
            throw err;
          }
        }
        return updated;
      });
      res.json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(`${P}.delete`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('externalSystems')
          .select(['id', 'isSystem'])
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!cur) throw new AppError('NOT_FOUND', 404, 'النظام غير موجود');
        if (cur.isSystem) throw new AppError('SYSTEM_RECORD', 409, 'لا يمكن حذف نظام أساسي');
        try {
          await ctx.trx.deleteFrom('externalSystems').where('id', '=', id).execute();
        } catch (err) {
          if ((err as { code?: string }).code === '23503')
            throw new AppError('IN_USE', 409, 'للنظام مراجع مسجلة، عطّله بدلاً من حذفه');
          throw err;
        }
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

type SystemRow = {
  id: string;
  key: string;
  refScope: 'company' | 'branch';
  isUnique: boolean;
  validationRegex: string | null;
  isActive: boolean;
};

/** يتحقق من القيمة والفرع مقابل خصائص النظام ويعيد القيمة المطبَّعة. */
export const checkRef = async (
  ctx: Ctx,
  system: SystemRow,
  rawValue: string,
  branchId: string | null | undefined,
): Promise<{ value: string; branchId: string | null }> => {
  const value = normalizeRefValue(rawValue);
  if (!value) throw new AppError('VALIDATION_ERROR', 400, 'القيمة فارغة');
  if (system.validationRegex && !new RegExp(system.validationRegex).test(value))
    throw new AppError('REF_INVALID', 400, 'القيمة لا تطابق صيغة هذا النظام', {
      system: system.key,
    });
  if (system.refScope === 'branch') {
    if (!branchId) throw new AppError('VALIDATION_ERROR', 400, 'هذا النظام يتطلب تحديد الفرع');
    const b = await ctx.trx
      .selectFrom('branches')
      .select('id')
      .where('id', '=', branchId)
      .where('companyId', '=', ctx.companyId)
      .executeTakeFirst();
    if (!b) throw new AppError('INVALID_REFERENCE', 400, 'الفرع غير موجود ضمن الشركة');
    return { value, branchId };
  }
  if (branchId) throw new AppError('VALIDATION_ERROR', 400, 'هذا النظام لا يستخدم الفرع');
  return { value, branchId: null };
};

export const loadSystem = async (ctx: Ctx, id: string): Promise<SystemRow> => {
  const s = await ctx.trx
    .selectFrom('externalSystems')
    .select(['id', 'key', 'refScope', 'isUnique', 'validationRegex', 'isActive'])
    .where('id', '=', id)
    .where('companyId', '=', ctx.companyId)
    .executeTakeFirst();
  if (!s) throw new AppError('INVALID_REFERENCE', 400, 'النظام الخارجي غير موجود');
  return s;
};

/** /employees/:employeeId/external-refs */
export const createExternalRefsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  const run = makeRun(db);
  const READ = 'employees.external_ref.read';
  const MANAGE = 'employees.external_ref.manage';

  /** يُلغي صفة «الأساسي» عن مراجع الموظف الأخرى في النظام/الفرع نفسه */
  const demoteOthers = (
    ctx: Ctx,
    employeeId: string,
    systemId: string,
    branchId: string | null,
    exceptId?: string,
  ) => {
    let q = ctx.trx
      .updateTable('employeeExternalRefs')
      .set({ isPrimary: false })
      .where('employeeId', '=', employeeId)
      .where('systemId', '=', systemId)
      .where('isPrimary', '=', true);
    q = branchId ? q.where('branchId', '=', branchId) : q.where('branchId', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return q.execute();
  };

  router.get('/', requirePermission(READ), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const rows = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, READ);
        return ctx.trx
          .selectFrom('employeeExternalRefs as r')
          .innerJoin('externalSystems as s', 's.id', 'r.systemId')
          .selectAll('r')
          .select(['s.key as systemKey', 's.nameAr as systemNameAr', 's.nameEn as systemNameEn'])
          .where('r.employeeId', '=', employeeId)
          .orderBy('s.key')
          .orderBy('r.isPrimary', 'desc')
          .orderBy('r.createdAt')
          .execute();
      });
      res.json({ data: rows.map(strip) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const input = externalRefInput.parse(req.body);
      const row = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const system = await loadSystem(ctx, input.systemId);
        if (!system.isActive) throw new AppError('SYSTEM_INACTIVE', 400, 'النظام الخارجي معطّل');
        const { value, branchId } = await checkRef(ctx, system, input.value, input.branchId);
        if (input.isPrimary) await demoteOthers(ctx, employeeId, system.id, branchId);
        try {
          return await ctx.trx
            .insertInto('employeeExternalRefs')
            .values({
              companyId: ctx.companyId,
              employeeId,
              systemId: system.id,
              value,
              branchId,
              validFrom: input.validFrom ?? null,
              validTo: input.validTo ?? null,
              isPrimary: input.isPrimary,
              enforceUnique: system.isUnique,
              notes: input.notes ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        } catch (err) {
          return conflict(err);
        }
      });
      res.status(201).json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      const { version, ...changes } = externalRefUpdateInput.parse(req.body);
      const row = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const cur = await ctx.trx
          .selectFrom('employeeExternalRefs')
          .selectAll()
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!cur) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
        const system = await loadSystem(ctx, cur.systemId);
        const merged = {
          value: changes.value ?? cur.value,
          branchId: changes.branchId === undefined ? cur.branchId : changes.branchId,
          validFrom: changes.validFrom === undefined ? cur.validFrom : changes.validFrom,
          validTo: changes.validTo === undefined ? cur.validTo : changes.validTo,
          isPrimary: changes.isPrimary ?? cur.isPrimary,
          notes: changes.notes === undefined ? cur.notes : changes.notes,
        };
        if (merged.validFrom && merged.validTo && merged.validTo < merged.validFrom)
          throw new AppError('VALIDATION_ERROR', 400, 'نهاية الصلاحية قبل بدايتها');
        const checked = await checkRef(ctx, system, merged.value, merged.branchId);
        if (merged.isPrimary) await demoteOthers(ctx, employeeId, system.id, checked.branchId, id);
        try {
          const updated = await ctx.trx
            .updateTable('employeeExternalRefs')
            .set({ ...merged, ...checked, version: sql`version + 1` })
            .where('id', '=', id)
            .where('version', '=', version)
            .returningAll()
            .executeTakeFirst();
          if (!updated)
            throw new AppError(
              'VERSION_CONFLICT',
              409,
              'تم تعديل السجل من مستخدم آخر، أعد التحميل',
            );
          return updated;
        } catch (err) {
          return conflict(err);
        }
      });
      res.json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const r = await ctx.trx
          .deleteFrom('employeeExternalRefs')
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!r.numDeletedRows) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/**
 * GET /external-refs/resolve?system=attendance_device&value=0042&branchId=…&date=…
 * يحدد الموظف الذي يحمل المرجع في التاريخ المطلوب (يستعمله الاستيراد والتكامل).
 * 404 إن لم يوجد (أو خارج نطاق المستخدم)، 409 AMBIGUOUS إن تعدد في نظام غير فريد.
 */
export const createExternalRefResolveRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);
  const READ = 'employees.external_ref.read';

  router.get('/resolve', requirePermission(READ), async (req, res, next) => {
    try {
      const q = externalRefResolveQuery.parse(req.query);
      const data = await run(req, async (ctx, auth) => {
        const system = await ctx.trx
          .selectFrom('externalSystems')
          .select(['id', 'refScope'])
          .where('companyId', '=', ctx.companyId)
          .where('key', '=', q.system)
          .executeTakeFirst();
        if (!system) throw new AppError('NOT_FOUND', 404, 'النظام الخارجي غير موجود');
        if (system.refScope === 'branch' && !q.branchId)
          throw new AppError('VALIDATION_ERROR', 400, 'هذا النظام يتطلب branchId');
        const value = normalizeRefValue(q.value);
        const scope = employeeScope(auth, 'employees.employee.read');
        let b = ctx.trx
          .selectFrom('employeeExternalRefs as r')
          .innerJoin('employees', 'employees.id', 'r.employeeId')
          .select([
            'employees.id as employeeId',
            'employees.employeeNo',
            'employees.fullNameAr',
            'employees.fullNameEn',
          ])
          .where('r.systemId', '=', system.id)
          .where('r.value', '=', value)
          .where(
            sql<boolean>`(r.valid_from is null or r.valid_from <= coalesce(${q.date ?? null}::date, company_today(r.company_id)))`,
          )
          .where(
            sql<boolean>`(r.valid_to is null or r.valid_to >= coalesce(${q.date ?? null}::date, company_today(r.company_id)))`,
          );
        if (system.refScope === 'branch') b = b.where('r.branchId', '=', q.branchId as string);
        if (scope) b = b.where(scope);
        const rows = await b.distinct().limit(2).execute();
        if (rows.length === 0) throw new AppError('NOT_FOUND', 404, 'لا يوجد موظف بهذا المرجع');
        if (rows.length > 1)
          throw new AppError('AMBIGUOUS', 409, 'أكثر من موظف يحمل هذا المرجع في التاريخ المطلوب');
        return rows[0];
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/** /custom-field-definitions — تعريف الحقول المخصصة للموظف */
export const createCustomFieldsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);
  const P = 'org.custom_field';

  router.get('/', requirePermission(`${P}.read`), async (req, res, next) => {
    try {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('customFieldDefinitions')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .orderBy('sortOrder')
          .orderBy('key')
          .execute(),
      );
      res.json({ data: rows.map(strip), meta: { total: rows.length } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(`${P}.create`), async (req, res, next) => {
    try {
      const input = customFieldDefinitionInput.parse(req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .insertInto('customFieldDefinitions')
          .values({
            ...input,
            labelEn: input.labelEn ?? null,
            options: JSON.stringify(input.options),
            companyId: ctx.companyId,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
      res.status(201).json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(`${P}.update`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const { version, ...changes } = customFieldDefinitionUpdateInput.parse(req.body);
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(defined).length === 0)
        throw new AppError('VALIDATION_ERROR', 400, 'لا توجد تغييرات');
      const row = await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('customFieldDefinitions')
          .selectAll()
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!cur) throw new AppError('NOT_FOUND', 404, 'الحقل غير موجود');
        if (cur.fieldType === 'select' && changes.options && changes.options.length === 0)
          throw new AppError('VALIDATION_ERROR', 400, 'حقل القائمة يحتاج خياراً واحداً على الأقل');
        if (cur.fieldType !== 'select' && changes.options && changes.options.length > 0)
          throw new AppError('VALIDATION_ERROR', 400, 'الخيارات خاصة بحقول القائمة');
        // الحساسية تحدد طريقة التخزين، فلا تتغير بعد وجود قيم
        if (changes.isSensitive !== undefined && changes.isSensitive !== cur.isSensitive) {
          const used = await sql<{ n: string }>`
            select count(*)::text as n from employees
             where company_id = ${ctx.companyId} and custom_fields ? ${cur.key}`.execute(ctx.trx);
          if (Number(used.rows[0]?.n ?? 0) > 0)
            throw new AppError('IN_USE', 409, 'لا يمكن تغيير حساسية حقل له قيم مخزّنة');
        }
        const set = {
          ...defined,
          ...(changes.options ? { options: JSON.stringify(changes.options) } : {}),
          version: sql<number>`version + 1`,
        };
        const updated = await ctx.trx
          .updateTable('customFieldDefinitions')
          .set(set)
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        return updated;
      });
      res.json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  // الحذف يُعطّل فقط حتى لا تضيع بيانات مخزّنة (القيم تبقى في سجلات الموظفين)
  router.delete('/:id', requirePermission(`${P}.delete`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('customFieldDefinitions')
          .select(['id', 'key'])
          .where('id', '=', id)
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst();
        if (!cur) throw new AppError('NOT_FOUND', 404, 'الحقل غير موجود');
        const used = await sql<{ n: string }>`
          select count(*)::text as n from employees
           where company_id = ${ctx.companyId} and custom_fields ? ${cur.key}`.execute(ctx.trx);
        if (Number(used.rows[0]?.n ?? 0) > 0)
          throw new AppError('IN_USE', 409, 'للحقل قيم مخزّنة، عطّله بدلاً من حذفه');
        await ctx.trx.deleteFrom('customFieldDefinitions').where('id', '=', id).execute();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
