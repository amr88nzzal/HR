import { sql, type RawBuilder } from 'kysely';
import type { Filters, Opt, ReportDef, ReportFilter } from './types.js';

const o = (value: string, labelAr: string, labelEn: string): Opt => ({ value, labelAr, labelEn });
const EMP_STATUS = [
  o('active', 'نشط', 'Active'),
  o('suspended', 'موقوف', 'Suspended'),
  o('terminated', 'منتهي الخدمة', 'Terminated'),
];
const GENDER = [o('male', 'ذكر', 'Male'), o('female', 'أنثى', 'Female')];
const EMP_TYPE = [
  o('full_time', 'دوام كامل', 'Full time'),
  o('part_time', 'دوام جزئي', 'Part time'),
  o('temporary', 'مؤقت', 'Temporary'),
  o('contractor', 'متعاقد', 'Contractor'),
];
const DAY_STATUS = [
  o('present', 'حاضر', 'Present'),
  o('absent', 'غائب', 'Absent'),
  o('leave', 'إجازة', 'Leave'),
  o('holiday', 'عطلة', 'Holiday'),
  o('off', 'راحة', 'Off'),
  o('unscheduled', 'بلا جدول', 'Unscheduled'),
  o('incomplete', 'ناقص', 'Incomplete'),
  o('pending', 'معلّق', 'Pending'),
];
const LEAVE_STATUS = [
  o('pending', 'معلّق', 'Pending'),
  o('approved', 'معتمد', 'Approved'),
  o('rejected', 'مرفوض', 'Rejected'),
  o('withdrawn', 'مسحوب', 'Withdrawn'),
  o('cancelled', 'ملغى', 'Cancelled'),
];
const LOAN_STATUS = [
  o('active', 'قائمة', 'Active'),
  o('settled', 'مسددة', 'Settled'),
  o('cancelled', 'ملغاة', 'Cancelled'),
];
const PERIOD_STATUS = [
  o('draft', 'مسودة', 'Draft'),
  o('approved', 'معتمدة', 'Approved'),
  o('locked', 'مقفلة', 'Locked'),
];

const branchF: ReportFilter = {
  key: 'branchId',
  type: 'uuid',
  ref: 'branches',
  labelAr: 'الفرع',
  labelEn: 'Branch',
};
const deptF: ReportFilter = {
  key: 'departmentId',
  type: 'uuid',
  ref: 'departments',
  labelAr: 'القسم',
  labelEn: 'Department',
};
const dateFrom = (required = false): ReportFilter => ({
  key: 'dateFrom',
  type: 'date',
  labelAr: 'من تاريخ',
  labelEn: 'From',
  required,
});
const dateTo = (required = false): ReportFilter => ({
  key: 'dateTo',
  type: 'date',
  labelAr: 'إلى تاريخ',
  labelEn: 'To',
  required,
});

/** شرط الموظف: النطاق + الفرع/القسم الحاليان (على التعيين الحالي ce) */
const empWhere = (scope: RawBuilder<boolean> | null, f: Filters): RawBuilder<boolean> => {
  const parts: RawBuilder<boolean>[] = [sql<boolean>`employees.company_id = employees.company_id`];
  if (scope) parts.push(scope);
  if (f['branchId']) parts.push(sql<boolean>`ce.branch_id = ${f['branchId']}::uuid`);
  if (f['departmentId']) parts.push(sql<boolean>`ce.department_id = ${f['departmentId']}::uuid`);
  return sql<boolean>`${sql.join(parts, sql` and `)}`;
};

/** التعيين الحالي كجدول مرتبط بـ employees */
const CE = sql`left join employments ce on ce.employee_id = employees.id
  and ce.valid_from <= company_today(employees.company_id)
  and (ce.valid_to is null or ce.valid_to >= company_today(employees.company_id))`;

const nameCol = (key: string, ar: string, en: string) => ({
  key,
  labelAr: ar,
  labelEn: en,
  type: 'text' as const,
});

export const REPORTS: ReportDef[] = [
  {
    manifest: {
      code: 'employees.roster',
      module: 'employees',
      titleAr: 'قائمة الموظفين',
      titleEn: 'Employee roster',
      descriptionAr: 'الموظفون بتعيينهم الحالي؛ الراتب الأساسي يظهر لمن يملك صلاحية الرواتب فقط.',
      descriptionEn:
        'Employees with their current assignment; basic salary only for payroll viewers.',
      permission: 'employees.employee.read',
      filters: [
        {
          key: 'status',
          type: 'select',
          options: EMP_STATUS,
          labelAr: 'الحالة',
          labelEn: 'Status',
        },
        branchF,
        deptF,
        { ...dateFrom(), key: 'hiredFrom', labelAr: 'عُيّن من', labelEn: 'Hired from' },
        { ...dateTo(), key: 'hiredTo', labelAr: 'عُيّن حتى', labelEn: 'Hired until' },
      ],
      columns: [
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('nameAr', 'الاسم', 'Name (AR)'),
        { ...nameCol('nameEn', 'الاسم (إنجليزي)', 'Name (EN)'), optional: true },
        { key: 'status', labelAr: 'الحالة', labelEn: 'Status', type: 'enum', options: EMP_STATUS },
        { key: 'hireDate', labelAr: 'تاريخ التعيين', labelEn: 'Hire date', type: 'date' },
        nameCol('branch', 'الفرع', 'Branch'),
        nameCol('department', 'القسم', 'Department'),
        nameCol('jobTitle', 'المسمى الوظيفي', 'Job title'),
        { ...nameCol('manager', 'المدير المباشر', 'Manager'), optional: true },
        {
          key: 'employmentType',
          labelAr: 'نوع التوظيف',
          labelEn: 'Employment type',
          type: 'enum',
          options: EMP_TYPE,
          optional: true,
        },
        {
          key: 'gender',
          labelAr: 'الجنس',
          labelEn: 'Gender',
          type: 'enum',
          options: GENDER,
          optional: true,
        },
        { ...nameCol('nationality', 'الجنسية', 'Nationality'), optional: true },
        {
          key: 'basicSalary',
          labelAr: 'الراتب الأساسي',
          labelEn: 'Basic salary',
          type: 'money',
          requires: 'payroll.salary.read',
          optional: true,
        },
        {
          key: 'currency',
          labelAr: 'العملة',
          labelEn: 'Currency',
          type: 'text',
          requires: 'payroll.salary.read',
          optional: true,
        },
      ],
    },
    orderBy: 'employee_no, id',
    query: (_a, scope, f) => sql`
      select employees.id, employees.employee_no, employees.full_name_ar as name_ar,
             employees.full_name_en as name_en, employees.status,
             employees.first_hire_date::text as hire_date,
             b.name_ar as branch, d.name_ar as department, jt.name_ar as job_title,
             mgr.full_name_ar as manager, ce.employment_type, employees.gender, employees.nationality,
             sal.basic_amount::text as basic_salary, sal.currency
        from employees ${CE}
        left join branches b on b.id = ce.branch_id
        left join departments d on d.id = ce.department_id
        left join job_titles jt on jt.id = ce.job_title_id
        left join employees mgr on mgr.id = ce.manager_employee_id
        left join employee_salaries sal on sal.employee_id = employees.id
          and sal.valid_from <= company_today(employees.company_id)
          and (sal.valid_to is null or sal.valid_to >= company_today(employees.company_id))
       where ${empWhere(scope, f)}
         ${f['status'] ? sql`and employees.status = ${f['status']}` : sql``}
         ${f['hiredFrom'] ? sql`and employees.first_hire_date >= ${f['hiredFrom']}::date` : sql``}
         ${f['hiredTo'] ? sql`and employees.first_hire_date <= ${f['hiredTo']}::date` : sql``}`,
  },
  {
    manifest: {
      code: 'employees.headcount',
      module: 'employees',
      titleAr: 'أعداد الموظفين',
      titleEn: 'Headcount',
      descriptionAr: 'عدد الموظفين حسب الفرع والقسم والحالة.',
      descriptionEn: 'Employee counts by branch, department and status.',
      permission: 'employees.employee.read',
      filters: [branchF, deptF],
      columns: [
        nameCol('branch', 'الفرع', 'Branch'),
        nameCol('department', 'القسم', 'Department'),
        { key: 'active', labelAr: 'نشط', labelEn: 'Active', type: 'number' },
        { key: 'suspended', labelAr: 'موقوف', labelEn: 'Suspended', type: 'number' },
        { key: 'terminated', labelAr: 'منتهي الخدمة', labelEn: 'Terminated', type: 'number' },
        { key: 'total', labelAr: 'الإجمالي', labelEn: 'Total', type: 'number' },
      ],
    },
    orderBy: 'branch, department',
    query: (_a, scope, f) => sql`
      select coalesce(b.name_ar, '—') as branch, coalesce(d.name_ar, '—') as department,
             count(*) filter (where employees.status = 'active')::int as active,
             count(*) filter (where employees.status = 'suspended')::int as suspended,
             count(*) filter (where employees.status = 'terminated')::int as terminated,
             count(*)::int as total
        from employees ${CE}
        left join branches b on b.id = ce.branch_id
        left join departments d on d.id = ce.department_id
       where ${empWhere(scope, f)}
       group by b.name_ar, d.name_ar`,
  },
  {
    manifest: {
      code: 'leave.balances',
      module: 'leave',
      titleAr: 'أرصدة الإجازات',
      titleEn: 'Leave balances',
      descriptionAr: 'رصيد كل موظف لكل نوع إجازة.',
      descriptionEn: 'Each employee’s balance per leave type.',
      permission: 'leave.balance.read',
      filters: [
        {
          key: 'leaveTypeId',
          type: 'uuid',
          ref: 'leave-types',
          labelAr: 'نوع الإجازة',
          labelEn: 'Leave type',
        },
        branchF,
        deptF,
      ],
      columns: [
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('name', 'الموظف', 'Employee'),
        nameCol('department', 'القسم', 'Department'),
        nameCol('leaveType', 'نوع الإجازة', 'Leave type'),
        { key: 'balance', labelAr: 'الرصيد (أيام)', labelEn: 'Balance (days)', type: 'number' },
      ],
    },
    orderBy: 'employee_no, leave_type, id',
    query: (_a, scope, f) => sql`
      select lb.id, employees.employee_no, employees.full_name_ar as name,
             d.name_ar as department, lt.name_ar as leave_type, lb.balance::float8 as balance
        from leave_balances lb
        join employees on employees.id = lb.employee_id
        join leave_types lt on lt.id = lb.leave_type_id ${CE}
        left join departments d on d.id = ce.department_id
       where ${empWhere(scope, f)}
         ${f['leaveTypeId'] ? sql`and lb.leave_type_id = ${f['leaveTypeId']}::uuid` : sql``}`,
  },
  {
    manifest: {
      code: 'leave.requests',
      module: 'leave',
      titleAr: 'طلبات الإجازة',
      titleEn: 'Leave requests',
      descriptionAr: 'طلبات الإجازة المتقاطعة مع الفترة المحددة.',
      descriptionEn: 'Leave requests overlapping the selected period.',
      permission: 'leave.request.read_all',
      filters: [
        dateFrom(),
        dateTo(),
        {
          key: 'status',
          type: 'select',
          options: LEAVE_STATUS,
          labelAr: 'الحالة',
          labelEn: 'Status',
        },
        branchF,
        deptF,
      ],
      columns: [
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('name', 'الموظف', 'Employee'),
        nameCol('leaveType', 'نوع الإجازة', 'Leave type'),
        { key: 'startDate', labelAr: 'من', labelEn: 'From', type: 'date' },
        { key: 'endDate', labelAr: 'إلى', labelEn: 'To', type: 'date' },
        { key: 'days', labelAr: 'الأيام', labelEn: 'Days', type: 'number' },
        {
          key: 'status',
          labelAr: 'الحالة',
          labelEn: 'Status',
          type: 'enum',
          options: LEAVE_STATUS,
        },
        { ...nameCol('reason', 'السبب', 'Reason'), optional: true },
      ],
    },
    orderBy: 'start_date desc, employee_no, id',
    query: (_a, scope, f) => sql`
      select lr.id, employees.employee_no, employees.full_name_ar as name, lt.name_ar as leave_type,
             lr.start_date::text as start_date, lr.end_date::text as end_date,
             coalesce(lr.override_days, lr.days)::float8 as days, lr.status, lr.reason
        from leave_requests lr
        join employees on employees.id = lr.employee_id
        join leave_types lt on lt.id = lr.leave_type_id ${CE}
       where ${empWhere(scope, f)}
         ${f['dateFrom'] ? sql`and lr.end_date >= ${f['dateFrom']}::date` : sql``}
         ${f['dateTo'] ? sql`and lr.start_date <= ${f['dateTo']}::date` : sql``}
         ${f['status'] ? sql`and lr.status = ${f['status']}` : sql``}`,
  },
  {
    manifest: {
      code: 'attendance.daily',
      module: 'attendance',
      titleAr: 'سجل الحضور اليومي',
      titleEn: 'Daily attendance',
      descriptionAr: 'يوم لكل موظف: الحالة والدخول والخروج والتأخير.',
      descriptionEn: 'One row per employee per day: status, in/out and lateness.',
      permission: 'attendance.day.read_all',
      filters: [
        dateFrom(true),
        dateTo(true),
        {
          key: 'status',
          type: 'select',
          options: DAY_STATUS,
          labelAr: 'الحالة',
          labelEn: 'Status',
        },
        branchF,
        deptF,
      ],
      columns: [
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('name', 'الموظف', 'Employee'),
        { key: 'day', labelAr: 'اليوم', labelEn: 'Day', type: 'date' },
        { key: 'status', labelAr: 'الحالة', labelEn: 'Status', type: 'enum', options: DAY_STATUS },
        {
          key: 'scheduledMinutes',
          labelAr: 'المجدول (د)',
          labelEn: 'Scheduled (min)',
          type: 'number',
        },
        { key: 'workedMinutes', labelAr: 'المنجز (د)', labelEn: 'Worked (min)', type: 'number' },
        { key: 'lateMinutes', labelAr: 'التأخير (د)', labelEn: 'Late (min)', type: 'number' },
        {
          key: 'earlyLeaveMinutes',
          labelAr: 'مغادرة مبكرة (د)',
          labelEn: 'Early leave (min)',
          type: 'number',
          optional: true,
        },
      ],
    },
    orderBy: 'day, employee_no, id',
    query: (_a, scope, f) => sql`
      select ad.id, employees.employee_no, employees.full_name_ar as name, ad.day_date::text as day,
             coalesce(ad.override_status, ad.status) as status, ad.scheduled_minutes,
             ad.worked_minutes, ad.late_minutes, ad.early_leave_minutes
        from attendance_days ad
        join employees on employees.id = ad.employee_id ${CE}
       where ${empWhere(scope, f)}
         and ad.day_date between ${f['dateFrom']}::date and ${f['dateTo']}::date
         ${f['status'] ? sql`and coalesce(ad.override_status, ad.status) = ${f['status']}` : sql``}`,
  },
  {
    manifest: {
      code: 'attendance.summary',
      module: 'attendance',
      titleAr: 'ملخص الحضور لكل موظف',
      titleEn: 'Attendance summary',
      descriptionAr: 'أيام الحضور والغياب والإجازة وإجمالي التأخير والساعات في الفترة.',
      descriptionEn: 'Present/absent/leave days plus lateness and hours over the period.',
      permission: 'attendance.day.read_all',
      filters: [dateFrom(true), dateTo(true), branchF, deptF],
      columns: [
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('name', 'الموظف', 'Employee'),
        { key: 'present', labelAr: 'حضور', labelEn: 'Present', type: 'number' },
        { key: 'absent', labelAr: 'غياب', labelEn: 'Absent', type: 'number' },
        { key: 'leave', labelAr: 'إجازة', labelEn: 'Leave', type: 'number' },
        { key: 'lateMinutes', labelAr: 'التأخير (د)', labelEn: 'Late (min)', type: 'number' },
        // مجموع الخروج المبكر بجانب التأخير / total early leave next to lateness
        {
          key: 'earlyLeaveMinutes',
          labelAr: 'مغادرة مبكرة (د)',
          labelEn: 'Early leave (min)',
          type: 'number',
        },
        { key: 'workedHours', labelAr: 'ساعات العمل', labelEn: 'Worked hours', type: 'number' },
      ],
    },
    orderBy: 'employee_no, id',
    query: (_a, scope, f) => sql`
      select employees.id, employees.employee_no, employees.full_name_ar as name,
             count(*) filter (where coalesce(ad.override_status, ad.status) = 'present')::int as present,
             count(*) filter (where coalesce(ad.override_status, ad.status) = 'absent')::int as absent,
             count(*) filter (where coalesce(ad.override_status, ad.status) = 'leave')::int as leave,
             coalesce(sum(ad.late_minutes), 0)::int as late_minutes,
             coalesce(sum(ad.early_leave_minutes), 0)::int as early_leave_minutes,
             round(coalesce(sum(ad.worked_minutes), 0) / 60.0, 2)::float8 as worked_hours
        from attendance_days ad
        join employees on employees.id = ad.employee_id ${CE}
       where ${empWhere(scope, f)}
         and ad.day_date between ${f['dateFrom']}::date and ${f['dateTo']}::date
       group by employees.id, employees.employee_no, employees.full_name_ar`,
  },
  {
    manifest: {
      code: 'payroll.summary',
      module: 'payroll',
      titleAr: 'ملخص دورات الرواتب',
      titleEn: 'Payroll period summary',
      descriptionAr:
        'إجماليات كل دورة بعملتها: الإجمالي والاستقطاعات والصافي والسلف والمستحق وتكلفة الشركة.',
      descriptionEn:
        'Totals per period in its own currency, including loans, payable and employer cost.',
      permission: 'payroll.payslip.read',
      filters: [
        { key: 'year', type: 'number', labelAr: 'السنة', labelEn: 'Year' },
        {
          key: 'currency',
          type: 'text',
          labelAr: 'العملة (مثل SAR)',
          labelEn: 'Currency (e.g. SAR)',
        },
        {
          key: 'status',
          type: 'select',
          options: PERIOD_STATUS,
          labelAr: 'الحالة',
          labelEn: 'Status',
        },
      ],
      columns: [
        { key: 'period', labelAr: 'الدورة', labelEn: 'Period', type: 'text' },
        { key: 'currency', labelAr: 'العملة', labelEn: 'Currency', type: 'text' },
        {
          key: 'status',
          labelAr: 'الحالة',
          labelEn: 'Status',
          type: 'enum',
          options: PERIOD_STATUS,
        },
        { key: 'employees', labelAr: 'الموظفون', labelEn: 'Employees', type: 'number' },
        { key: 'gross', labelAr: 'الإجمالي', labelEn: 'Gross', type: 'money' },
        { key: 'deductions', labelAr: 'الاستقطاعات', labelEn: 'Deductions', type: 'money' },
        { key: 'net', labelAr: 'الصافي', labelEn: 'Net', type: 'money' },
        { key: 'loans', labelAr: 'أقساط السلف', labelEn: 'Loan installments', type: 'money' },
        { key: 'payable', labelAr: 'المستحق للدفع', labelEn: 'Payable', type: 'money' },
        {
          key: 'employer',
          labelAr: 'تكلفة الشركة',
          labelEn: 'Employer cost',
          type: 'money',
          optional: true,
        },
      ],
    },
    orderBy: 'period desc, currency',
    query: (_a, scope, f) => sql`
      select p.id::text || '-' || p.currency as id,
             p.year::text || '-' || lpad(p.month::text, 2, '0') as period, p.currency, p.status,
             count(s.id)::int as employees,
             coalesce(sum(s.gross_amount), 0)::text as gross,
             coalesce(sum(s.deductions_amount), 0)::text as deductions,
             coalesce(sum(s.net_amount), 0)::text as net,
             coalesce(sum(s.loans_amount), 0)::text as loans,
             coalesce(sum(s.payable_amount), 0)::text as payable,
             coalesce(sum(s.employer_amount), 0)::text as employer
        from payroll_periods p
        left join payslips s on s.period_id = p.id and s.status = 'calculated'
        left join employees on employees.id = s.employee_id
       where (s.id is null or ${scope ?? sql<boolean>`true`})
         ${f['year'] ? sql`and p.year = ${Number(f['year'])}` : sql``}
         ${f['currency'] ? sql`and p.currency = ${f['currency'].toUpperCase()}` : sql``}
         ${f['status'] ? sql`and p.status = ${f['status']}` : sql``}
       group by p.id, p.year, p.month, p.currency, p.status`,
  },
  {
    manifest: {
      code: 'payroll.by_department',
      module: 'payroll',
      titleAr: 'الرواتب حسب القسم',
      titleEn: 'Payroll by department',
      descriptionAr: 'إجماليات دورة واحدة موزعة على الأقسام.',
      descriptionEn: 'One period’s totals broken down by department.',
      permission: 'payroll.payslip.read',
      filters: [
        {
          key: 'periodId',
          type: 'uuid',
          ref: 'payroll-periods',
          required: true,
          labelAr: 'الدورة',
          labelEn: 'Period',
        },
      ],
      columns: [
        nameCol('department', 'القسم', 'Department'),
        { key: 'employees', labelAr: 'الموظفون', labelEn: 'Employees', type: 'number' },
        { key: 'gross', labelAr: 'الإجمالي', labelEn: 'Gross', type: 'money' },
        { key: 'deductions', labelAr: 'الاستقطاعات', labelEn: 'Deductions', type: 'money' },
        { key: 'net', labelAr: 'الصافي', labelEn: 'Net', type: 'money' },
        { key: 'payable', labelAr: 'المستحق للدفع', labelEn: 'Payable', type: 'money' },
      ],
    },
    orderBy: 'department',
    query: (_a, scope, f) => sql`
      select coalesce(d.name_ar, '—') as department, count(*)::int as employees,
             sum(s.gross_amount)::text as gross, sum(s.deductions_amount)::text as deductions,
             sum(s.net_amount)::text as net, sum(s.payable_amount)::text as payable
        from payslips s
        join employees on employees.id = s.employee_id
        left join employments ce on ce.employee_id = employees.id
          and ce.valid_from <= (select end_date from payroll_periods where id = s.period_id)
          and (ce.valid_to is null or ce.valid_to >= (select start_date from payroll_periods where id = s.period_id))
        left join departments d on d.id = ce.department_id
       where s.period_id = ${f['periodId']}::uuid and s.status = 'calculated'
         and ${scope ?? sql<boolean>`true`}
       group by d.name_ar`,
  },
  {
    manifest: {
      code: 'payroll.overrides',
      module: 'payroll',
      titleAr: 'تقرير التعديلات اليدوية',
      titleEn: 'Manual overrides',
      descriptionAr: 'كل بند عُدّل يدوياً أو أُضيف يدوياً مع سببه ومن عدّله.',
      descriptionEn: 'Every manually changed or added payslip line with reason and author.',
      permission: 'payroll.payslip.read',
      filters: [
        {
          key: 'periodId',
          type: 'uuid',
          ref: 'payroll-periods',
          labelAr: 'الدورة',
          labelEn: 'Period',
        },
      ],
      columns: [
        { key: 'period', labelAr: 'الدورة', labelEn: 'Period', type: 'text' },
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('name', 'الموظف', 'Employee'),
        nameCol('line', 'البند', 'Line'),
        { key: 'autoAmount', labelAr: 'القيمة الآلية', labelEn: 'Auto amount', type: 'money' },
        { key: 'amount', labelAr: 'القيمة الفعلية', labelEn: 'Actual amount', type: 'money' },
        { key: 'diff', labelAr: 'الفرق', labelEn: 'Difference', type: 'money' },
        nameCol('reason', 'السبب', 'Reason'),
        nameCol('note', 'الملاحظة', 'Note'),
        nameCol('by', 'بواسطة', 'By'),
        { key: 'at', labelAr: 'التاريخ', labelEn: 'Date', type: 'date' },
      ],
    },
    orderBy: 'period desc, employee_no, line, id',
    query: (_a, scope, f) => sql`
      select l.id, p.year::text || '-' || lpad(p.month::text, 2, '0') as period,
             employees.employee_no, employees.full_name_ar as name, l.name_ar as line,
             l.auto_amount::text as auto_amount, l.amount::text as amount,
             (l.amount - coalesce(l.auto_amount, 0))::text as diff,
             r.name_ar as reason, l.override_note as note, u.email as by,
             l.override_at::date::text as at
        from payslip_lines l
        join payslips s on s.id = l.payslip_id
        join payroll_periods p on p.id = s.period_id
        join employees on employees.id = s.employee_id
        left join override_reasons r on r.id = l.override_reason_id
        left join users u on u.id = l.override_by
       where (l.is_manual or l.is_added) and ${scope ?? sql<boolean>`true`}
         ${f['periodId'] ? sql`and s.period_id = ${f['periodId']}::uuid` : sql``}`,
  },
  {
    manifest: {
      code: 'payroll.loans',
      module: 'payroll',
      titleAr: 'سجل السلف والقروض',
      titleEn: 'Loans register',
      descriptionAr: 'كل سلفة بالمسدَّد والمتبقي وحالتها.',
      descriptionEn: 'Each loan with repaid, remaining and status.',
      permission: 'payroll.loan.read',
      filters: [
        {
          key: 'status',
          type: 'select',
          options: LOAN_STATUS,
          labelAr: 'الحالة',
          labelEn: 'Status',
        },
      ],
      columns: [
        nameCol('employeeNo', 'الرقم الوظيفي', 'Employee No.'),
        nameCol('name', 'الموظف', 'Employee'),
        nameCol('kind', 'النوع', 'Type'),
        { key: 'currency', labelAr: 'العملة', labelEn: 'Currency', type: 'text' },
        { key: 'principal', labelAr: 'المبلغ', labelEn: 'Principal', type: 'money' },
        { key: 'repaid', labelAr: 'المسدَّد', labelEn: 'Repaid', type: 'money' },
        { key: 'remaining', labelAr: 'المتبقي', labelEn: 'Remaining', type: 'money' },
        { key: 'installments', labelAr: 'الأقساط', labelEn: 'Installments', type: 'number' },
        { key: 'status', labelAr: 'الحالة', labelEn: 'Status', type: 'enum', options: LOAN_STATUS },
      ],
    },
    orderBy: 'employee_no, created_at, id',
    query: (_a, scope, f) => sql`
      select l.id, l.created_at, employees.employee_no, employees.full_name_ar as name,
             lt.name_ar as kind, l.currency,
             l.principal::text as principal,
             coalesce(sum(i.amount) filter (where i.status = 'deducted'), 0)::text as repaid,
             (l.principal - coalesce(sum(i.amount) filter (where i.status = 'deducted'), 0))::text as remaining,
             l.installments_count as installments, l.status
        from loans l
        join employees on employees.id = l.employee_id
        join loan_types lt on lt.id = l.type_id
        left join loan_installments i on i.loan_id = l.id
       where ${scope ?? sql<boolean>`true`}
         ${f['status'] ? sql`and l.status = ${f['status']}` : sql``}
       group by l.id, employees.employee_no, employees.full_name_ar, lt.name_ar`,
  },
];

export const reportByCode = (code: string): ReportDef | undefined =>
  REPORTS.find((r) => r.manifest.code === code);
