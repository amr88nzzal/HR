import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import type { z } from 'zod';
import { childUpdateInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission, type AuthContext } from '../identity/index.js';
import { assertEmployeeVisible } from './access.js';

type Row = Record<string, unknown>;
const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');
export const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};

/** مقاطع جدول فرعي للموظف: قراءة بصلاحية الموظف، وكتابة بصلاحية تعديل الموظف. */
export type ChildConfig = {
  /** اسم الجدول بصيغة Kysely (camelCase) */
  table: string;
  schema: z.ZodObject<z.ZodRawShape>;
  orderBy: string;
  /** أعمدة تحدد «مجموعة» الصف الأساسي: عند تعيين isPrimary تُلغى الأساسية في نفس المجموعة */
  primaryGroup?: string[];
  readPermission?: string;
  writePermission?: string;
};

/** أدوات مشتركة بين الراوتر العام وراوتر الحسابات البنكية */
export type RouterHelpers = {
  run: <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>) => Promise<T>;
};

export const makeRun =
  (db: Db) =>
  <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

// Kysely ديناميكي: نتعامل مع الجداول الفرعية بصورة عامة داخل هذا الملف فقط
type Dyn = ReturnType<Ctx['trx']['selectFrom']> extends never ? never : any; // eslint-disable-line @typescript-eslint/no-explicit-any
const dyn = (ctx: Ctx): Dyn => ctx.trx as unknown as Dyn;

const strip = (row: Row): Row => {
  const rest = { ...row };
  delete rest['companyId'];
  return rest;
};

export const createChildRouter = (
  db: Db,
  authenticate: RequestHandler,
  cfg: ChildConfig,
): Router => {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  const run = makeRun(db);
  const read = cfg.readPermission ?? 'employees.employee.read';
  const write = cfg.writePermission ?? 'employees.employee.update';
  const updateSchema = childUpdateInput(cfg.schema.shape);

  const clearPrimary = async (ctx: Ctx, employeeId: string, values: Row, exceptId?: string) => {
    if (!cfg.primaryGroup || values['isPrimary'] !== true) return;
    let q = dyn(ctx)
      .updateTable(cfg.table)
      .set({ isPrimary: false })
      .where('employeeId', '=', employeeId)
      .where('isPrimary', '=', true);
    for (const col of cfg.primaryGroup) q = q.where(col, '=', values[col]);
    if (exceptId) q = q.where('id', '!=', exceptId);
    await q.execute();
  };

  router.get('/', requirePermission(read), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const rows = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, read);
        return (await dyn(ctx)
          .selectFrom(cfg.table)
          .selectAll()
          .where('employeeId', '=', employeeId)
          .orderBy(cfg.orderBy)
          .orderBy('id')
          .execute()) as Row[];
      });
      res.json({ data: rows.map(strip) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(write), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const input = cfg.schema.parse(req.body) as Row;
      const row = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, write);
        await clearPrimary(ctx, employeeId, input);
        return (await dyn(ctx)
          .insertInto(cfg.table)
          .values({ ...input, employeeId, companyId: ctx.companyId })
          .returningAll()
          .executeTakeFirstOrThrow()) as Row;
      });
      res.status(201).json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(write), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      const { version, ...changes } = updateSchema.parse(req.body) as Row & { version: number };
      const row = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, write);
        const current = (await dyn(ctx)
          .selectFrom(cfg.table)
          .selectAll()
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst()) as Row | undefined;
        if (!current) throw notFound();
        const defined = Object.fromEntries(
          Object.entries(changes).filter(([, v]) => v !== undefined),
        );
        await clearPrimary(ctx, employeeId, { ...current, ...defined }, id);
        const updated = (await dyn(ctx)
          .updateTable(cfg.table)
          .set({ ...defined, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst()) as Row | undefined;
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        return updated;
      });
      res.json({ data: strip(row) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(write), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, write);
        const res2 = await dyn(ctx)
          .deleteFrom(cfg.table)
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!res2.numDeletedRows) throw notFound();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
