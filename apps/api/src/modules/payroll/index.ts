import type { RequestHandler, Router } from 'express';
import { overrideReasonInput, payGroupInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { createCrudRouter, type CrudConfig } from '../org/index.js';
import { createLoansRouter } from './loans.routes.js';
import type { PdfDeps } from './payslip-pdf.routes.js';
import { createMyPayslipsRouter, createPayslipPdfRouter } from './payslip-pdf.routes.js';
import { createRunsRouter, type RunsDeps } from './runs.routes.js';
import { createSalariesRouter } from './salaries.routes.js';
import { createPayrollSetupRouter } from './setup.routes.js';

/** يركّب مسارات الرواتب تحت /api/v1 */
const CRUDS: Record<string, CrudConfig> = {
  groups: {
    table: 'payGroups',
    permission: 'payroll.group',
    create: payGroupInput,
    searchColumns: ['nameAr', 'nameEn', 'code'],
    orderBy: 'code',
  },
  'override-reasons': {
    table: 'overrideReasons',
    permission: 'payroll.override_reason',
    create: overrideReasonInput,
    searchColumns: ['nameAr', 'nameEn', 'code'],
    orderBy: 'code',
  },
};

export const mountPayrollRoutes = (
  api: Router,
  db: Db,
  authenticate: RequestHandler,
  deps: RunsDeps & PdfDeps,
): void => {
  // الأخصّ أولاً: مسارات الدورات والقسائم ثم CRUD المجموعات والأسباب ثم الإعداد
  api.use('/payroll', createPayslipPdfRouter(db, authenticate, deps));
  api.use('/me/payslips', createMyPayslipsRouter(db, authenticate, deps));
  api.use('/payroll', createRunsRouter(db, authenticate, deps));
  api.use('/payroll', createLoansRouter(db, authenticate));
  for (const [path, cfg] of Object.entries(CRUDS))
    api.use(`/payroll/${path}`, createCrudRouter(db, cfg, authenticate));
  api.use('/payroll', createPayrollSetupRouter(db, authenticate));
  api.use('/employees/:employeeId/salaries', createSalariesRouter(db, authenticate));
};

export { makeRun } from './setup.routes.js';
export { companyLang } from './payslip-doc.js';
