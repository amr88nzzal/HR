import {
  Company,
  Branch,
  Department,
  JobTitle,
  Employee,
  Shift,
  DailyAttendanceRecord,
  RawAttendanceLog,
  LeaveRequest,
  Loan,
  EmployeeDebtInvoice,
  PayrollRun,
  AuditLogItem,
  SystemSettings,
  UserSession
} from '../types/hrms';
import { apiService } from './api';

const STORAGE_KEYS = {
  COMPANY: 'hrms_company_v2',
  BRANCHES: 'hrms_branches_v2',
  DEPARTMENTS: 'hrms_departments_v2',
  JOB_TITLES: 'hrms_job_titles_v2',
  EMPLOYEES: 'hrms_employees_v2',
  SHIFTS: 'hrms_shifts_v2',
  ATTENDANCE_LOGS: 'hrms_raw_logs_v2',
  ATTENDANCE_DAYS: 'hrms_attendance_days_v2',
  LEAVES: 'hrms_leaves_v2',
  LOANS: 'hrms_loans_v2',
  DEBTS: 'hrms_debts_v2',
  PAYROLL_RUNS: 'hrms_payroll_runs_v2',
  AUDIT_LOGS: 'hrms_audit_logs_v2',
  SETTINGS: 'hrms_settings_v2',
  SESSION: 'hrms_session_v2'
};

export const DEFAULT_SETTINGS: SystemSettings = {
  companyNameAr: 'شركة النخبة للحلول والتقنية الذكية ذ.م.م',
  companyNameEn: 'Elite Smart Solutions & Tech LLC',
  currency: 'JOD',
  currencySymbol: 'د.أ',
  currencyDecimals: 3,
  workDays: [6, 0, 1, 2, 3, 4], // Saturday to Thursday
  weekendDays: [5], // Friday
  defaultShiftStartTime: '08:30',
  defaultShiftEndTime: '17:00',
  graceMinutesLate: 15,
  graceMinutesEarly: 10,
  overtimeNormalRate: 1.25,
  overtimeWeekendRate: 1.50,
  incompletePunchPolicy: 'alert_only',

  salaryDayBasis: 'fixed_30',
  salaryPayDayOfMonth: 28,
  lateDeductionPolicy: 'cumulative_hours',

  socialSecurityEnabled: true,
  employeeSocialSecurityRate: 0.075,
  companySocialSecurityRate: 0.1425,
  socialSecurityMinSalary: 260.000,
  socialSecurityMaxSalaryCap: 3612.000,

  incomeTaxEnabled: true,
  incomeTaxPersonalExemptionYearly: 9000,
  incomeTaxDependentExemptionYearly: 9000,

  annualLeaveInitialDays: 14,
  annualLeaveSeniorDays: 21,
  annualLeaveSeniorityYears: 5,
  sickLeaveDays: 14,
  maxLeaveCarryOverDays: 7,
  leaveNoticeDaysRequired: 2,

  maxLoanMultiplierOfSalary: 2,
  maxLoanInstallmentsMonths: 12,
  maxMonthlyDeductionPercent: 30,
  receivablesDeductionEnabled: true,

  zktecoSeparator: ';',
  zktecoFormatGuide: 'Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ',
  zktecoCodeIn: '1',
  zktecoCodeOut: '0',
  zktecoCodeBreakIn: '3',
  zktecoCodeBreakOut: '4',
  zktecoDefaultPort: 4370
};

export const INITIAL_COMPANY: Company = {
  id: 'comp-01',
  nameAr: 'شركة النخبة للحلول والتقنية الذكية ذ.م.م',
  nameEn: 'Elite Smart Solutions & Tech LLC',
  crNumber: '200154897',
  taxNumber: '110023458',
  socialSecurityNumber: '4452109',
  phone: '+962 6 560 1234',
  email: 'info@elite-tech.jo',
  website: 'https://elite-tech.jo',
  address: 'عمان - الشميساني - شارع عبد الحميد شرف - مجمع النخبة التجاري',
  country: 'المملكة الأردنية الهاشمية',
  currency: 'JOD',
  currencySymbol: 'د.أ',
  currencyDecimals: 3,
  officialLetterFooter: 'وثيقة رسمية صادرة إلكترونياً من نظام شؤون الموظفين (HRMS) وتعتبر نافذة بموجب أحكام المعاملات الإلكترونية'
};

export const INITIAL_BRANCHES: Branch[] = [
  {
    id: 'br-amm',
    companyId: 'comp-01',
    nameAr: 'الفرع الرئيسي - عمان',
    nameEn: 'Amman Main Branch',
    city: 'عمان',
    address: 'الشميساني، عمان',
    phone: '+962 6 560 1234',
    isMain: true
  },
  {
    id: 'br-irb',
    companyId: 'comp-01',
    nameAr: 'فرع إربد',
    nameEn: 'Irbid Branch',
    city: 'إربد',
    address: 'شارع الجامعة، إربد',
    phone: '+962 2 720 5678',
    isMain: false
  },
  {
    id: 'br-aqb',
    companyId: 'comp-01',
    nameAr: 'فرع العقبة',
    nameEn: 'Aqaba Branch',
    city: 'العقبة',
    address: 'شارع الكورنيش، العقبة',
    phone: '+962 3 201 9876',
    isMain: false
  }
];

export const INITIAL_DEPARTMENTS: Department[] = [
  { id: 'dept-it', branchId: 'br-amm', nameAr: 'تكنولوجيا المعلومات وتطوير البرمجيات', nameEn: 'Information Technology', code: 'IT-01', costCenterCode: 'CC-101', managerId: 'emp-101' },
  { id: 'dept-hr', branchId: 'br-amm', nameAr: 'الموارد البشرية والشؤون الإدارية', nameEn: 'Human Resources', code: 'HR-01', costCenterCode: 'CC-102', managerId: 'emp-102' },
  { id: 'dept-fin', branchId: 'br-amm', nameAr: 'المالية والمحاسبة', nameEn: 'Finance & Accounting', code: 'FIN-01', costCenterCode: 'CC-103', managerId: 'emp-103' },
  { id: 'dept-sales', branchId: 'br-amm', nameAr: 'المبيعات والتسويق', nameEn: 'Sales & Marketing', code: 'SALES-01', costCenterCode: 'CC-104', managerId: 'emp-105' },
  { id: 'dept-ops', branchId: 'br-irb', nameAr: 'العمليات والدعم الفني', nameEn: 'Operations & Support', code: 'OPS-01', costCenterCode: 'CC-105', managerId: 'emp-106' }
];

export const INITIAL_JOB_TITLES: JobTitle[] = [
  { id: 'job-1', departmentId: 'dept-it', titleAr: 'مطور برمجيات أول (Senior Developer)', titleEn: 'Senior Software Developer', grade: 'A1' },
  { id: 'job-2', departmentId: 'dept-it', titleAr: 'مهندس جودة وبرمجيات (QA Engineer)', titleEn: 'QA Engineer', grade: 'B1' },
  { id: 'job-3', departmentId: 'dept-hr', titleAr: 'مدير الموارد البشرية (HR Manager)', titleEn: 'HR Manager', grade: 'M1' },
  { id: 'job-4', departmentId: 'dept-hr', titleAr: 'أخصائي شؤون موظفين (HR Specialist)', titleEn: 'HR Specialist', grade: 'B2' },
  { id: 'job-5', departmentId: 'dept-fin', titleAr: 'مدير مالي ومحاسب رئيسي', titleEn: 'Chief Accountant', grade: 'M2' },
  { id: 'job-6', departmentId: 'dept-sales', titleAr: 'مدير مبيعات أول', titleEn: 'Senior Sales Manager', grade: 'B1' },
  { id: 'job-7', departmentId: 'dept-ops', titleAr: 'فني دعم مكتبي وميداني', titleEn: 'Support Technician', grade: 'C1' }
];

export const INITIAL_SHIFTS: Shift[] = [
  {
    id: 'shift-standard',
    nameAr: 'الدوام الصباحي الرسمي (السبت - الخميس)',
    startTime: '08:30',
    endTime: '17:00',
    graceMinutesLate: 15,
    graceMinutesEarly: 10,
    totalWorkHours: 8.5,
    isNightShift: false
  },
  {
    id: 'shift-flexible',
    nameAr: 'الدوام المرن للتقنية (09:00 - 17:30)',
    startTime: '09:00',
    endTime: '17:30',
    graceMinutesLate: 20,
    graceMinutesEarly: 10,
    totalWorkHours: 8.5,
    isNightShift: false
  }
];

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'emp-101',
    employeeNo: 'EMP-101',
    zktecoId: '101',
    accountingRefNo: 'ACC-501',
    nationalId: '9881023456',
    firstNameAr: 'أحمد',
    secondNameAr: 'محمد',
    thirdNameAr: 'عادل',
    lastNameAr: 'النجار',
    fullNameAr: 'أحمد محمد عادل النجار',
    fullNameEn: 'Ahmad M. Al-Najjar',
    email: 'ahmad.najjar@elite-tech.jo',
    phone: '0795551234',
    gender: 'male',
    birthDate: '1988-05-14',
    nationality: 'أردني',
    maritalStatus: 'married',
    dependentsCount: 3,
    branchId: 'br-amm',
    departmentId: 'dept-it',
    jobTitleId: 'job-1',
    hireDate: '2021-03-01',
    employmentType: 'full_time',
    status: 'active',
    basicSalary: 1450.000,
    housingAllowance: 200.000,
    transportAllowance: 100.000,
    otherAllowances: 50.000,
    bankName: 'البنك العربي - فرع الشميساني',
    bankIban: 'JO94ARAB0120000001011234567890',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 18,
    sickLeaveBalance: 14
  },
  {
    id: 'emp-102',
    employeeNo: 'EMP-102',
    zktecoId: '102',
    accountingRefNo: 'ACC-502',
    nationalId: '9922034567',
    firstNameAr: 'رانية',
    secondNameAr: 'خالد',
    thirdNameAr: 'توفيق',
    lastNameAr: 'المجالي',
    fullNameAr: 'رانية خالد توفيق المجالي',
    fullNameEn: 'Rania K. Al-Majali',
    email: 'rania.majali@elite-tech.jo',
    phone: '0788884321',
    gender: 'female',
    birthDate: '1992-11-20',
    nationality: 'أردنية',
    maritalStatus: 'single',
    dependentsCount: 0,
    branchId: 'br-amm',
    departmentId: 'dept-hr',
    jobTitleId: 'job-3',
    hireDate: '2022-01-15',
    employmentType: 'full_time',
    status: 'active',
    basicSalary: 1200.000,
    housingAllowance: 150.000,
    transportAllowance: 100.000,
    otherAllowances: 0,
    bankName: 'بنك الإسكان للتجارة والتمويل',
    bankIban: 'JO22HBTF0100000002029876543210',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 14,
    sickLeaveBalance: 14
  },
  {
    id: 'emp-103',
    employeeNo: 'EMP-103',
    zktecoId: '103',
    accountingRefNo: 'ACC-503',
    nationalId: '9851045678',
    firstNameAr: 'عمر',
    secondNameAr: 'سمير',
    thirdNameAr: 'عبد الله',
    lastNameAr: 'الزبيدي',
    fullNameAr: 'عمر سمير عبد الله الزبيدي',
    fullNameEn: 'Omar S. Al-Zubaidi',
    email: 'omar.zubaidi@elite-tech.jo',
    phone: '0777779876',
    gender: 'male',
    birthDate: '1985-09-08',
    nationality: 'أردني',
    maritalStatus: 'married',
    dependentsCount: 2,
    branchId: 'br-amm',
    departmentId: 'dept-fin',
    jobTitleId: 'job-5',
    hireDate: '2020-06-01',
    employmentType: 'full_time',
    status: 'active',
    basicSalary: 1600.000,
    housingAllowance: 250.000,
    transportAllowance: 100.000,
    otherAllowances: 100.000,
    bankName: 'بنك الاتحاد - فرع عمان',
    bankIban: 'JO55UBSI0130000003034567891234',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 21,
    sickLeaveBalance: 14
  },
  {
    id: 'emp-104',
    employeeNo: 'EMP-104',
    zktecoId: '104',
    accountingRefNo: 'ACC-504',
    nationalId: '9952056789',
    firstNameAr: 'سارة',
    secondNameAr: 'جمال',
    thirdNameAr: 'منير',
    lastNameAr: 'حداد',
    fullNameAr: 'سارة جمال منير حداد',
    fullNameEn: 'Sara J. Haddad',
    email: 'sara.haddad@elite-tech.jo',
    phone: '0799991122',
    gender: 'female',
    birthDate: '1995-03-25',
    nationality: 'أردنية',
    maritalStatus: 'married',
    dependentsCount: 1,
    branchId: 'br-irb',
    departmentId: 'dept-it',
    jobTitleId: 'job-2',
    hireDate: '2023-04-10',
    employmentType: 'full_time',
    status: 'active',
    basicSalary: 950.000,
    housingAllowance: 100.000,
    transportAllowance: 80.000,
    otherAllowances: 0,
    bankName: 'بنك القاهرة عمان - فرع إربد',
    bankIban: 'JO68CABK0140000004041122334455',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 12,
    sickLeaveBalance: 14
  },
  {
    id: 'emp-105',
    employeeNo: 'EMP-105',
    zktecoId: '105',
    accountingRefNo: 'ACC-505',
    nationalId: '9901067890',
    firstNameAr: 'طارق',
    secondNameAr: 'فيصل',
    thirdNameAr: 'بسام',
    lastNameAr: 'القيسي',
    fullNameAr: 'طارق فيصل بسام القيسي',
    fullNameEn: 'Tareq F. Al-Qaisi',
    email: 'tareq.qaisi@elite-tech.jo',
    phone: '0785559988',
    gender: 'male',
    birthDate: '1990-08-17',
    nationality: 'أردني',
    maritalStatus: 'single',
    dependentsCount: 0,
    branchId: 'br-amm',
    departmentId: 'dept-sales',
    jobTitleId: 'job-6',
    hireDate: '2022-09-01',
    employmentType: 'full_time',
    status: 'active',
    basicSalary: 1100.000,
    housingAllowance: 150.000,
    transportAllowance: 150.000,
    otherAllowances: 200.000,
    bankName: 'البنك الأردني الكويتي',
    bankIban: 'JO33JKBK0150000005059988776655',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 14,
    sickLeaveBalance: 14
  },
  {
    id: 'emp-106',
    employeeNo: 'EMP-106',
    zktecoId: '106',
    accountingRefNo: 'ACC-506',
    nationalId: '9971078901',
    firstNameAr: 'يزيد',
    secondNameAr: 'نبيل',
    thirdNameAr: 'سليمان',
    lastNameAr: 'الخطيب',
    fullNameAr: 'يزيد نبيل سليمان الخطيب',
    fullNameEn: 'Yazeed N. Al-Khatib',
    email: 'yazeed.khatib@elite-tech.jo',
    phone: '0771234567',
    gender: 'male',
    birthDate: '1997-12-05',
    nationality: 'أردني',
    maritalStatus: 'single',
    dependentsCount: 0,
    branchId: 'br-irb',
    departmentId: 'dept-ops',
    jobTitleId: 'job-7',
    hireDate: '2024-02-01',
    employmentType: 'probation',
    status: 'active',
    basicSalary: 650.000,
    housingAllowance: 50.000,
    transportAllowance: 50.000,
    otherAllowances: 0,
    bankName: 'البنك الأهلي الأردني',
    bankIban: 'JO12JONB0160000006063344556677',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 14,
    sickLeaveBalance: 14
  }
];

export const INITIAL_LEAVES: LeaveRequest[] = [
  {
    id: 'leave-1',
    employeeId: 'emp-101',
    leaveType: 'annual',
    startDate: '2026-10-10',
    endDate: '2026-10-12',
    totalDays: 3,
    reason: 'إجازة عائلية خاصة',
    status: 'approved',
    submittedAt: '2026-10-01 09:30:00',
    reviewedBy: 'رانية المجالي (مدير HR)',
    reviewedAt: '2026-10-01 11:15:00'
  },
  {
    id: 'leave-2',
    employeeId: 'emp-104',
    leaveType: 'sick',
    startDate: '2026-10-04',
    endDate: '2026-10-04',
    totalDays: 1,
    reason: 'مراجعة طبية طارئة وتقرير طبي مرفق',
    attachmentName: 'medical_report_oct4.pdf',
    status: 'approved',
    submittedAt: '2026-10-04 08:10:00',
    reviewedBy: 'رانية المجالي (مدير HR)',
    reviewedAt: '2026-10-04 09:00:00'
  },
  {
    id: 'leave-3',
    employeeId: 'emp-105',
    leaveType: 'annual',
    startDate: '2026-10-25',
    endDate: '2026-10-27',
    totalDays: 3,
    reason: 'حضور مناسبة شخصية',
    status: 'pending',
    submittedAt: '2026-10-02 14:20:00'
  }
];

export const INITIAL_LOANS: Loan[] = [
  {
    id: 'loan-1',
    employeeId: 'emp-101',
    amount: 1200.000,
    monthlyInstallment: 100.000,
    installmentsCount: 12,
    remainingAmount: 800.000,
    startDate: '2026-06',
    status: 'active',
    notes: 'سلفة أثاث منزلي معتمدة من الإدارة المالية'
  },
  {
    id: 'loan-2',
    employeeId: 'emp-106',
    amount: 300.000,
    monthlyInstallment: 50.000,
    installmentsCount: 6,
    remainingAmount: 200.000,
    startDate: '2026-08',
    status: 'active',
    notes: 'سلفة طارئة'
  }
];

export const INITIAL_DEBTS: EmployeeDebtInvoice[] = [
  {
    id: 'debt-1',
    employeeId: 'emp-101',
    invoiceNo: 'INV-2026-089',
    description: 'فاتورة مشتريات شخصية من معرض الشركة بالتقسيط',
    amount: 45.000,
    date: '2026-10-01',
    isDeducted: false,
    notes: 'موافقة المحاسبة على الخصم المباشر'
  },
  {
    id: 'debt-2',
    employeeId: 'emp-105',
    invoiceNo: 'REC-2026-012',
    description: 'تسوية فارق عهدة سفرية لمهمة عمل بالعقبة',
    amount: 30.000,
    date: '2026-10-02',
    isDeducted: false,
    notes: 'مستردات عهدة مؤقتة'
  }
];

export const ROLE_SESSIONS: Record<string, UserSession> = {
  hr_manager: {
    id: 'usr-hr',
    name: 'رانية المجالي',
    email: 'rania.majali@elite-tech.jo',
    role: 'hr_manager',
    roleTitleAr: 'مدير الموارد البشرية وشؤون الموظفين',
    employeeId: 'emp-102',
    branchId: 'br-amm',
    departmentId: 'dept-hr'
  },
  payroll_accountant: {
    id: 'usr-accountant',
    name: 'عمر الزبيدي',
    email: 'omar.zubaidi@elite-tech.jo',
    role: 'payroll_accountant',
    roleTitleAr: 'المحاسب المالي للرواتب والأجور',
    employeeId: 'emp-103',
    branchId: 'br-amm',
    departmentId: 'dept-fin'
  },
  department_manager: {
    id: 'usr-manager',
    name: 'أحمد النجار',
    email: 'ahmad.najjar@elite-tech.jo',
    role: 'department_manager',
    roleTitleAr: 'مدير قسم تكنولوجيا المعلومات',
    employeeId: 'emp-101',
    branchId: 'br-amm',
    departmentId: 'dept-it'
  },
  employee: {
    id: 'usr-employee',
    name: 'يزيد الخطيب',
    email: 'yazeed.khatib@elite-tech.jo',
    role: 'employee',
    roleTitleAr: 'موظف (بوابة الخدمة الذاتية)',
    employeeId: 'emp-106',
    branchId: 'br-irb',
    departmentId: 'dept-ops'
  },
  super_admin: {
    id: 'usr-admin',
    name: 'المهندس خلدون النابلسي',
    email: 'admin@elite-tech.jo',
    role: 'super_admin',
    roleTitleAr: 'مدير النظام الشامل (Super Admin)',
    branchId: 'br-amm'
  }
};

class StorageService {
  private get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      if (!item) return defaultValue;
      return JSON.parse(item) as T;
    } catch {
      return defaultValue;
    }
  }

  private set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage quota exceeded or error setting item', e);
    }
  }

  // System Settings
  getSettings(): SystemSettings {
    return this.get<SystemSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }

  saveSettings(settings: SystemSettings): void {
    this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  // Company & Companies
  getCompany(): Company {
    const list = this.getCompanies();
    return list[0] || INITIAL_COMPANY;
  }

  saveCompany(company: Company): void {
    const list = this.getCompanies();
    const idx = list.findIndex(c => c.id === company.id);
    if (idx >= 0) {
      list[idx] = company;
    } else {
      list.push(company);
    }
    this.saveCompanies(list);
    this.set(STORAGE_KEYS.COMPANY, company);
  }

  getCompanies(): Company[] {
    return this.get<Company[]>('hrms_companies_list_v2', [INITIAL_COMPANY]);
  }

  saveCompanies(companies: Company[]): void {
    this.set('hrms_companies_list_v2', companies);
  }

  // Branches
  getBranches(): Branch[] {
    return this.get<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  }

  saveBranches(branches: Branch[]): void {
    this.set(STORAGE_KEYS.BRANCHES, branches);
  }

  // Departments
  getDepartments(): Department[] {
    return this.get<Department[]>(STORAGE_KEYS.DEPARTMENTS, INITIAL_DEPARTMENTS);
  }

  saveDepartments(departments: Department[]): void {
    this.set(STORAGE_KEYS.DEPARTMENTS, departments);
  }

  // Job Titles
  getJobTitles(): JobTitle[] {
    return this.get<JobTitle[]>(STORAGE_KEYS.JOB_TITLES, INITIAL_JOB_TITLES);
  }

  saveJobTitles(titles: JobTitle[]): void {
    this.set(STORAGE_KEYS.JOB_TITLES, titles);
  }

  // Employees
  getEmployees(): Employee[] {
    return this.get<Employee[]>(STORAGE_KEYS.EMPLOYEES, INITIAL_EMPLOYEES);
  }

  saveEmployees(employees: Employee[]): void {
    this.set(STORAGE_KEYS.EMPLOYEES, employees);
  }

  addEmployee(emp: Employee): void {
    const list = this.getEmployees();
    list.push(emp);
    this.saveEmployees(list);
    apiService.saveEmployee(emp).catch(() => {});
  }

  updateEmployee(emp: Employee): void {
    const list = this.getEmployees().map(e => e.id === emp.id ? emp : e);
    this.saveEmployees(list);
    apiService.saveEmployee(emp).catch(() => {});
  }

  deleteEmployee(id: string): void {
    const list = this.getEmployees().filter(e => e.id !== id);
    this.saveEmployees(list);
    apiService.deleteEmployee(id).catch(() => {});
  }

  // Shifts
  getShifts(): Shift[] {
    return this.get<Shift[]>(STORAGE_KEYS.SHIFTS, INITIAL_SHIFTS);
  }

  saveShifts(shifts: Shift[]): void {
    this.set(STORAGE_KEYS.SHIFTS, shifts);
  }

  // Attendance Raw Logs
  getRawAttendanceLogs(): RawAttendanceLog[] {
    return this.get<RawAttendanceLog[]>(STORAGE_KEYS.ATTENDANCE_LOGS, []);
  }

  saveRawAttendanceLogs(logs: RawAttendanceLog[]): void {
    this.set(STORAGE_KEYS.ATTENDANCE_LOGS, logs);
  }

  appendRawAttendanceLogs(newLogs: RawAttendanceLog[]): void {
    const current = this.getRawAttendanceLogs();
    this.set(STORAGE_KEYS.ATTENDANCE_LOGS, [...newLogs, ...current]);
  }

  // Daily Attendance Days
  getDailyAttendanceRecords(): DailyAttendanceRecord[] {
    return this.get<DailyAttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE_DAYS, []);
  }

  saveDailyAttendanceRecords(records: DailyAttendanceRecord[]): void {
    this.set(STORAGE_KEYS.ATTENDANCE_DAYS, records);
  }

  // Leaves
  getLeaveRequests(): LeaveRequest[] {
    return this.get<LeaveRequest[]>(STORAGE_KEYS.LEAVES, INITIAL_LEAVES);
  }

  saveLeaveRequests(leaves: LeaveRequest[]): void {
    this.set(STORAGE_KEYS.LEAVES, leaves);
  }

  // Loans
  getLoans(): Loan[] {
    return this.get<Loan[]>(STORAGE_KEYS.LOANS, INITIAL_LOANS);
  }

  saveLoans(loans: Loan[]): void {
    this.set(STORAGE_KEYS.LOANS, loans);
  }

  // Debt Invoices
  getDebts(): EmployeeDebtInvoice[] {
    return this.get<EmployeeDebtInvoice[]>(STORAGE_KEYS.DEBTS, INITIAL_DEBTS);
  }

  saveDebts(debts: EmployeeDebtInvoice[]): void {
    this.set(STORAGE_KEYS.DEBTS, debts);
  }

  // Payroll Runs (كشوفات الرواتب الشهرية)
  getPayrollRuns(): PayrollRun[] {
    return this.get<PayrollRun[]>(STORAGE_KEYS.PAYROLL_RUNS, []);
  }

  savePayrollRuns(runs: PayrollRun[]): void {
    this.set(STORAGE_KEYS.PAYROLL_RUNS, runs);
  }

  // Audit Logs
  getAuditLogs(): AuditLogItem[] {
    return this.get<AuditLogItem[]>(STORAGE_KEYS.AUDIT_LOGS, []);
  }

  logAction(action: string, actionType: AuditLogItem['actionType'], module: AuditLogItem['module'], description: string, details?: Record<string, any>): void {
    const current = this.getAuditLogs();
    const session = this.getUserSession();
    const item: AuditLogItem = {
      id: 'audit-' + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      userName: session.name || 'مدير النظام',
      action,
      actionType,
      module,
      description,
      details
    };
    this.set(STORAGE_KEYS.AUDIT_LOGS, [item, ...current.slice(0, 499)]);
  }

  // Session
  getUserSession(): UserSession {
    return this.get<UserSession>(STORAGE_KEYS.SESSION, ROLE_SESSIONS['hr_manager']);
  }

  setUserSession(session: UserSession): void {
    this.set(STORAGE_KEYS.SESSION, session);
  }

  async syncFromDatabase(): Promise<boolean> {
    try {
      const data = await apiService.getBootstrapData();
      if (!data) return false;

      if (data.companies && data.companies.length > 0) {
        const mappedCompanies: Company[] = data.companies.map((c: any) => ({
          id: c.id,
          nameAr: c.name_ar,
          nameEn: c.name_en,
          crNumber: c.cr_number || '',
          taxNumber: c.tax_number || '',
          socialSecurityNumber: c.social_security_number || '',
          phone: c.phone || '',
          email: c.email || '',
          website: c.website || '',
          address: c.address || '',
          country: c.country || 'المملكة الأردنية الهاشمية',
          currency: c.currency || 'JOD',
          currencySymbol: c.currency_symbol || 'د.أ',
          currencyDecimals: c.currency_decimals || 3
        }));
        this.saveCompanies(mappedCompanies);
        this.set(STORAGE_KEYS.COMPANY, mappedCompanies[0]);
      }

      if (data.branches && data.branches.length > 0) {
        const mappedBranches: Branch[] = data.branches.map((b: any) => ({
          id: b.id,
          companyId: b.company_id,
          nameAr: b.name_ar,
          nameEn: b.name_en,
          city: b.city,
          address: b.address || '',
          phone: b.phone || '',
          isMain: !!b.is_main
        }));
        this.saveBranches(mappedBranches);
      }

      if (data.departments && data.departments.length > 0) {
        const mappedDepts: Department[] = data.departments.map((d: any) => ({
          id: d.id,
          branchId: d.branch_id,
          nameAr: d.name_ar,
          nameEn: d.name_en,
          code: d.code,
          costCenterCode: d.cost_center_code,
          managerId: d.manager_id
        }));
        this.saveDepartments(mappedDepts);
      }

      if (data.jobTitles && data.jobTitles.length > 0) {
        const mappedJobs: JobTitle[] = data.jobTitles.map((j: any) => ({
          id: j.id,
          departmentId: j.department_id,
          titleAr: j.title_ar,
          titleEn: j.title_en,
          grade: j.grade || 'A1'
        }));
        this.saveJobTitles(mappedJobs);
      }

      if (data.employees && data.employees.length > 0) {
        const mappedEmployees: Employee[] = data.employees.map((e: any) => {
          const names = (e.full_name_ar || '').split(' ');
          return {
            id: e.id,
            employeeNo: e.employee_no,
            zktecoId: e.zkteco_id,
            accountingRefNo: e.accounting_ref_no,
            nationalId: e.national_id,
            firstNameAr: names[0] || '',
            secondNameAr: names[1] || '',
            thirdNameAr: names[2] || '',
            lastNameAr: names.slice(3).join(' ') || '',
            fullNameAr: e.full_name_ar,
            fullNameEn: e.full_name_en || e.full_name_ar,
            email: e.email || '',
            phone: e.phone || '',
            gender: e.gender || 'male',
            birthDate: e.birth_date ? String(e.birth_date).substring(0, 10) : '',
            nationality: e.nationality || 'أردني',
            maritalStatus: e.marital_status || 'married',
            dependentsCount: Number(e.dependents_count || 0),
            branchId: e.branch_id,
            departmentId: e.department_id,
            jobTitleId: e.job_title_id,
            hireDate: e.hire_date ? String(e.hire_date).substring(0, 10) : '',
            employmentType: e.employment_type || 'full_time',
            status: e.status || 'active',
            basicSalary: Number(e.basic_salary || 0),
            housingAllowance: Number(e.housing_allowance || 0),
            transportAllowance: Number(e.transport_allowance || 0),
            phoneAllowance: Number(e.phone_allowance || 0),
            bankName: e.bank_name || '',
            bankIban: e.bank_iban || '',
            isSocialSecuritySubscribed: e.is_subject_to_social_security !== false,
            annualLeaveBalance: Number(e.annual_leave_balance || 14),
            sickLeaveBalance: Number(e.sick_leave_balance || 14)
          };
        });
        this.saveEmployees(mappedEmployees);
      }

      if (data.leaves && data.leaves.length > 0) {
        const mappedLeaves: LeaveRequest[] = data.leaves.map((l: any) => ({
          id: l.id,
          employeeId: l.employee_id,
          leaveType: l.leave_type || 'annual',
          startDate: String(l.start_date).substring(0, 10),
          endDate: String(l.end_date).substring(0, 10),
          totalDays: Number(l.days_count || 1),
          reason: l.reason || '',
          status: l.status || 'pending',
          submittedAt: l.created_at || new Date().toISOString()
        }));
        this.saveLeaveRequests(mappedLeaves);
      }

      if (data.advances && data.advances.length > 0) {
        const mappedLoans: Loan[] = data.advances.map((a: any) => ({
          id: a.id,
          employeeId: a.employee_id,
          amount: Number(a.total_amount),
          monthlyInstallment: Number(a.monthly_installment),
          installmentsCount: Math.ceil(Number(a.total_amount) / (Number(a.monthly_installment) || 1)),
          remainingAmount: Number(a.remaining_balance),
          startDate: String(a.request_date).substring(0, 7),
          status: a.status || 'active',
          notes: a.reason || ''
        }));
        this.saveLoans(mappedLoans);
      }

      if (data.debts && data.debts.length > 0) {
        const mappedDebts: EmployeeDebtInvoice[] = data.debts.map((d: any) => ({
          id: d.id,
          employeeId: d.employee_id,
          invoiceNo: d.invoice_number,
          description: d.description || '',
          amount: Number(d.total_amount),
          date: String(d.invoice_date).substring(0, 10),
          isDeducted: !!d.is_settled
        }));
        this.saveDebts(mappedDebts);
      }

      return true;
    } catch (e) {
      console.warn('Error during syncFromDatabase:', e);
      return false;
    }
  }

  resetAll(): void {
    localStorage.clear();
    this.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    this.set(STORAGE_KEYS.COMPANY, INITIAL_COMPANY);
    this.set(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
    this.set(STORAGE_KEYS.DEPARTMENTS, INITIAL_DEPARTMENTS);
    this.set(STORAGE_KEYS.JOB_TITLES, INITIAL_JOB_TITLES);
    this.set(STORAGE_KEYS.SHIFTS, INITIAL_SHIFTS);
    this.set(STORAGE_KEYS.EMPLOYEES, INITIAL_EMPLOYEES);
    this.set(STORAGE_KEYS.LEAVES, INITIAL_LEAVES);
    this.set(STORAGE_KEYS.LOANS, INITIAL_LOANS);
    this.set(STORAGE_KEYS.DEBTS, INITIAL_DEBTS);
    this.set(STORAGE_KEYS.SESSION, ROLE_SESSIONS['hr_manager']);
  }
}

export const storage = new StorageService();
