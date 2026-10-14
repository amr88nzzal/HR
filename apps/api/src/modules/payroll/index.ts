import type { RequestHandler, Router } from 'express';
import type { Db } from '../../db/index.js';
import { createSalariesRouter } from './salaries.routes.js';
import { createPayrollSetupRouter } from './setup.routes.js';

/** يركّب مسارات الرواتب تحت /api/v1 */
export const mountPayrollRoutes = (api: Router, db: Db, authenticate: RequestHandler): void => {
  api.use('/payroll', createPayrollSetupRouter(db, authenticate));
  api.use('/employees/:employeeId/salaries', createSalariesRouter(db, authenticate));
};
