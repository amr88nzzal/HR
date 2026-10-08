import express, { Router, type RequestHandler } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import { IMPORT_COLUMNS, type ImportReport } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { AppError } from '../../shared/errors.js';
import { hasPermission, requirePermission } from '../identity/index.js';
import { employeeScope } from './access.js';
import { makeRun } from './children.routes.js';
import { runImport } from './import.js';

const PERM = 'employees.employee.import';
const MAX_BYTES = 10 * 1024 * 1024;

/** إشارة داخلية للتراجع عن المعاملة مع حمل التقرير (التحقق أو وجود أخطاء). */
class Rollback extends Error {
  constructor(public readonly report: ImportReport) {
    super('rollback');
  }
}

/** /employee-import — استيراد الموظفين من Excel: تحقق (Dry Run) ثم تنفيذ بالملف نفسه. */
export const createEmployeeImportRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);

  router.get('/template', requirePermission(PERM), async (_req, res, next) => {
    try {
      const header = IMPORT_COLUMNS.map((c) => ({
        value: c.ar,
        fontWeight: 'bold' as const,
      }));
      const buf = await writeXlsxFile([header], { rightToLeft: true }).toBuffer();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', 'attachment; filename="employees-template.xlsx"');
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /employee-import?dryRun=true  → يتحقق دون حفظ (يُنفَّذ فعلياً ثم يُتراجع فتظهر أخطاء القاعدة الحقيقية).
   * POST /employee-import              → يحفظ؛ عند وجود أخطاء لا يحفظ شيئاً إلا مع skipErrors=true (تُتخطى الصفوف الخاطئة).
   */
  router.post(
    '/',
    requirePermission(PERM),
    express.raw({ type: () => true, limit: MAX_BYTES }),
    async (req, res, next) => {
      try {
        const body = req.body as unknown;
        if (!Buffer.isBuffer(body) || body.length === 0)
          throw new AppError('INVALID_FILE', 400, 'لم يُرفق ملف');
        const dryRun = req.query['dryRun'] === 'true';
        const skipErrors = req.query['skipErrors'] === 'true';
        let report: ImportReport;
        try {
          report = await run(req, async (ctx, auth) => {
            // الاستيراد يمسّ كل الموظفين: يتطلب نطاق الشركة
            if (employeeScope(auth, PERM) !== null)
              throw new AppError('FORBIDDEN', 403, 'الاستيراد يتطلب صلاحية بنطاق الشركة', {
                required: PERM,
              });
            const r = await runImport(ctx, body, {
              dryRun,
              canSetNumber: hasPermission(auth, 'employees.employee.set_number'),
            });
            if (dryRun || r.total === 0 || (r.failed > 0 && !skipErrors)) throw new Rollback(r);
            await ctx.trx
              .insertInto('auditLogs')
              .values({
                companyId: ctx.companyId,
                userId: ctx.userId,
                entityType: 'employees',
                entityId: null,
                action: 'import',
                changes: JSON.stringify({
                  total: r.total,
                  created: r.created,
                  updated: r.updated,
                  failed: r.failed,
                }),
                requestId: ctx.requestId,
                ip: req.ip ?? null,
              })
              .execute();
            return { ...r, committed: true };
          });
        } catch (err) {
          if (err instanceof Rollback) report = err.report;
          else throw err;
        }
        res.json({ data: report });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};
