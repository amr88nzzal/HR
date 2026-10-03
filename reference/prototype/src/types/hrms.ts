/**
 * Core Domain Types for HRMS (Human Resources Management System)
 */

export type RoleType = 'super_admin' | 'hr_manager' | 'department_manager' | 'payroll_accountant' | 'employee';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: RoleType;
  roleTitleAr: string;
  employeeId?: string;
  branchId: string;
  departmentId?: string;
  avatar?: string;
}

export interface Company {
  id: string;
  nameAr: string;
  nameEn: string;
  crNumber: string; // السجل التجاري
  taxNumber: string; // الرقم الضريبي
  socialSecurityNumber: string; // رقم المنشأة في الضمان
  phone: string;
  email: string;
  website: string;
  address: string;
  country: string;
  currency: string;
  currencySymbol: string;
  currencyDecimals: number; // 3 for Jordan (Fils)
  officialLetterFooter?: string;
}

export interface Branch {
  id: string;
  companyId: string;
  nameAr: string;
  nameEn: string;
  city: string;
  address: string;
  phone: string;
  isMain: boolean;
}

export interface Department {
  id: string;
  branchId: string;
  nameAr: string;
  nameEn: string;
  code: string;
  managerId?: string;
  costCenterCode: string;
}

export interface JobTitle {
  id: string;
  departmentId: string;
  titleAr: string;
  titleEn: string;
  grade: string;
}

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'probation';
export type EmployeeStatus = 'active' | 'on_leave' | 'suspended' | 'terminated';

export interface Employee {
  id: string;
  employeeNo: string; // رقم الموظف (مثل EMP-101)
  zktecoId: string; // معرّف جهاز البصمة
  accountingRefNo: string; // رقم المرجع في برنامج المحاسبة
  nationalId: string; // الرقم الوطني / الإقامة
  firstNameAr: string;
  secondNameAr: string;
  thirdNameAr: string;
  lastNameAr: string;
  fullNameAr: string;
  fullNameEn: string;
  email: string;
  phone: string;
  gender: 'male' | 'female';
  birthDate: string; // YYYY-MM-DD
  nationality: string;
  maritalStatus: 'single' | 'married' | 'divorced' | 'widowed';
  dependentsCount: number; // عدد المعالين (مهم للضريبة)
  
  // Employment info
  branchId: string;
  departmentId: string;
  jobTitleId: string;
  directManagerId?: string;
  hireDate: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  
  // Financial info
  basicSalary: number; // الراتب الأساسي
  housingAllowance: number; // بدل سكن
  transportAllowance: number; // بدل مواصلات
  otherAllowances: number; // بدلات أخرى
  bankName: string;
  bankIban: string; // JO...
  isSocialSecuritySubscribed: boolean; // خاضع للضمان الاجتماعي
  customSalarySocialSecurity?: number; // راتب الضمان (إن اختلف عن الإجمالي)

  // Leave Balances
  annualLeaveBalance: number; // رصيد الإجازات السنوية الحالي
  sickLeaveBalance: number;
}

export interface Shift {
  id: string;
  nameAr: string;
  startTime: string; // HH:mm (e.g. 08:30)
  endTime: string;   // HH:mm (e.g. 17:00)
  graceMinutesLate: number; // سماح التأخير (15 دقيقة)
  graceMinutesEarly: number; // سماح الخروج المبكر (10 دقائق)
  totalWorkHours: number; // 8.5
  isNightShift: boolean; // يعبر منتصف الليل
}

export interface WorkSchedule {
  id: string;
  nameAr: string;
  shiftId: string;
  workingDays: number[]; // 0=Sunday, 1=Monday, ... 5=Friday, 6=Saturday
}

export type AttendanceSource = 'zkteco_device' | 'manual_entry' | 'web_punch' | 'mobile_gps';
export type PunchType = 'in' | 'out' | 'break_in' | 'break_out';

export interface RawAttendanceLog {
  id: string;
  zktecoEmpId: string;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  timestamp: string; // YYYY-MM-DD HH:mm:ss
  punchType: PunchType;
  source: AttendanceSource;
  rawString?: string;
  importedAt: string;
}

export type DayAttendanceStatus = 'present' | 'absent' | 'leave' | 'holiday' | 'weekend' | 'incomplete';

export interface DailyAttendanceRecord {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  firstIn?: string; // HH:mm
  lastOut?: string; // HH:mm
  totalWorkedMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  status: DayAttendanceStatus;
  shiftId: string;
  isOverridden: boolean;
  overrideReason?: string;
  overrideBy?: string;
  notes?: string;
}

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'paternity' | 'bereavement' | 'marriage';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalDays: number;
  reason: string;
  attachmentName?: string;
  status: LeaveRequestStatus;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

export interface Loan {
  id: string;
  employeeId: string;
  amount: number;
  monthlyInstallment: number;
  installmentsCount: number;
  remainingAmount: number;
  startDate: string; // YYYY-MM
  status: 'active' | 'completed' | 'cancelled';
  notes?: string;
}

export interface EmployeeDebtInvoice {
  id: string;
  employeeId: string;
  invoiceNo: string;
  description: string;
  amount: number;
  date: string;
  isDeducted: boolean;
  notes?: string;
}

export interface PayslipLine {
  id: string;
  code: string;
  nameAr: string;
  type: 'earning' | 'statutory_deduction' | 'debt_deduction' | 'employer_contribution';
  amount: number;
  calcExplanation: string; // توضيح كيف حُسبت القيمة
  isManualOverride: boolean;
}

export interface Payslip {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  accountingRefNo: string;
  nationalId: string;
  departmentName: string;
  jobTitle: string;
  bankName: string;
  bankIban: string;
  
  // Working days summary
  standardWorkDays: number; // 30
  actualPresentDays: number;
  absentDays: number;
  lateDeductionDays: number;
  overtimeHours: number;
  
  // 1. Total Gross Earnings
  basicSalary: number;
  grossEarnings: number; // إجمالي الراتب والبدلات

  // 2. Statutory & Attendance Deductions
  statutoryDeductions: number; // الضمان + الضريبة + الغياب والتأخيرات

  // 3. Net Salary Before Loans and Receivables
  netSalaryBeforeLoans: number; // صافي الراتب قبل السلف والذمم

  // 4. Loans & Employee Receivables Deductions
  loanDeduction: number; // أقساط السلف
  receivablesDeduction: number; // فواتير الذمم والمشتريات والعهد المستردة
  totalDebtsAndLoans: number; // إجمالي السلف والذمم

  // 5. Final Net Payable
  finalNetPayable: number; // الصافي النهائي المستحق للتسديد للموظف

  // Backwards compatibility alias
  netSalary: number; 

  companySocialSecurityCost: number; // مساهمة الشركة في الضمان (14.25%)
  
  lines: PayslipLine[];
  warnings: string[];
  isManualOverride: boolean;
  notes?: string;
}

export type PayrollRunStatus = 'draft' | 'calculated' | 'under_review' | 'approved' | 'paid';

export interface PayrollRun {
  id: string;
  month: string; // YYYY-MM (e.g. 2026-10)
  titleAr: string; // كشف الرواتب الشهرية لشهر 2026-10
  status: PayrollRunStatus;
  currency: string;
  totalEmployees: number;
  totalGross: number; // إجمالي الاستحقاقات
  totalStatutoryDeductions: number; // إجمالي الاستقطاعات النظامية
  totalNetBeforeLoans: number; // إجمالي الصافي قبل السلف والذمم
  totalLoansAndDebts: number; // إجمالي السلف والذمم
  totalFinalNetPayable: number; // إجمالي الصافي النهائي المستحق للتسديد
  totalNet: number; // alias for final net payable
  totalCompanySocialSecurity: number;
  calculatedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  payslips: Payslip[];
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userName: string;
  action: string;
  actionType: 'create' | 'update' | 'delete' | 'approve' | 'override' | 'import';
  module: 'employees' | 'attendance' | 'leaves' | 'payroll' | 'settings' | 'documents';
  description: string;
  details?: Record<string, any>;
}

export interface SystemSettings {
  companyNameAr: string;
  companyNameEn: string;
  currency: string;
  currencySymbol: string;
  currencyDecimals: number;
  
  // Working Schedule & Attendance Policy
  workDays: number[]; // [6, 0, 1, 2, 3, 4] Sat to Thu
  weekendDays: number[]; // [5] Fri
  defaultShiftStartTime: string; // "08:30"
  defaultShiftEndTime: string; // "17:00"
  graceMinutesLate: number; // 15
  graceMinutesEarly: number; // 10
  overtimeNormalRate: number; // 1.25
  overtimeWeekendRate: number; // 1.50
  incompletePunchPolicy: 'absent' | 'half_day' | 'alert_only';

  // Payroll Calculation Policy
  salaryDayBasis: 'fixed_30' | 'actual_month_days' | 'actual_work_days';
  salaryPayDayOfMonth: number; // e.g. 28th
  lateDeductionPolicy: 'cumulative_hours' | 'quarter_day_after_hour' | 'strict_minutes';
  
  // Social Security Rules (Jordan)
  socialSecurityEnabled: boolean;
  employeeSocialSecurityRate: number; // 0.075 (7.5%)
  companySocialSecurityRate: number;  // 0.1425 (14.25%)
  socialSecurityMinSalary: number; // 260 JD (الحد الأدنى للأجور بالأردن)
  socialSecurityMaxSalaryCap: number; // 3612 JD سقف الراتب الخاضع

  // Income Tax Rules (Jordan)
  incomeTaxEnabled: boolean;
  incomeTaxPersonalExemptionYearly: number; // 9000 JD
  incomeTaxDependentExemptionYearly: number; // 9000 JD

  // Leave Policies
  annualLeaveInitialDays: number; // 14
  annualLeaveSeniorDays: number; // 21 (after 5 years)
  annualLeaveSeniorityYears: number; // 5
  sickLeaveDays: number; // 14
  maxLeaveCarryOverDays: number; // 7 days
  leaveNoticeDaysRequired: number; // 2 days

  // Loans & Receivables Policy
  maxLoanMultiplierOfSalary: number; // e.g. 2x basic salary
  maxLoanInstallmentsMonths: number; // e.g. 12 months
  maxMonthlyDeductionPercent: number; // e.g. 30% of net salary
  receivablesDeductionEnabled: boolean;

  // ZKTeco Device Format
  zktecoSeparator: string; // ";"
  zktecoFormatGuide: string; // "Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ"
  zktecoCodeIn: string; // "1"
  zktecoCodeOut: string; // "0"
  zktecoCodeBreakIn: string; // "3"
  zktecoCodeBreakOut: string; // "4"
  zktecoDefaultPort: number; // 4370
}
