import { navPrefInput } from '@hrms/shared';
import { Router, type Request, type RequestHandler } from 'express';
import type { Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

/** صف التفضيلات في user_table_prefs بمعرّف ثابت (بلا جدول جديد). / Stored in user_table_prefs under a fixed id (no new table). */
const TABLE_ID = 'nav.menu';

/** تفضيلات القائمة الجانبية: لكل مستخدم مسجّل ولا تخص غيره أبداً. */
export const createNavPrefsRouter = (db: Db, authenticate: RequestHandler): Router => {
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

  router.get('/', (req, res, next) => {
    run(req, async (ctx) => {
      const row = await ctx.trx
        .selectFrom('userTablePrefs')
        .select('prefs')
        .where('userId', '=', req.auth!.userId)
        .where('tableId', '=', TABLE_ID)
        .executeTakeFirst();
      // تالف/قديم يعود للافتراضي بدل أن يكسر الواجهة / corrupt or old data falls back to defaults
      const parsed = navPrefInput.safeParse(row?.prefs ?? {});
      return parsed.success ? parsed.data : navPrefInput.parse({});
    })
      .then((data) => res.json({ data }))
      .catch(next);
  });

  router.put('/', (req, res, next) => {
    const prefs = navPrefInput.parse(req.body);
    run(req, async (ctx) => {
      await ctx.trx
        .insertInto('userTablePrefs')
        .values({
          companyId: ctx.companyId,
          userId: req.auth!.userId,
          tableId: TABLE_ID,
          prefs: JSON.stringify(prefs),
        })
        .onConflict((oc) =>
          oc
            .columns(['userId', 'tableId'])
            .doUpdateSet({ prefs: JSON.stringify(prefs), updatedAt: new Date() }),
        )
        .execute();
      return prefs;
    })
      .then((data) => res.json({ data }))
      .catch(next);
  });

  router.delete('/', (req, res, next) => {
    run(req, async (ctx) => {
      await ctx.trx
        .deleteFrom('userTablePrefs')
        .where('userId', '=', req.auth!.userId)
        .where('tableId', '=', TABLE_ID)
        .execute();
    })
      .then(() => res.status(204).end())
      .catch(next);
  });
  return router;
};
