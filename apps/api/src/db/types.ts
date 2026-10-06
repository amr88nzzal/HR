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

type Versioned = {
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};
type DateCol = ColumnType<string | null, string | null | undefined, string | null>;

export type NumberingSequencesTable = {
  companyId: string;
  key: string;
  nextValue: ColumnType<string, number | string, number | string>;
};

export type EmployeesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeNo: string;
  firstNameAr: string;
  fatherNameAr: string | null;
  grandfatherNameAr: string | null;
  familyNameAr: string;
  firstNameEn: string | null;
  fatherNameEn: string | null;
  grandfatherNameEn: string | null;
  familyNameEn: string | null;
  fullNameAr: string;
  fullNameEn: string | null;
  searchText: Generated<string>;
  birthDate: DateCol;
  gender: 'male' | 'female' | null;
  maritalStatus: 'single' | 'married' | 'divorced' | 'widowed' | null;
  nationality: string | null;
  photoFileId: string | null;
  status: Generated<'active' | 'suspended' | 'terminated'>;
  firstHireDate: DateCol;
  userId: string | null;
  customFields: ColumnType<Record<string, unknown>, string | undefined, string>;
};

export type EmployeeContactsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  type: 'mobile' | 'phone' | 'email' | 'emergency';
  value: string;
  contactName: string | null;
  relation: string | null;
  isPrimary: Generated<boolean>;
};

export type EmployeeAddressesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  type: Generated<'home' | 'work' | 'other'>;
  country: string | null;
  city: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  isPrimary: Generated<boolean>;
};

export type EmployeeDependentsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  name: string;
  relation: 'spouse' | 'child' | 'parent' | 'other';
  birthDate: DateCol;
  gender: 'male' | 'female' | null;
  isCovered: Generated<boolean>;
  notes: string | null;
};

export type EmployeeBankAccountsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  bankName: string;
  accountHolder: string | null;
  ibanEnc: string;
  ibanDigest: string;
  ibanMasked: string;
  currency: string;
  isPrimary: Generated<boolean>;
  validFrom: DateCol;
  validTo: DateCol;
};

export type EmployeeEducationTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  degree: string;
  field: string | null;
  institution: string | null;
  country: string | null;
  startYear: number | null;
  endYear: number | null;
  grade: string | null;
};

export type EmployeeExperienceTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  employer: string;
  title: string | null;
  startDate: DateCol;
  endDate: DateCol;
  notes: string | null;
};

type DateReq = ColumnType<string, string, string>;

export type ChangeReasonsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  changeType: string;
  nameAr: string;
  nameEn: string | null;
  isActive: Generated<boolean>;
};

export type ExternalSystemsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  key: string;
  nameAr: string;
  nameEn: string | null;
  purpose: Generated<'accounting' | 'attendance_device' | 'other'>;
  refScope: Generated<'company' | 'branch'>;
  isUnique: Generated<boolean>;
  validationRegex: string | null;
  isSystem: Generated<boolean>;
  isActive: Generated<boolean>;
};

export type EmployeeExternalRefsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  systemId: string;
  value: string;
  branchId: string | null;
  validFrom: DateCol;
  validTo: DateCol;
  isPrimary: Generated<boolean>;
  enforceUnique: Generated<boolean>;
  notes: string | null;
};

export type CustomFieldDefinitionsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  entity: Generated<'employee'>;
  key: string;
  labelAr: string;
  labelEn: string | null;
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options: ColumnType<unknown[], string | undefined, string>;
  isRequired: Generated<boolean>;
  isSensitive: Generated<boolean>;
  sortOrder: Generated<number>;
  isActive: Generated<boolean>;
};

export type ContractsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  contractType: string;
  startDate: DateReq;
  endDate: DateCol;
  probationEndDate: DateCol;
  noticeDays: number | null;
  status: Generated<string>;
  fileId: string | null;
  terms: ColumnType<unknown, string | undefined, string>;
};

export type EmploymentsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  contractId: string | null;
  branchId: string;
  departmentId: string;
  jobTitleId: string | null;
  jobGradeId: string | null;
  managerEmployeeId: string | null;
  costCenterId: string | null;
  workLocationId: string | null;
  employmentType: string;
  workMode: Generated<string>;
  workCountry: string | null;
  validFrom: DateReq;
  validTo: DateCol;
};

export type EmploymentChangesTable = {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  changeType: string;
  effectiveDate: DateReq;
  reasonId: string | null;
  notes: string | null;
  fromEmploymentId: string | null;
  toEmploymentId: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
};

export type Database = {
  changeReasons: ChangeReasonsTable;
  contracts: ContractsTable;
  employments: EmploymentsTable;
  employmentChanges: EmploymentChangesTable;
  externalSystems: ExternalSystemsTable;
  employeeExternalRefs: EmployeeExternalRefsTable;
  customFieldDefinitions: CustomFieldDefinitionsTable;
  numberingSequences: NumberingSequencesTable;
  employees: EmployeesTable;
  employeeContacts: EmployeeContactsTable;
  employeeAddresses: EmployeeAddressesTable;
  employeeDependents: EmployeeDependentsTable;
  employeeBankAccounts: EmployeeBankAccountsTable;
  employeeEducation: EmployeeEducationTable;
  employeeExperience: EmployeeExperienceTable;
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
