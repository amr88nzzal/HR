import { Router } from 'express';
import { sql, type Kysely } from 'kysely';
import type { z } from 'zod';
import { listQuery, withVersion, type ApiEnvelope } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { allowedBranchIds, requirePermission, type AuthContext } from '../identity/index.js';

type GenericDb = Record<string, Record<string, unknown>>;
export type Row = Record<string, unknown>;

export const generic = (ctx: Ctx): Kysely<GenericDb> => ctx.trx as unknown as Kysely<GenericDb>;

export type CrudConfig = {
  /** اسم الجدول بصيغة camelCase كما يراه Kysely */
  table: string;
  /** مثال: 'system.branch' ← .read/.create/.update/.delete */
  permission: string;
  create: z.ZodObject<z.ZodRawShape>;
  /** أعمدة نصية يبحث بها `q` */
  searchColumns: string[];
  orderBy: string;
  /** حقول مرجعية: اسم الحقل ← جدول الهدف (يُتحقق من وجوده داخل الشركة) */
  refs?: Record<string, string>;
  /** جدول شجري بعمود parentId: يمنع الحلقات */
  tree?: boolean;
  /** تقييد الرؤية بنطاق الفرع: العمود الذي يحمل معرّف الفرع في هذا الجدول */
  branchScopeColumn?: string;
  /** الجدول بلا عمود code (فلا يُبحث به) */
  codeless?: boolean;
};

export const ensureRefsExist = async (ctx: Ctx, table: string, ids: string[]): Promise<void> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await generic(ctx)
    .selectFrom(table)
    .select('id')
    .where('id', 'in', unique)
    .execute();
  if (found.length !== unique.length) {
    throw new AppError('INVALID_REFERENCE', 400, 'مرجع غير موجود ضمن الشركة');
  }
};

const assertNoCycle = async (
  ctx: Ctx,
  table: string,
  id: string,
  parentId: string,
): Promise<void> => {
  if (id === parentId)
    throw new AppError('INVALID_PARENT', 400, 'لا يمكن أن يكون السجل أباً لنفسه');
  const { rows } = await sql<{ found: boolean }>`
    with recursive up as (
      select id, parent_id from ${sql.table(toSnake(table))} where id = ${parentId}
      union all
      select t.id, t.parent_id from ${sql.table(toSnake(table))} t join up on t.id = up.parent_id
    ) select exists (select 1 from up where id = ${id}) as found`.execute(ctx.trx);
  if (rows[0]?.found) throw new AppError('INVALID_PARENT', 400, 'الأب المختار يسبب حلقة في الشجرة');
};

const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

const strip = (row: Row): Row => {
  const rest = { ...row };
  delete rest['companyId'];
  return rest;
};

const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');

/** رؤية الفرع: 'all' أو قائمة؛ تُطبَّق على الاستعلام (404 خارج النطاق). */
const branchFilter = (cfg: CrudConfig, auth: AuthContext): 'all' | string[] =>
  cfg.branchScopeColumn ? allowedBranchIds(auth, `${cfg.permission}.read`) : 'all';

export const createCrudService = (cfg: CrudConfig) => {
  const updateSchema = withVersion(cfg.create.shape);

  const checkRefs = async (ctx: Ctx, data: Row) => {
    for (const [field, target] of Object.entries(cfg.refs ?? {})) {
      const v = data[field];
      if (typeof v === 'string') await ensureRefsExist(ctx, target, [v]);
    }
  };

  return {
    updateSchema,

    list: async (ctx: Ctx, auth: AuthContext, query: z.infer<typeof listQuery>) => {
      const scope = branchFilter(cfg, auth);
      const q = generic(ctx).selectFrom(cfg.table).selectAll();
      const c = generic(ctx)
        .selectFrom(cfg.table)
        .select((eb) => eb.fn.countAll<string>().as('n'));
      const apply = <T extends typeof q | typeof c>(b: T): T => {
        let r = b as typeof q;
        if (query.isActive !== undefined) r = r.where('isActive', '=', query.isActive);
        if (query.q) {
          const like = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;
          r = r.where((eb) =>
            eb.or(
              [...cfg.searchColumns, ...(cfg.codeless ? [] : ['code'])].map((col) =>
                eb(col, 'ilike', like),
              ),
            ),
          );
        }
        if (scope !== 'all') {
          r = r.where(
            cfg.branchScopeColumn as string,
            'in',
            scope.length ? scope : ['00000000-0000-0000-0000-000000000000'],
          );
        }
        return r as unknown as T;
      };
      const rows = await apply(q)
        .orderBy(cfg.orderBy)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .execute();
      const total = Number((await apply(c).executeTakeFirstOrThrow()).n);
      return { rows: rows.map(strip), total };
    },

    get: async (ctx: Ctx, auth: AuthContext, id: string) => {
      const scope = branchFilter(cfg, auth);
      let q = generic(ctx).selectFrom(cfg.table).selectAll().where('id', '=', id);
      if (scope !== 'all') {
        q = q.where(
          cfg.branchScopeColumn as string,
          'in',
          scope.length ? scope : ['00000000-0000-0000-0000-000000000000'],
        );
      }
      const row = await q.executeTakeFirst();
      if (!row) throw notFound();
      return strip(row);
    },

    create: async (ctx: Ctx, data: Row) => {
      await checkRefs(ctx, data);
      const row = await generic(ctx)
        .insertInto(cfg.table)
        .values({ ...data, companyId: ctx.companyId })
        .returningAll()
        .executeTakeFirstOrThrow();
      return strip(row);
    },

    update: async (ctx: Ctx, auth: AuthContext, id: string, data: Row & { version: number }) => {
      await checkRefs(ctx, data);
      const { version, ...changes } = data;
      if (cfg.tree && typeof changes['parentId'] === 'string') {
        await ensureRefsExist(ctx, cfg.table, [changes['parentId']]);
        await assertNoCycle(ctx, cfg.table, id, changes['parentId']);
      }
      const scope = branchFilter(cfg, auth);
      let q = generic(ctx)
        .updateTable(cfg.table)
        .set({ ...changes, version: sql`version + 1` })
        .where('id', '=', id)
        .where('version', '=', version);
      if (scope !== 'all') {
        q = q.where(
          cfg.branchScopeColumn as string,
          'in',
          scope.length ? scope : ['00000000-0000-0000-0000-000000000000'],
        );
      }
      const row = await q.returningAll().executeTakeFirst();
      if (row) return strip(row);
      const exists = await generic(ctx)
        .selectFrom(cfg.table)
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!exists) throw notFound();
      throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
    },

    remove: async (ctx: Ctx, auth: AuthContext, id: string) => {
      await createCrudService(cfg).get(ctx, auth, id);
      try {
        await generic(ctx).deleteFrom(cfg.table).where('id', '=', id).execute();
      } catch (err) {
        if ((err as { code?: string }).code === '23503') {
          throw new AppError('IN_USE', 409, 'لا يمكن الحذف لأن السجل مستخدم، عطّله بدلاً من ذلك');
        }
        throw err;
      }
    },
  };
};

const uuidParam = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};

/** مسارات CRUD القياسية لمورد بسيط. */
export const createCrudRouter = (
  db: Db,
  cfg: CrudConfig,
  authenticate: import('express').RequestHandler,
): Router => {
  const svc = createCrudService(cfg);
  const router = Router();
  const run = <T>(
    req: import('express').Request,
    fn: (ctx: Ctx, auth: AuthContext) => Promise<T>,
  ): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

  router.use(authenticate);

  router.get('/', requirePermission(`${cfg.permission}.read`), async (req, res, next) => {
    try {
      const query = listQuery.parse(req.query);
      const { rows, total } = await run(req, (ctx, auth) => svc.list(ctx, auth, query));
      const body: ApiEnvelope<Row[]> = {
        data: rows,
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission(`${cfg.permission}.read`), async (req, res, next) => {
    try {
      const id = uuidParam(req.params['id']);
      res.json({ data: await run(req, (ctx, auth) => svc.get(ctx, auth, id)) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(`${cfg.permission}.create`), async (req, res, next) => {
    try {
      const data = cfg.create.parse(req.body);
      res.status(201).json({ data: await run(req, (ctx) => svc.create(ctx, data)) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(`${cfg.permission}.update`), async (req, res, next) => {
    try {
      const id = uuidParam(req.params['id']);
      const data = svc.updateSchema.parse(req.body) as Row & { version: number };
      res.json({ data: await run(req, (ctx, auth) => svc.update(ctx, auth, id, data)) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(`${cfg.permission}.delete`), async (req, res, next) => {
    try {
      const id = uuidParam(req.params['id']);
      await run(req, (ctx, auth) => svc.remove(ctx, auth, id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
