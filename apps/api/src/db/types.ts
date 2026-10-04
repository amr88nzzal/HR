import type { ColumnType, Generated } from 'kysely';

/**
 * أنواع القاعدة (أسماء camelCase بفضل CamelCasePlugin). تُكتب يدوياً الآن؛
 * يمكن الانتقال لتوليدها آلياً (kysely-codegen) لاحقاً.
 */
type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNullable = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export type ScopeType = 'company' | 'branch' | 'department' | 'team' | 'self';

export type CompaniesTable = {
  id: Generated<string>;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  timezone: Generated<string>;
  defaultLocale: Generated<string>;
  status: Generated<'active' | 'suspended'>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type UsersTable = {
  id: Generated<string>;
  companyId: string;
  email: string;
  username: string | null;
  displayName: string;
  passwordHash: string;
  status: Generated<'active' | 'disabled'>;
  mustChangePassword: Generated<boolean>;
  failedAttempts: Generated<number>;
  lockedUntil: TsNullable;
  lastLoginAt: TsNullable;
  passwordChangedAt: Ts;
  totpSecret: string | null;
  totpEnabled: Generated<boolean>;
  permissionsVersion: Generated<number>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type RefreshTokensTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  deviceInfo: string | null;
  ip: string | null;
  expiresAt: Ts;
  revokedAt: TsNullable;
  replacedById: string | null;
  createdAt: Generated<Date>;
};

export type PasswordResetsTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Ts;
  usedAt: TsNullable;
  createdAt: Generated<Date>;
};

export type PermissionsTable = {
  id: Generated<string>;
  code: string;
  module: string;
  resource: string;
  action: string;
  descriptionAr: string | null;
};

export type RolesTable = {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isSystem: Generated<boolean>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type RolePermissionsTable = {
  roleId: string;
  permissionId: string;
  companyId: string;
};

export type UserRoleAssignmentsTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  createdAt: Generated<Date>;
};

export type AuditLogsTable = {
  id: Generated<string>;
  companyId: string;
  occurredAt: Generated<Date>;
  userId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  changes: ColumnType<unknown, string | null | undefined, never>;
  requestId: string | null;
  ip: string | null;
};

type Audited = {
  isActive: Generated<boolean>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type CurrenciesTable = Audited & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  symbol: string;
  symbolPosition: Generated<'before' | 'after'>;
  displayDecimals: Generated<number>;
  roundingMode: Generated<'half_up' | 'half_even' | 'down' | 'up'>;
  isBase: Generated<boolean>;
};

export type BranchesTable = Audited & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  timezone: string | null;
};

export type DepartmentsTable = Audited & {
  id: Generated<string>;
  companyId: string;
  parentId: string | null;
  code: string;
  nameAr: string;
  nameEn: string | null;
};

export type DepartmentBranchesTable = {
  departmentId: string;
  branchId: string;
  companyId: string;
};

export type JobGradesTable = Audited & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  level: Generated<number>;
};

export type JobTitlesTable = Audited & {
  id: Generated<string>;
  companyId: string;
  jobGradeId: string | null;
  code: string;
  nameAr: string;
  nameEn: string | null;
};

export type WorkLocationsTable = Audited & {
  id: Generated<string>;
  companyId: string;
  branchId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  address: string | null;
};

export type CostCentersTable = Audited & {
  id: Generated<string>;
  companyId: string;
  parentId: string | null;
  code: string;
  nameAr: string;
  nameEn: string | null;
};

export type SettingsTable = {
  id: Generated<string>;
  companyId: string;
  scopeType: 'company' | 'branch' | 'user';
  scopeId: string | null;
  key: string;
  value: ColumnType<unknown, string, string>;
  version: Generated<number>;
  updatedAt: Generated<Date>;
};

export type Database = {
  currencies: CurrenciesTable;
  branches: BranchesTable;
  departments: DepartmentsTable;
  departmentBranches: DepartmentBranchesTable;
  jobGrades: JobGradesTable;
  jobTitles: JobTitlesTable;
  workLocations: WorkLocationsTable;
  costCenters: CostCentersTable;
  settings: SettingsTable;
  companies: CompaniesTable;
  users: UsersTable;
  refreshTokens: RefreshTokensTable;
  passwordResets: PasswordResetsTable;
  permissions: PermissionsTable;
  roles: RolesTable;
  rolePermissions: RolePermissionsTable;
  userRoleAssignments: UserRoleAssignmentsTable;
  auditLogs: AuditLogsTable;
};
