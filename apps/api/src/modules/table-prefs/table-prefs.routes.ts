import { tableIdSchema, tablePrefInput } from '@hrms/shared';
import { Router, type Request, type RequestHandler } from 'express';
import type { Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

/** تفضيلات أعمدة الجداول لكل مستخدم (ترتيب وإخفاء). لكل مستخدم مسجّل، ولا تخص غيره أبداً. */
export const createTablePrefsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(req: Request, fn: Parameters<typeof withTenant<T>>[2]) => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };

  router.get('/:tableId', (req, res, next) => {
    const tableId = tableIdSchema.parse(req.params['tableId']);
    run(req, async (ctx) => {
      const row = await ctx.trx
        .selectFrom('userTablePrefs')
        .select('prefs')
        .where('userId', '=', req.auth!.userId)
        .where('tableId', '=', tableId)
        .executeTakeFirst();
      return tablePrefInput.parse(row?.prefs ?? {});
    })
      .then((data) => res.json({ data }))
      .catch(next);
  });

  router.put('/:tableId', (req, res, next) => {
    const tableId = tableIdSchema.parse(req.params['tableId']);
    const prefs = tablePrefInput.parse(req.body);
    run(req, async (ctx) => {
      await ctx.trx
        .insertInto('userTablePrefs')
        .values({
          companyId: ctx.companyId,
          userId: req.auth!.userId,
          tableId,
          prefs: JSON.stringify(prefs),
        })
        .onConflict((oc) =>
          oc.columns(['userId', 'tableId']).doUpdateSet({
            prefs: JSON.stringify(prefs),
            updatedAt: new Date(),
          }),
        )
        .execute();
      return prefs;
    })
      .then((data) => res.json({ data }))
      .catch(next);
  });

  /** إعادة الترتيب الافتراضي */
  router.delete('/:tableId', (req, res, next) => {
    const tableId = tableIdSchema.parse(req.params['tableId']);
    run(req, async (ctx) => {
      await ctx.trx
        .deleteFrom('userTablePrefs')
        .where('userId', '=', req.auth!.userId)
        .where('tableId', '=', tableId)
        .execute();
    })
      .then(() => res.status(204).end())
      .catch(next);
  });
  return router;
};
