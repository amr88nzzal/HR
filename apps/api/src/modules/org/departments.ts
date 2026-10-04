import { Router } from 'express';
import { sql } from 'kysely';
import { departmentInput, listQuery, withVersion, type ApiEnvelope } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { allowedBranchIds, requirePermission, type AuthContext } from '../identity/index.js';
import { ensureRefsExist, generic, type Row } from './crud.js';

const updateSchema = withVersion(departmentInput.shape);
const ZERO = '00000000-0000-0000-0000-000000000000';
const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');

const withBranches = async (ctx: Ctx, rows: Row[]): Promise<Row[]> => {
  if (rows.length === 0) return rows;
  const links = await ctx.trx
    .selectFrom('departmentBranches')
    .select(['departmentId', 'branchId'])
    .where(
      'departmentId',
      'in',
      rows.map((r) => r['id'] as string),
    )
    .execute();
  return rows.map((r) => ({
    ...r,
    branchIds: links.filter((l) => l.departmentId === r['id']).map((l) => l.branchId),
  }));
};

const strip = (row: Row): Row => {
  const rest = { ...row };
  delete rest['companyId'];
  return rest;
};

/** الأقسام المرئية: كل الأقسام لنطاق الشركة، وإلا ما يرتبط بفرع مسموح. */
const visibleFilter = (auth: AuthContext): 'all' | string[] =>
  allowedBranchIds(auth, 'org.department.read');

const assertNoCycle = async (ctx: Ctx, id: string, parentId: string) => {
  if (id === parentId)
    throw new AppError('INVALID_PARENT', 400, 'لا يمكن أن يكون القسم أباً لنفسه');
  const { rows } = await sql<{ found: boolean }>`
    with recursive up as (
      select id, parent_id from departments where id = ${parentId}
      union all
      select d.id, d.parent_id from departments d join up on d.id = up.parent_id
    ) select exists (select 1 from up where id = ${id}) as found`.execute(ctx.trx);
  if (rows[0]?.found) throw new AppError('INVALID_PARENT', 400, 'الأب المختار يسبب حلقة في الشجرة');
};

const setBranches = async (ctx: Ctx, departmentId: string, branchIds: string[]) => {
  const unique = [...new Set(branchIds)];
  await ensureRefsExist(ctx, 'branches', unique);
  const current = await ctx.trx
    .selectFrom('departmentBranches')
    .select('branchId')
    .where('departmentId', '=', departmentId)
    .execute();
  const have = new Set(current.map((c) => c.branchId));
  const toAdd = unique.filter((b) => !have.has(b));
  const toRemove = [...have].filter((b) => !unique.includes(b));
  if (toAdd.length) {
    await ctx.trx
      .insertInto('departmentBranches')
      .values(toAdd.map((branchId) => ({ departmentId, branchId, companyId: ctx.companyId })))
      .execute();
  }
  if (toRemove.length) {
    await ctx.trx
      .deleteFrom('departmentBranches')
      .where('departmentId', '=', departmentId)
      .where('branchId', 'in', toRemove)
      .execute();
  }
  if (toAdd.length || toRemove.length) {
    await ctx.trx
      .insertInto('auditLogs')
      .values({
        companyId: ctx.companyId,
        userId: ctx.userId,
        entityType: 'department_branches',
        entityId: departmentId,
        action: 'update',
        changes: JSON.stringify({ added: toAdd, removed: toRemove }),
        requestId: ctx.requestId,
        ip: null,
      })
      .execute();
  }
};

export const createDepartmentsRouter = (
  db: Db,
  authenticate: import('express').RequestHandler,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(
    req: import('express').Request,
    fn: (ctx: Ctx, auth: AuthContext) => Promise<T>,
  ) => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };
  const idOf = (v: unknown) => {
    if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
    return v;
  };

  const getOne = async (ctx: Ctx, auth: AuthContext, id: string) => {
    const scope = visibleFilter(auth);
    let q = generic(ctx).selectFrom('departments').selectAll().where('id', '=', id);
    if (scope !== 'all') {
      q = q.where(
        'id',
        'in',
        ctx.trx
          .selectFrom('departmentBranches')
          .select('departmentId')
          .where('branchId', 'in', scope.length ? scope : [ZERO]) as never,
      );
    }
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    return (await withBranches(ctx, [strip(row)]))[0] as Row;
  };

  router.get('/', requirePermission('org.department.read'), async (req, res, next) => {
    try {
      const query = listQuery.parse(req.query);
      const out = await run(req, async (ctx, auth) => {
        const scope = visibleFilter(auth);
        const build = (b: ReturnType<typeof ctx.trx.selectFrom<'departments'>>) => {
          let r = b;
          if (query.isActive !== undefined) r = r.where('isActive', '=', query.isActive);
          if (query.q) {
            const like = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;
            r = r.where((eb) =>
              eb.or([
                eb('nameAr', 'ilike', like),
                eb('nameEn', 'ilike', like),
                eb('code', 'ilike', like),
              ]),
            );
          }
          if (scope !== 'all') {
            r = r.where(
              'id',
              'in',
              ctx.trx
                .selectFrom('departmentBranches')
                .select('departmentId')
                .where('branchId', 'in', scope.length ? scope : [ZERO]),
            );
          }
          return r;
        };
        const rows = await build(ctx.trx.selectFrom('departments'))
          .selectAll()
          .orderBy('code')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute();
        const total = Number(
          (
            await build(ctx.trx.selectFrom('departments'))
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        return {
          rows: await withBranches(
            ctx,
            rows.map((r) => strip(r as Row)),
          ),
          total,
        };
      });
      const body: ApiEnvelope<Row[]> = {
        data: out.rows,
        meta: { page: query.page, pageSize: query.pageSize, total: out.total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission('org.department.read'), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      res.json({ data: await run(req, (ctx, auth) => getOne(ctx, auth, id)) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('org.department.create'), async (req, res, next) => {
    try {
      const { branchIds, ...data } = departmentInput.parse(req.body);
      const out = await run(req, async (ctx, auth) => {
        if (data.parentId) await ensureRefsExist(ctx, 'departments', [data.parentId]);
        const row = await ctx.trx
          .insertInto('departments')
          .values({
            ...data,
            nameEn: data.nameEn ?? null,
            parentId: data.parentId ?? null,
            companyId: ctx.companyId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await setBranches(ctx, row.id, branchIds);
        return getOne(
          ctx,
          {
            ...auth,
            grants: [{ code: 'org.department.read', scopeType: 'company', scopeId: null }],
          },
          row.id,
        );
      });
      res.status(201).json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission('org.department.update'), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const { branchIds, version, ...changes } = updateSchema.parse(req.body);
      const out = await run(req, async (ctx, auth) => {
        await getOne(ctx, auth, id); // 404 خارج النطاق
        if (changes.parentId) {
          await ensureRefsExist(ctx, 'departments', [changes.parentId]);
          await assertNoCycle(ctx, id, changes.parentId);
        }
        const row = await ctx.trx
          .updateTable('departments')
          .set({ ...changes, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returning('id')
          .executeTakeFirst();
        if (!row)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        if (branchIds) await setBranches(ctx, id, branchIds);
        return getOne(ctx, auth, id);
      });
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('org.department.delete'), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx, auth) => {
        await getOne(ctx, auth, id);
        const child = await ctx.trx
          .selectFrom('departments')
          .select('id')
          .where('parentId', '=', id)
          .executeTakeFirst();
        if (child) throw new AppError('IN_USE', 409, 'لا يمكن حذف قسم له أقسام فرعية');
        try {
          await ctx.trx.deleteFrom('departments').where('id', '=', id).execute();
        } catch (err) {
          if ((err as { code?: string }).code === '23503') {
            throw new AppError('IN_USE', 409, 'لا يمكن الحذف لأن القسم مستخدم، عطّله بدلاً من ذلك');
          }
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
