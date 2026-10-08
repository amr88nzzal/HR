import type { RequestHandler, Router } from 'express';
import {
  addressInput,
  contactInput,
  dependentInput,
  contractInput,
  educationInput,
  experienceInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import { createBankRouter } from './bank.routes.js';
import { createChildRouter, type ChildConfig } from './children.routes.js';
import { createEmployeesRouter } from './employees.routes.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { createPhotoRouter } from './photo.routes.js';
import { createEmployeeImportRouter } from './import.routes.js';
import { createEmploymentsRouter } from './employments.routes.js';
import {
  createCustomFieldsRouter,
  createExternalRefResolveRouter,
  createExternalRefsRouter,
  createExternalSystemsRouter,
} from './external.routes.js';

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
  contracts: {
    table: 'contracts',
    schema: contractInput,
    orderBy: 'startDate',
    readPermission: 'employees.contract.read',
    writePermission: 'employees.contract.manage',
  },
  education: { table: 'employeeEducation', schema: educationInput, orderBy: 'endYear' },
  experience: { table: 'employeeExperience', schema: experienceInput, orderBy: 'startDate' },
};

/** يركّب مسارات الموظفين تحت /api/v1 */
export const mountEmployeesRoutes = (
  api: Router,
  db: Db,
  authenticate: RequestHandler,
  crypto: FieldCrypto | undefined,
  files: FileDeps = { storage: undefined, crypto },
): void => {
  api.use('/employee-import', createEmployeeImportRouter(db, authenticate));
  api.use('/employees', createEmployeesRouter(db, authenticate, crypto));
  api.use('/external-systems', createExternalSystemsRouter(db, authenticate));
  api.use('/external-refs', createExternalRefResolveRouter(db, authenticate));
  api.use('/custom-field-definitions', createCustomFieldsRouter(db, authenticate));
  api.use('/employees/:employeeId/external-refs', createExternalRefsRouter(db, authenticate));
  api.use('/employees/:employeeId', createEmploymentsRouter(db, authenticate));
  for (const [path, cfg] of Object.entries(CHILDREN)) {
    api.use(`/employees/:employeeId/${path}`, createChildRouter(db, authenticate, cfg));
  }
  api.use('/employees/:employeeId/photo', createPhotoRouter(db, authenticate, files));
  api.use('/employees/:employeeId/bank-accounts', createBankRouter(db, authenticate, crypto));
};

export { employeeScope, assertEmployeeVisible } from './access.js';
