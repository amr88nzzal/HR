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
  disabledReason: ColumnType<
    'employment_ended' | null,
    'employment_ended' | null | undefined,
    'employment_ended' | null
  >;
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
  purpose:
    | 'document'
    | 'employee_photo'
    | 'issued_document'
    | 'letter_template'
    | 'brand'
    | 'report'
    | 'admin_action'
    | 'leave_request';
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

export type PayslipTemplatesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  nameAr: string;
  nameEn: string | null;
  config: ColumnType<Record<string, unknown>, string, string>;
  isDefault: Generated<boolean>;
};

export type LetterTemplatesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  language: 'ar' | 'en';
  format: Generated<'html' | 'docx'>;
  useLetterhead: Generated<boolean>;
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
  bodyHtml: string | null;
  docxFileId: string | null;
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
  docxFileId: string | null;
  issuedBy: string | null;
  docNumber: string | null;
  verifyToken: string | null;
  revokedAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
  revokedBy: string | null;
  revokeReason: string | null;
  createdAt: Generated<Date>;
};

type Dec = ColumnType<string, string | number, string | number>;
type DecNull = ColumnType<
  string | null,
  string | number | null | undefined,
  string | number | null
>;

export type PayrollBasesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  includesBasic: Generated<boolean>;
  isActive: Generated<boolean>;
};
export type RateTablesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  mode: 'progressive' | 'slab';
  brackets: ColumnType<
    { from: string; to: string | null; rate: string; fixed: string }[],
    string,
    string
  >;
  isActive: Generated<boolean>;
};
export type PayComponentsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  kind: 'earning' | 'deduction' | 'employer';
  calcType: 'fixed' | 'percent' | 'formula' | 'rate_table';
  fixedAmount: DecNull;
  percent: DecNull;
  baseId: string | null;
  formula: string | null;
  rateTableId: string | null;
  prorate: Generated<boolean>;
  roundingDecimals: Generated<number>;
  displayOrder: Generated<number>;
  isActive: Generated<boolean>;
  glAccount: string | null;
  glOffsetAccount: string | null;
};
export type PayrollGlSettingsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  salariesPayable: string | null;
  loansReceivable: string | null;
  defaultExpense: string | null;
};
export type PayComponentBasesTable = {
  companyId: string;
  baseId: string;
  componentId: string;
};
export type SalaryStructuresTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  currency: string | null;
  isActive: Generated<boolean>;
};
export type SalaryStructureComponentsTable = {
  id: Generated<string>;
  companyId: string;
  structureId: string;
  componentId: string;
  amount: DecNull;
  percent: DecNull;
};
export type EmployeeSalariesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  structureId: string | null;
  currency: string;
  basicAmount: Dec;
  validFrom: DateReq;
  validTo: DateCol;
  note: string | null;
  createdBy: string | null;
};
export type EmployeeSalaryComponentsTable = {
  id: Generated<string>;
  companyId: string;
  employeeSalaryId: string;
  componentId: string;
  amount: DecNull;
  percent: DecNull;
};

export type PayGroupsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isDefault: Generated<boolean>;
  isActive: Generated<boolean>;
};
export type PayGroupAssignmentsTable = {
  id: Generated<string>;
  companyId: string;
  payGroupId: string;
  employeeId: string;
  validFrom: DateReq;
  validTo: DateCol;
  createdAt: Generated<Date>;
};
export type OverrideReasonsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: Generated<boolean>;
};
export type PayrollPeriodsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  payGroupId: string;
  year: number;
  month: number;
  startDate: DateReq;
  endDate: DateReq;
  currency: string;
  status: Generated<'draft' | 'approved' | 'locked'>;
  calculatedAt: TsNullable;
  approvedBy: string | null;
  approvedAt: TsNullable;
  lockedBy: string | null;
  lockedAt: TsNullable;
  reopenReason: string | null;
};
export type PayrollRunsTable = {
  id: Generated<string>;
  companyId: string;
  periodId: string;
  runNo: number;
  employeesCount: number;
  errorCount: Generated<number>;
  totals: ColumnType<Record<string, unknown>, string | undefined, string>;
  createdBy: string | null;
  createdAt: Generated<Date>;
};
export type PayslipsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  periodId: string;
  employeeId: string;
  currency: string;
  status: Generated<'calculated' | 'error'>;
  basicAmount: Dec;
  grossAmount: Dec;
  deductionsAmount: Dec;
  netAmount: Dec;
  employerAmount: Dec;
  inputs: ColumnType<Record<string, unknown>, string | undefined, string>;
  warnings: ColumnType<string[], string | undefined, string>;
  error: string | null;
  hasManual: Generated<boolean>;
  loansAmount: Generated<Dec>;
  payableAmount: Generated<Dec>;
};
export type PayslipLinesTable = {
  id: Generated<string>;
  companyId: string;
  payslipId: string;
  componentId: string | null;
  code: string;
  nameAr: string;
  nameEn: string | null;
  kind: 'earning' | 'deduction' | 'employer';
  amount: Dec;
  autoAmount: DecNull;
  autoAtOverride: DecNull;
  isManual: Generated<boolean>;
  isAdded: Generated<boolean>;
  overrideReasonId: string | null;
  overrideNote: string | null;
  overrideBy: string | null;
  overrideAt: TsNullable;
  explain: ColumnType<Record<string, unknown>, string | undefined, string>;
  sortOrder: Generated<number>;
};
export type ReportRunsTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  reportCode: string;
  format: 'csv' | 'xlsx' | 'html' | 'pdf';
  mode: 'direct' | 'job';
  filters: Generated<unknown>;
  columns: Generated<unknown>;
  lang: Generated<'ar' | 'en'>;
  status: Generated<'queued' | 'running' | 'done' | 'failed'>;
  rowCount: number | null;
  fileId: string | null;
  error: string | null;
  expiresAt: Date | null;
  finishedAt: Date | null;
  createdAt: Generated<Date>;
};
export type ReportLayoutsTable = {
  id: Generated<string>;
  companyId: string;
  userId: string;
  reportCode: string;
  name: string;
  columns: unknown;
  isDefault: Generated<boolean>;
  createdAt: Generated<Date>;
};
export type AdminActionTypesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  category:
    | 'notice'
    | 'warning'
    | 'penalty'
    | 'reward_cash'
    | 'reward_moral'
    | 'commendation'
    | 'promotion'
    | 'other';
  payrollEffect: Generated<'none' | 'deduction' | 'bonus'>;
  requiresApproval: Generated<boolean>;
  requiresAcknowledgment: Generated<boolean>;
  letterTemplateCode: string | null;
  escalationTypeId: string | null;
  escalationCount: number | null;
  escalationWindowDays: number | null;
  isActive: Generated<boolean>;
};
export type AdminActionsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  typeId: string;
  status: Generated<'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled'>;
  title: string;
  description: string | null;
  actionDate: DateReq;
  effectiveDate: DateReq;
  amount: string | null;
  currency: string | null;
  payrollYear: number | null;
  payrollMonth: number | null;
  appliedPeriodId: string | null;
  promotion: unknown;
  employmentChangeId: string | null;
  salaryId: string | null;
  approvalRequestId: string | null;
  issuedDocumentId: string | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  cancelReason: string | null;
  decidedAt: Date | null;
  createdBy: string;
};
export type AdminActionAttachmentsTable = {
  id: Generated<string>;
  companyId: string;
  actionId: string;
  fileId: string;
  uploadedBy: string | null;
  createdAt: Generated<Date>;
};
export type PayslipVerifyOtpsTable = {
  id: Generated<string>;
  companyId: string;
  payslipId: string;
  channel: 'telegram' | 'email';
  codeHash: string;
  expiresAt: Date;
  attempts: Generated<number>;
  usedAt: TsNullable;
  createdAt: Generated<Date>;
};

export type LeaveRequestAttachmentsTable = {
  id: Generated<string>;
  companyId: string;
  requestId: string;
  fileId: string;
  uploadedBy: string | null;
  createdAt: Generated<Date>;
};
export type UserTablePrefsTable = {
  companyId: string;
  userId: string;
  tableId: string;
  prefs: unknown;
  updatedAt: Generated<Date>;
};
export type ShortfallPoliciesTable = Versioned & {
  companyId: string;
  isEnabled: Generated<boolean>;
  method: Generated<'minutes' | 'tiers'>;
  countLate: Generated<boolean>;
  countEarly: Generated<boolean>;
  monthlyFreeMinutes: Generated<number>;
  minutesPerDay: Generated<number>;
  tiers: Generated<unknown>;
  defaultTarget: Generated<'salary' | 'leave'>;
  leaveTypeId: string | null;
  suggestActionAfter: number | null;
};
export type ShortfallDecisionsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  year: number;
  month: number;
  target: 'salary' | 'leave' | 'split' | 'waive';
  leaveDays: string | null;
  reason: string;
  decidedBy: string | null;
};
export type PayslipShortfallsTable = {
  payslipId: string;
  companyId: string;
  employeeId: string;
  leaveTypeId: string | null;
  lateMinutes: Generated<number>;
  earlyMinutes: Generated<number>;
  occurrences: Generated<number>;
  chargeableMinutes: Generated<number>;
  daysDue: Generated<string>;
  daysLeave: Generated<string>;
  daysSalary: Generated<string>;
  target: string;
  appliedAt: Date | null;
  createdAt: Generated<Date>;
};
export type CompanyBrandTable = Versioned & {
  companyId: string;
  logoArFileId: string | null;
  logoEnFileId: string | null;
  logoDarkArFileId: string | null;
  logoDarkEnFileId: string | null;
  stampFileId: string | null;
  legalNameAr: string | null;
  legalNameEn: string | null;
  addressAr: string | null;
  addressEn: string | null;
  footerAr: string | null;
  footerEn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxNo: string | null;
  registrationNo: string | null;
};
export type LoanTypesTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  color: Generated<string>;
  disburses: Generated<boolean>;
  maxInstallments: Generated<number>;
  monthlyLimitPercent: string | null;
  glAccount: string | null;
  isActive: Generated<boolean>;
  sortOrder: Generated<number>;
};
export type LoansTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  employeeId: string;
  kind: Generated<string>;
  typeId: string;
  eventDate: ColumnType<Date | string, Date | string, Date | string>;
  reference: string | null;
  currency: string;
  principal: Dec;
  installmentsCount: number;
  firstYear: number;
  firstMonth: number;
  reason: string | null;
  status: Generated<'active' | 'settled' | 'cancelled'>;
  cancelReason: string | null;
  settlementMode: 'cash' | null;
  settlementAmount: Dec | null;
  settlementReference: string | null;
  settlementNote: string | null;
  settledAt: Date | null;
  createdBy: string | null;
};
export type LoanInstallmentsTable = {
  id: Generated<string>;
  companyId: string;
  loanId: string;
  no: number;
  dueYear: number;
  dueMonth: number;
  amount: Dec;
  status: Generated<'scheduled' | 'deducted' | 'deferred' | 'cancelled'>;
  periodId: string | null;
  payslipId: string | null;
  deferredReason: string | null;
  systemDeferred: Generated<boolean>;
  movedToId: string | null;
};
export type PayslipLoanItemsTable = {
  id: Generated<string>;
  companyId: string;
  payslipId: string;
  installmentId: string;
  amount: Dec;
  overCap: Generated<boolean>;
};
export type PaymentsTable = Versioned & {
  id: Generated<string>;
  companyId: string;
  kind: 'payslip' | 'loan';
  employeeId: string;
  periodId: string | null;
  payslipId: string | null;
  loanId: string | null;
  amount: Dec;
  currency: string;
  status: Generated<'pending' | 'paid'>;
  method: 'bank' | 'cash' | 'other' | null;
  reference: string | null;
  paidAt: string | null;
  note: string | null;
  paidBy: string | null;
};
export type PayrollInputsTable = {
  id: Generated<string>;
  companyId: string;
  periodId: string;
  employeeId: string;
  key: string;
  value: Dec;
  note: string | null;
  updatedBy: string | null;
  updatedAt: Generated<Date>;
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
  payslipTemplates: PayslipTemplatesTable;
  letterTemplateVersions: LetterTemplateVersionsTable;
  issuedDocuments: IssuedDocumentsTable;
  payrollBases: PayrollBasesTable;
  rateTables: RateTablesTable;
  payComponents: PayComponentsTable;
  payrollGlSettings: PayrollGlSettingsTable;
  payComponentBases: PayComponentBasesTable;
  salaryStructures: SalaryStructuresTable;
  salaryStructureComponents: SalaryStructureComponentsTable;
  employeeSalaries: EmployeeSalariesTable;
  employeeSalaryComponents: EmployeeSalaryComponentsTable;
  payGroups: PayGroupsTable;
  payGroupAssignments: PayGroupAssignmentsTable;
  overrideReasons: OverrideReasonsTable;
  payrollPeriods: PayrollPeriodsTable;
  payrollRuns: PayrollRunsTable;
  payslips: PayslipsTable;
  payslipLines: PayslipLinesTable;
  payrollInputs: PayrollInputsTable;
  companyBrand: CompanyBrandTable;
  reportRuns: ReportRunsTable;
  reportLayouts: ReportLayoutsTable;
  userTablePrefs: UserTablePrefsTable;
  adminActionTypes: AdminActionTypesTable;
  adminActions: AdminActionsTable;
  adminActionAttachments: AdminActionAttachmentsTable;
  leaveRequestAttachments: LeaveRequestAttachmentsTable;
  payslipVerifyOtps: PayslipVerifyOtpsTable;
  shortfallPolicies: ShortfallPoliciesTable;
  shortfallDecisions: ShortfallDecisionsTable;
  payslipShortfalls: PayslipShortfallsTable;
  loans: LoansTable;
  loanTypes: LoanTypesTable;
  loanInstallments: LoanInstallmentsTable;
  payslipLoanItems: PayslipLoanItemsTable;
  payments: PaymentsTable;
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
