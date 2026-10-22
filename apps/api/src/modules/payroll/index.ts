import type { RequestHandler, Router } from 'express';
import { loanTypeInput, overrideReasonInput, payGroupInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { createCrudRouter, type CrudConfig } from '../org/index.js';
import { ensureDefaultLoanTypes } from './loan-types.js';
import { createLoansRouter } from './loans.routes.js';
import type { PdfDeps } from './payslip-pdf.routes.js';
import { createMyPayslipsRouter, createPayslipPdfRouter } from './payslip-pdf.routes.js';
import { createGlSettingsRouter } from './gl-settings.routes.js';
import { createPayslipTemplatesRouter } from './payslip-templates.routes.js';
import { createRunsRouter, type RunsDeps } from './runs.routes.js';
import { createShortfallRouter } from './shortfall.routes.js';
import { createSalariesRouter } from './salaries.routes.js';
import { createPayrollSetupRouter, makeRun } from './setup.routes.js';

/** يركّب مسارات الرواتب تحت /api/v1 */
const CRUDS: Record<string, CrudConfig> = {
  groups: {
    table: 'payGroups',
    permission: 'payroll.group',
    create: payGroupInput,
    searchColumns: ['nameAr', 'nameEn', 'code'],
    orderBy: 'code',
  },
  'loan-types': {
    table: 'loanTypes',
    permission: 'payroll.loan_type',
    create: loanTypeInput,
    searchColumns: ['nameAr', 'nameEn', 'code'],
    orderBy: 'sortOrder',
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
  api.use(
    '/payroll/payslip-templates',
    createPayslipTemplatesRouter(db, authenticate, deps.files, deps.verify),
  );
  api.use('/payroll/gl-settings', createGlSettingsRouter(db, authenticate));
  api.use('/payroll', createPayslipPdfRouter(db, authenticate, deps));
  api.use('/me/payslips', createMyPayslipsRouter(db, authenticate, deps));
  api.use('/payroll', createRunsRouter(db, authenticate, deps));
  api.use('/payroll/shortfall', createShortfallRouter(db, authenticate));
  api.use('/payroll', createLoansRouter(db, authenticate));
  // يزرع أنواع السلف الافتراضية للشركة الجديدة قبل أول قراءة
  // Seeds the default loan types for a new company before the first read
  const run = makeRun(db);
  api.get('/payroll/loan-types', authenticate, (req, _res, next) => {
    run(req, (ctx) => ensureDefaultLoanTypes(ctx)).then(() => next(), next);
  });
  for (const [path, cfg] of Object.entries(CRUDS))
    api.use(`/payroll/${path}`, createCrudRouter(db, cfg, authenticate));
  api.use('/payroll', createPayrollSetupRouter(db, authenticate));
  api.use('/employees/:employeeId/salaries', createSalariesRouter(db, authenticate));
};

export { makeRun } from './setup.routes.js';
export { ensureDefaultLoanTypes } from './loan-types.js';
export { addSalary } from './salaries.routes.js';
export { companyLang, fmtAmount } from './payslip-doc.js';

export { createPublicPayslipVerifyRouter } from './payslip-verify.js';
