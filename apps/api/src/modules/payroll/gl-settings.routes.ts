import { Router, type Request, type RequestHandler, type Response } from 'express';
import { payrollGlSettingsInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { requirePermission } from '../identity/index.js';
import { makeRun } from './setup.routes.js';

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * حسابات المحاسبة العامة لقيد الرواتب (صف واحد لكل شركة).
 * Company-level GL accounts for the payroll journal (one row per company).
 */
export const createGlSettingsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  const empty = { salariesPayable: null, loansReceivable: null, defaultExpense: null };

  router.get(
    '/',
    requirePermission('payroll.accounting.read'),
    wrap(async (req, res) => {
      const row = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('payrollGlSettings')
          .select(['salariesPayable', 'loansReceivable', 'defaultExpense'])
          .where('companyId', '=', ctx.companyId)
          .executeTakeFirst(),
      );
      res.json({ data: row ?? empty });
    }),
  );

  router.put(
    '/',
    requirePermission('payroll.accounting.manage'),
    wrap(async (req, res) => {
      const b = payrollGlSettingsInput.parse(req.body);
      const row = await run(req, (ctx) =>
        ctx.trx
          .insertInto('payrollGlSettings')
          .values({ companyId: ctx.companyId, ...b })
          .onConflict((oc) =>
            oc
              .column('companyId')
              .doUpdateSet({ ...b, version: (eb) => eb('payrollGlSettings.version', '+', 1) }),
          )
          .returning(['salariesPayable', 'loansReceivable', 'defaultExpense'])
          .executeTakeFirstOrThrow(),
      );
      res.json({ data: row });
    }),
  );
  return router;
};
