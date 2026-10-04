import type { RequestHandler, Router } from 'express';
import {
  branchInput,
  costCenterInput,
  currencyInput,
  jobGradeInput,
  jobTitleInput,
  workLocationInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { createAuditRouter } from './audit.js';
import { createCrudRouter, type CrudConfig } from './crud.js';
import { createDepartmentsRouter } from './departments.js';
import { createSettingsRouter } from './settings.js';

const CRUDS: Record<string, CrudConfig> = {
  branches: {
    table: 'branches',
    permission: 'system.branch',
    create: branchInput,
    searchColumns: ['nameAr', 'nameEn', 'city'],
    orderBy: 'code',
    branchScopeColumn: 'id',
  },
  currencies: {
    table: 'currencies',
    permission: 'system.currency',
    create: currencyInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'code',
  },
  'job-grades': {
    table: 'jobGrades',
    permission: 'org.job_grade',
    create: jobGradeInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'level',
  },
  'job-titles': {
    table: 'jobTitles',
    permission: 'org.job_title',
    create: jobTitleInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'code',
    refs: { jobGradeId: 'jobGrades' },
  },
  'work-locations': {
    table: 'workLocations',
    permission: 'org.work_location',
    create: workLocationInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'code',
    refs: { branchId: 'branches' },
    branchScopeColumn: 'branchId',
  },
  'cost-centers': {
    table: 'costCenters',
    permission: 'org.cost_center',
    create: costCenterInput,
    searchColumns: ['nameAr', 'nameEn'],
    orderBy: 'code',
    tree: true,
    refs: { parentId: 'costCenters' },
  },
};

/** يركّب مسارات المنظمة والإعدادات والتدقيق تحت /api/v1. */
export const mountOrgRoutes = (api: Router, db: Db, authenticate: RequestHandler): void => {
  for (const [path, cfg] of Object.entries(CRUDS))
    api.use(`/${path}`, createCrudRouter(db, cfg, authenticate));
  api.use('/departments', createDepartmentsRouter(db, authenticate));
  api.use('/settings', createSettingsRouter(db, authenticate));
  api.use('/audit-logs', createAuditRouter(db, authenticate));
};
