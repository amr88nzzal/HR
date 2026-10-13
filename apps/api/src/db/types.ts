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

export type JobRunsTable = {
  id: Generated<string>;
  companyId: string;
  jobName: string;
  queue: 'critical' | 'default' | 'bulk' | 'render';
  bossJobId: string | null;
  status: Generated<'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'cancelled'>;
  attempt: Generated<number>;
  maxAttempts: Generated<number>;
  payload: Generated<unknown>;
  result: unknown | null;
  error: string | null;
  retryOf: string | null;
  requestedBy: string | null;
  scheduledFor: TsNullable;
  startedAt: TsNullable;
  finishedAt: TsNullable;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type NotificationsTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  eventKey: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  data: Generated<unknown>;
  readAt: TsNullable;
  isVisible: Generated<boolean>;
  createdAt: Generated<Date>;
};

export type NotificationTemplatesTable = {
  id: Generated<string>;
  companyId: string;
  eventKey: string;
  channel: 'in_app' | 'email' | 'telegram';
  locale: 'ar' | 'en';
  subject: string | null;
  body: string;
  isActive: Generated<boolean>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type NotificationDeliveriesTable = {
  id: Generated<string>;
  companyId: string;
  notificationId: string;
  channel: 'email' | 'telegram';
  toAddress: string;
  subject: string;
  body: string;
  bodyHtml: string;
  status: Generated<'pending' | 'sent' | 'failed' | 'skipped'>;
  attempts: Generated<number>;
  error: string | null;
  sentAt: TsNullable;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type NotificationPreferencesTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  category: string;
  channel: 'in_app' | 'email' | 'telegram';
  enabled: boolean;
  updatedAt: Generated<Date>;
};

export type StoredFilesTable = {
  id: Generated<string>;
  companyId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: ColumnType<string, number | string, number | string>;
  sha256: string;
  isEncrypted: Generated<boolean>;
  purpose: 'document' | 'employee_photo' | 'issued_document';
  parentId: string | null;
  variant: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
};

export type DocumentTypesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  systemKey: string | null;
  nameAr: string;
  nameEn: string | null;
  category: string | null;
  ownerType: 'employee' | 'branch' | 'company';
  isRequired: Generated<boolean>;
  isActive: Generated<boolean>;
};

export type DocumentTypeFieldsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  documentTypeId: string;
  key: string;
  labelAr: string;
  labelEn: string | null;
  dataType:
    | 'text'
    | 'long_text'
    | 'number'
    | 'date'
    | 'amount'
    | 'boolean'
    | 'select'
    | 'file'
    | 'reminder_date';
  isRequired: Generated<boolean>;
  isSensitive: Generated<boolean>;
  isUnique: Generated<boolean>;
  options: ColumnType<unknown, string | undefined, string>;
  sortOrder: Generated<number>;
  showInList: Generated<boolean>;
  isActive: Generated<boolean>;
};

export type DocumentsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  documentTypeId: string;
  ownerType: 'employee' | 'branch' | 'company';
  ownerId: string;
  values: ColumnType<Record<string, unknown>, string | undefined, string>;
  status: Generated<'active' | 'superseded'>;
  versionNo: Generated<number>;
  supersededAt: ColumnType<Date | null, string | null | undefined, string | null>;
  supersededBy: string | null;
  createdBy: string | null;
};

export type DocumentFilesTable = {
  id: Generated<string>;
  companyId: string;
  documentId: string;
  fileId: string;
  fieldKey: string | null;
  pageNo: Generated<number>;
  createdAt: Generated<Date>;
};

export type DocumentRemindersTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  documentId: string;
  fieldKey: string;
  dueDate: ColumnType<string, string, string>;
  status: Generated<'pending' | 'done' | 'dismissed'>;
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

export type ApprovalFlowsTable = {
  id: Generated<string>;
  companyId: string;
  code: string;
  requestType: string;
  nameAr: string;
  nameEn: string | null;
  isActive: Generated<boolean>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type ApprovalStepsTable = {
  id: Generated<string>;
  companyId: string;
  flowId: string;
  position: number;
  nameAr: string;
  nameEn: string | null;
  approverType: 'direct_manager' | 'manager_of_manager' | 'role' | 'user';
  approverRef: string | null;
  fallbackRoleId: string | null;
  mode: Generated<'any' | 'all'>;
  condition: ColumnType<unknown, string | null | undefined, string | null>;
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'withdrawn';

export type ApprovalRequestsTable = {
  id: Generated<string>;
  companyId: string;
  flowId: string;
  requestType: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  requesterUserId: string;
  payload: ColumnType<Record<string, unknown>, string | undefined, string>;
  status: Generated<ApprovalStatus>;
  currentStepId: string | null;
  currentPosition: number | null;
  finalNote: string | null;
  submittedAt: Generated<Date>;
  decidedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type ApprovalRequestAssigneesTable = {
  id: Generated<string>;
  companyId: string;
  requestId: string;
  stepId: string | null;
  position: number;
  userId: string;
  delegatedFromUserId: string | null;
  status: Generated<'pending' | 'acted' | 'cancelled'>;
  actedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
  createdAt: Generated<Date>;
};

export type ApprovalActionsTable = {
  id: Generated<string>;
  companyId: string;
  requestId: string;
  stepId: string | null;
  position: number | null;
  actorUserId: string;
  onBehalfOfUserId: string | null;
  action: 'submit' | 'resubmit' | 'approve' | 'reject' | 'return' | 'withdraw';
  note: string | null;
  createdAt: Generated<Date>;
};

export type ApproverDelegationsTable = {
  id: Generated<string>;
  companyId: string;
  delegatorUserId: string;
  delegateUserId: string;
  validFrom: string;
  validTo: string;
  requestType: string | null;
  note: string | null;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
};

export type LeaveTypesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isPaid: Generated<boolean>;
  allowHalfDay: Generated<boolean>;
  requiresAttachment: Generated<boolean>;
  color: string | null;
  isActive: Generated<boolean>;
};

export type LeavePoliciesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  leaveTypeId: string;
  annualEntitlement: string;
  accrualMethod: Generated<string>;
  carryOverMax: Generated<string>;
  carryOverValidMonths: number | null;
  maxNegative: Generated<string>;
  minServiceMonths: Generated<number>;
  isActive: Generated<boolean>;
};

export type LeavePolicyAssignmentsTable = {
  id: Generated<string>;
  companyId: string;
  policyId: string;
  scope: string;
  scopeRef: string | null;
  validFrom: Generated<string>;
  createdAt: Generated<Date>;
};

export type HolidaysTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  holidayDate: DateReq;
  nameAr: string;
  nameEn: string | null;
};

export type ShiftsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  color: string | null;
  lateGraceMinutes: Generated<number>;
  earlyLeaveGraceMinutes: Generated<number>;
  isActive: Generated<boolean>;
};

export type ShiftSegmentsTable = {
  id: Generated<string>;
  companyId: string;
  shiftId: string;
  position: number;
  startTime: string;
  endTime: string;
  endsNextDay: Generated<boolean>;
};

export type WorkSchedulesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: Generated<boolean>;
};

export type WorkScheduleDaysTable = {
  id: Generated<string>;
  companyId: string;
  scheduleId: string;
  weekday: number;
  shiftId: string | null;
};

export type ScheduleAssignmentsTable = {
  id: Generated<string>;
  companyId: string;
  scheduleId: string;
  scope: string;
  scopeRef: string | null;
  validFrom: DateReq;
  validTo: string | null;
  createdAt: Generated<Date>;
};

export type AttendanceRecordsTable = {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  punchedAt: ColumnType<Date, Date | string, Date | string>;
  direction: 'in' | 'out' | null;
  source: Generated<'manual' | 'import' | 'device' | 'correction'>;
  note: string | null;
  batchId: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
};

export type ImportProfilesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  delimiter: Generated<string>;
  encoding: Generated<'auto' | 'utf-8' | 'windows-1256'>;
  hasHeader: Generated<'auto' | 'yes' | 'no'>;
  columns: ColumnType<Record<string, number | string | null>, string | undefined, string>;
  dateOrder: Generated<'auto' | 'ymd' | 'dmy' | 'mdy'>;
  directionMode: Generated<'type' | 'ignore'>;
  inValues: Generated<string[]>;
  outValues: Generated<string[]>;
  systemKey: Generated<string>;
  isDefault: Generated<boolean>;
  isActive: Generated<boolean>;
};

export type ImportBatchesTable = {
  id: Generated<string>;
  companyId: string;
  profileId: string | null;
  fileName: string | null;
  fileHash: string;
  status: Generated<'applied' | 'reverted'>;
  totalRows: Generated<number>;
  inserted: Generated<number>;
  duplicates: Generated<number>;
  held: Generated<number>;
  errors: Generated<number>;
  employees: Generated<number>;
  dateFrom: ColumnType<string | null, string | null, string | null>;
  dateTo: ColumnType<string | null, string | null, string | null>;
  createdBy: string | null;
  createdAt: Generated<Date>;
  revertedAt: ColumnType<Date | null, Date | string | null, Date | string | null>;
  revertedBy: string | null;
};

export type ImportHeldRowsTable = {
  id: Generated<string>;
  companyId: string;
  batchId: string;
  lineNo: number;
  deviceCode: string;
  deviceBranch: string | null;
  deviceDepartment: string | null;
  punchedAt: ColumnType<Date, Date | string, Date | string>;
  direction: 'in' | 'out' | null;
  reason: 'unmatched' | 'ambiguous';
  status: Generated<'held' | 'resolved' | 'discarded'>;
  employeeId: string | null;
  resolvedBy: string | null;
  resolvedAt: ColumnType<Date | null, Date | string | null, Date | string | null>;
  createdAt: Generated<Date>;
};

export type AttendanceStatus =
  'present' | 'absent' | 'leave' | 'holiday' | 'off' | 'unscheduled' | 'incomplete' | 'pending';

export type AttendanceDaysTable = {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  dayDate: DateReq;
  status: AttendanceStatus;
  shiftId: string | null;
  scheduledMinutes: Generated<number>;
  firstIn: ColumnType<Date | null, Date | string | null, Date | string | null>;
  lastOut: ColumnType<Date | null, Date | string | null, Date | string | null>;
  workedMinutes: Generated<number>;
  lateMinutes: Generated<number>;
  earlyLeaveMinutes: Generated<number>;
  surplusMinutes: Generated<number>;
  overtimeMinutes: Generated<number>;
  leaveUnits: Generated<string>;
  overrideStatus: AttendanceStatus | null;
  overrideNote: string | null;
  overrideBy: string | null;
  overrideAt: ColumnType<Date | null, Date | string | null, Date | string | null>;
  baselineStatus: string | null;
  baselineWorked: number | null;
  diffWarning: Generated<boolean>;
  computedAt: Generated<Date>;
};

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export type AttendanceCorrectionsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  dayDate: DateReq;
  inAt: ColumnType<Date, Date | string, Date | string>;
  outAt: ColumnType<Date, Date | string, Date | string>;
  reason: string;
  method: 'request' | 'direct';
  status: Generated<AdjustmentStatus>;
  approvalRequestId: string | null;
  createdBy: string;
  decidedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type OvertimeRequestsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  dayDate: DateReq;
  minutes: number;
  reason: string;
  kind: 'pre' | 'post';
  status: Generated<AdjustmentStatus>;
  approvalRequestId: string | null;
  createdBy: string;
  decidedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type LetterTemplatesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  language: 'ar' | 'en';
  category: Generated<string>;
  activeVersionId: string | null;
  isActive: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type LetterTemplateVersionsTable = {
  id: Generated<string>;
  companyId: string;
  templateId: string;
  versionNo: number;
  bodyHtml: string;
  contentHash: string;
  status: Generated<'draft' | 'active' | 'archived'>;
  note: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
  activatedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
};

export type IssuedDocumentsTable = {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  templateId: string;
  templateVersionId: string;
  language: 'ar' | 'en';
  title: string;
  data: ColumnType<Record<string, unknown>, string | undefined, string>;
  templateHash: string;
  fileId: string | null;
  issuedBy: string | null;
  createdAt: Generated<Date>;
};

export type IntegrationSettingsTable = {
  id: Generated<string>;
  companyId: string;
  provider: 'email' | 'telegram';
  enabled: Generated<boolean>;
  config: ColumnType<Record<string, unknown>, string | undefined, string>;
  secretEnc: string | null;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
};

export type TelegramLinksTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  chatId: string;
  tgUsername: string | null;
  linkedAt: Generated<Date>;
};

export type TelegramLinkCodesTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  code: string;
  expiresAt: Date;
  createdAt: Generated<Date>;
};

export type LeaveLedgerTable = {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  entryType: 'accrual' | 'carry_over' | 'adjustment' | 'consumption' | 'restore' | 'expiry';
  days: string | number;
  effectiveDate: DateReq;
  expiresOn: DateCol;
  sourceEntryId: string | null;
  reversesEntryId: string | null;
  period: string | null;
  requestId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
};

export type LeaveBalancesTable = {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  balance: string;
  updatedAt: Generated<Date>;
};

export type LeaveRequestsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: DateReq;
  endDate: DateReq;
  firstDayHalf: Generated<boolean>;
  lastDayHalf: Generated<boolean>;
  reason: string | null;
  days: string | number;
  overrideDays: string | number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  status: Generated<'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled'>;
  approvalRequestId: string | null;
  cancelledAt: TsNullable;
  cancelledBy: string | null;
  createdBy: string;
};

export type LeaveRequestDaysTable = {
  companyId: string;
  requestId: string;
  dayDate: DateReq;
  units: string | number;
  kind: 'work' | 'weekend' | 'holiday';
};

export type Database = {
  leaveRequests: LeaveRequestsTable;
  leaveRequestDays: LeaveRequestDaysTable;
  leaveLedger: LeaveLedgerTable;
  leaveBalances: LeaveBalancesTable;
  telegramLinks: TelegramLinksTable;
  telegramLinkCodes: TelegramLinkCodesTable;
  integrationSettings: IntegrationSettingsTable;
  leaveTypes: LeaveTypesTable;
  leavePolicies: LeavePoliciesTable;
  leavePolicyAssignments: LeavePolicyAssignmentsTable;
  holidays: HolidaysTable;
  shifts: ShiftsTable;
  shiftSegments: ShiftSegmentsTable;
  workSchedules: WorkSchedulesTable;
  workScheduleDays: WorkScheduleDaysTable;
  scheduleAssignments: ScheduleAssignmentsTable;
  attendanceRecords: AttendanceRecordsTable;
  attendanceDays: AttendanceDaysTable;
  letterTemplates: LetterTemplatesTable;
  letterTemplateVersions: LetterTemplateVersionsTable;
  issuedDocuments: IssuedDocumentsTable;
  attendanceCorrections: AttendanceCorrectionsTable;
  overtimeRequests: OvertimeRequestsTable;
  importProfiles: ImportProfilesTable;
  importBatches: ImportBatchesTable;
  importHeldRows: ImportHeldRowsTable;
  approvalFlows: ApprovalFlowsTable;
  approvalSteps: ApprovalStepsTable;
  approvalRequests: ApprovalRequestsTable;
  approvalRequestAssignees: ApprovalRequestAssigneesTable;
  approvalActions: ApprovalActionsTable;
  approverDelegations: ApproverDelegationsTable;
  changeReasons: ChangeReasonsTable;
  contracts: ContractsTable;
  employments: EmploymentsTable;
  employmentChanges: EmploymentChangesTable;
  externalSystems: ExternalSystemsTable;
  employeeExternalRefs: EmployeeExternalRefsTable;
  customFieldDefinitions: CustomFieldDefinitionsTable;
  storedFiles: StoredFilesTable;
  jobRuns: JobRunsTable;
  notifications: NotificationsTable;
  notificationTemplates: NotificationTemplatesTable;
  notificationDeliveries: NotificationDeliveriesTable;
  notificationPreferences: NotificationPreferencesTable;
  documentTypes: DocumentTypesTable;
  documentTypeFields: DocumentTypeFieldsTable;
  documents: DocumentsTable;
  documentFiles: DocumentFilesTable;
  documentReminders: DocumentRemindersTable;
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
