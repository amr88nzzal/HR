import type { RequestHandler, Router } from 'express';
import { holidayInput, leavePolicyInput, leaveTypeInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { createCrudRouter, type CrudConfig } from '../org/index.js';
import { createAssignmentsRouter } from './assignments.js';

export { resolvePolicy } from './assignments.js';

const CRUDS: Record<string, CrudConfig> = {
  'leave-types': {
    table: 'leaveTypes',
    permission: 'leave.type',
    create: leaveTypeInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'code',
  },
  'leave-policies': {
    table: 'leavePolicies',
    permission: 'leave.policy',
    create: leavePolicyInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'code',
    refs: { leaveTypeId: 'leaveTypes' },
  },
  holidays: {
    table: 'holidays',
    permission: 'leave.holiday',
    create: holidayInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'holidayDate',
    codeless: true,
  },
};

/** يركّب مسارات الإجازات (النواة) تحت /api/v1 */
export const mountLeaveRoutes = (api: Router, db: Db, authenticate: RequestHandler): void => {
  for (const [path, cfg] of Object.entries(CRUDS))
    api.use(`/${path}`, createCrudRouter(db, cfg, authenticate));
  api.use('/leave-policy-assignments', createAssignmentsRouter(db, authenticate));
};
