import type { RequestHandler, Router } from 'express';
import {
  addressInput,
  contactInput,
  dependentInput,
  educationInput,
  experienceInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import { createBankRouter } from './bank.routes.js';
import { createChildRouter, type ChildConfig } from './children.routes.js';
import { createEmployeesRouter } from './employees.routes.js';

const CHILDREN: Record<string, ChildConfig> = {
  contacts: {
    table: 'employeeContacts',
    schema: contactInput,
    orderBy: 'type',
    primaryGroup: ['type'],
  },
  addresses: {
    table: 'employeeAddresses',
    schema: addressInput,
    orderBy: 'type',
    primaryGroup: [],
  },
  dependents: { table: 'employeeDependents', schema: dependentInput, orderBy: 'relation' },
  education: { table: 'employeeEducation', schema: educationInput, orderBy: 'endYear' },
  experience: { table: 'employeeExperience', schema: experienceInput, orderBy: 'startDate' },
};

/** يركّب مسارات الموظفين تحت /api/v1 */
export const mountEmployeesRoutes = (
  api: Router,
  db: Db,
  authenticate: RequestHandler,
  crypto: FieldCrypto | undefined,
): void => {
  api.use('/employees', createEmployeesRouter(db, authenticate));
  for (const [path, cfg] of Object.entries(CHILDREN)) {
    api.use(`/employees/:employeeId/${path}`, createChildRouter(db, authenticate, cfg));
  }
  api.use('/employees/:employeeId/bank-accounts', createBankRouter(db, authenticate, crypto));
};
