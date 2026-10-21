/** كتالوج الصلاحيات في الكود (module.resource.action) ويُزامَن إلى جدول permissions. */
export type PermissionDef = {
  code: string;
  module: string;
  resource: string;
  action: string;
  descriptionAr: string;
};

const def = (module: string, resource: string, action: string, descriptionAr: string) =>
  ({ code: `${module}.${resource}.${action}`, module, resource, action, descriptionAr }) as const;

const crud = (module: string, resource: string, label: string): PermissionDef[] => [
  def(module, resource, 'read', `عرض ${label}`),
  def(module, resource, 'create', `إضافة ${label}`),
  def(module, resource, 'update', `تعديل ${label}`),
  def(module, resource, 'delete', `حذف ${label}`),
];

export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  def('system', 'company', 'read', 'عرض بيانات الشركة'),
  def('system', 'company', 'update', 'تعديل بيانات الشركة'),
  ...crud('system', 'branch', 'الفروع'),
  ...crud('system', 'currency', 'العملات'),
  def('system', 'setting', 'read', 'عرض الإعدادات'),
  def('system', 'setting', 'update', 'تعديل الإعدادات'),
  def('system', 'audit', 'read', 'عرض سجل التدقيق'),
  def('system', 'job', 'read', 'عرض مراقب المهام الخلفية'),
  def('system', 'job', 'retry', 'إعادة تشغيل مهمة فاشلة'),
  def('system', 'integration', 'read', 'عرض إعدادات قنوات الإشعار (بريد وتلغرام)'),
  def('system', 'integration', 'manage', 'إدارة قنوات الإشعار وتجربتها'),
  def('system', 'notification_template', 'read', 'عرض قوالب الإشعارات'),
  def('system', 'notification_template', 'update', 'تعديل قوالب الإشعارات وتجربتها'),
  def('org', 'brand', 'read', 'عرض الهوية البصرية (الشعار والترويسة)'),
  def('org', 'brand', 'update', 'تعديل الهوية البصرية (الشعار والترويسة)'),
  ...crud('org', 'department', 'الأقسام'),
  ...crud('org', 'job_title', 'المسميات الوظيفية'),
  ...crud('org', 'job_grade', 'الدرجات الوظيفية'),
  ...crud('org', 'work_location', 'مواقع العمل'),
  ...crud('org', 'cost_center', 'مراكز التكلفة'),
  ...crud('employees', 'employee', 'الموظفين'),
  def('employees', 'employee', 'import', 'استيراد الموظفين من Excel (نطاق الشركة)'),
  def('employees', 'employee', 'set_number', 'تحديد الرقم الوظيفي يدوياً'),
  def('employees', 'employment', 'read', 'عرض التعيين وسجل التغييرات'),
  def('employees', 'employment', 'manage', 'تسجيل تغييرات التعيين (نقل، ترقية، إنهاء…)'),
  def('employees', 'contract', 'read', 'عرض العقود'),
  def('employees', 'contract', 'manage', 'إدارة العقود'),
  ...crud('org', 'change_reason', 'أسباب التغيير'),
  ...crud('org', 'external_system', 'الأنظمة الخارجية'),
  ...crud('org', 'custom_field', 'تعريفات الحقول المخصصة'),
  def('employees', 'external_ref', 'read', 'عرض المراجع الخارجية للموظف'),
  def('employees', 'external_ref', 'manage', 'إدارة المراجع الخارجية للموظف'),
  def('employees', 'custom_field', 'reveal', 'كشف الحقول المخصصة الحساسة (مدقَّق)'),
  ...crud('archive', 'document_type', 'أنواع الوثائق وحقولها'),
  ...crud('archive', 'document', 'الوثائق'),
  def('archive', 'document', 'reveal', 'كشف قيم الوثائق الحساسة (مدقَّق)'),
  def('employees', 'bank_account', 'read', 'عرض الحسابات البنكية (مقنّعة)'),
  def('employees', 'bank_account', 'manage', 'إدارة الحسابات البنكية'),
  def('employees', 'bank_account', 'reveal', 'كشف رقم الحساب البنكي كاملاً (مدقَّق)'),
  ...crud('letters', 'template', 'قوالب الوثائق الصادرة'),
  ...crud('payroll', 'base', 'أسس احتساب الرواتب'),
  ...crud('payroll', 'component', 'مكونات الرواتب (استحقاقات واستقطاعات)'),
  ...crud('payroll', 'rate_table', 'جداول النسب (تأمينات وضريبة)'),
  ...crud('payroll', 'structure', 'هياكل الرواتب'),
  def('payroll', 'salary', 'read', 'عرض رواتب الموظفين'),
  def('payroll', 'salary', 'manage', 'إدارة رواتب الموظفين'),
  ...crud('payroll', 'group', 'مجموعات الدفع'),
  ...crud('payroll', 'override_reason', 'أسباب التجاوز اليدوي'),
  def('payroll', 'period', 'read', 'عرض دورات الرواتب'),
  def('payroll', 'period', 'create', 'إنشاء دورة رواتب'),
  def('payroll', 'period', 'calculate', 'احتساب ومحاكاة دورة الرواتب'),
  def('payroll', 'period', 'approve', 'اعتماد دورة الرواتب'),
  def('payroll', 'period', 'lock', 'قفل دورة الرواتب'),
  def('payroll', 'period', 'reopen', 'إعادة فتح دورة رواتب مقفلة'),
  def('payroll', 'payslip', 'read', 'عرض قسائم الرواتب'),
  def('payroll', 'payslip_template', 'read', 'عرض قوالب تصميم القسيمة'),
  def('payroll', 'payslip_template', 'manage', 'إنشاء قوالب القسيمة وتعديلها وتعيين الافتراضي'),
  def('payroll', 'payslip', 'override', 'تجاوز بنود القسيمة يدوياً'),
  def('payroll', 'input', 'read', 'عرض مدخلات الرواتب اليدوية'),
  def('payroll', 'input', 'manage', 'إدارة مدخلات الرواتب اليدوية'),
  def('payroll', 'loan', 'read', 'عرض السلف والأقساط'),
  def('payroll', 'loan', 'create', 'منح سلفة أو قرض'),
  def('payroll', 'loan', 'manage', 'تأجيل الأقساط وإلغاء السلف'),
  def('payroll', 'shortfall', 'read', 'عرض تقرير نقص الدوام (تأخير ومغادرة مبكرة)'),
  def('payroll', 'shortfall', 'decide', 'قرار خصم نقص الدوام (راتب/رصيد إجازات/إعفاء)'),
  def('payroll', 'shortfall', 'policy', 'ضبط سياسة نقص الدوام'),
  def('payroll', 'payment', 'read', 'عرض دفعات الرواتب والسلف'),
  def('payroll', 'payment', 'manage', 'تعليم الدفعات مدفوعة وتصديرها'),
  ...crud('admin_actions', 'type', 'أنواع الإجراءات الإدارية'),
  def(
    'admin_actions',
    'action',
    'read',
    'عرض الإجراءات الإدارية (تنبيهات وعقوبات ومكافآت وترقيات)',
  ),
  def(
    'admin_actions',
    'action',
    'create',
    'إنشاء إجراء إداري واعتماده مباشرة إن كان نوعه بلا موافقة',
  ),
  def(
    'admin_actions',
    'action',
    'propose',
    'اقتراح إجراء إداري لموظفي النطاق (يمرّ بالموافقة دائماً)',
  ),
  def('admin_actions', 'action', 'cancel', 'إلغاء إجراء إداري'),
  def('letters', 'document', 'read', 'عرض سجل الوثائق الصادرة وتنزيلها'),
  def('letters', 'document', 'issue', 'إصدار وثيقة لموظف'),
  def('letters', 'document', 'revoke', 'إبطال وثيقة صادرة'),
  def('approvals', 'flow', 'read', 'عرض سلاسل الموافقة'),
  def('approvals', 'flow', 'manage', 'إدارة سلاسل الموافقة'),
  def('approvals', 'request', 'read_all', 'عرض كل طلبات الموافقة'),
  def('approvals', 'request', 'submit', 'تقديم طلب موافقة عام'),
  def('approvals', 'delegation', 'manage', 'إدارة تفويض الموافقات لآخرين'),
  ...crud('leave', 'type', 'أنواع الإجازات'),
  ...crud('leave', 'policy', 'سياسات الإجازات وتعيينها'),
  ...crud('leave', 'holiday', 'العطل الرسمية'),
  def('leave', 'balance', 'read', 'عرض أرصدة الإجازات وسجلّها'),
  def('leave', 'balance', 'adjust', 'تعديل أرصدة الإجازات يدوياً'),
  def('leave', 'request', 'submit', 'تقديم طلب إجازة لنفسه'),
  def('leave', 'request', 'read_all', 'عرض كل طلبات الإجازة'),
  def('leave', 'request', 'manage', 'إدارة الطلبات: تقديم نيابة، إلغاء، تجاوز الأيام'),
  ...crud('attendance', 'shift', 'ورديات الدوام'),
  ...crud('attendance', 'schedule', 'جداول الدوام وتعيينها'),
  def('attendance', 'punch', 'read', 'عرض البصمات الخام'),
  def('attendance', 'punch', 'create', 'إدخال بصمات يدوياً'),
  def('attendance', 'punch', 'delete', 'حذف بصمة يدوية'),
  def('attendance', 'day', 'read_all', 'عرض حضور كل الموظفين'),
  def('attendance', 'day', 'recompute', 'إعادة احتساب أيام الحضور'),
  def('attendance', 'day', 'override', 'تجاوز يوم الحضور يدوياً'),
  ...crud('attendance', 'import_profile', 'ملفات استيراد البصمات'),
  def('attendance', 'import', 'read', 'عرض دفعات الاستيراد والسجلات المحجوزة'),
  def('attendance', 'import', 'create', 'رفع ملف بصمات واستيراده'),
  def('attendance', 'import', 'manage', 'معالجة المحجوز والتراجع عن دفعة'),
  def('attendance', 'correction', 'submit', 'تقديم طلب تعديل حضور'),
  def('attendance', 'correction', 'read_all', 'عرض كل طلبات تعديل الحضور'),
  def('attendance', 'correction', 'manage', 'تعديل الحضور مباشرة والتقديم نيابةً عن موظف'),
  def('attendance', 'overtime', 'submit', 'تقديم طلب عمل إضافي'),
  def('attendance', 'overtime', 'read_all', 'عرض كل طلبات العمل الإضافي'),
  def('attendance', 'overtime', 'manage', 'التقديم نيابةً عن موظف وسحب طلبات الآخرين'),
  def('identity', 'user', 'read', 'عرض المستخدمين'),
  def('identity', 'user', 'create', 'إضافة مستخدم'),
  def('identity', 'user', 'update', 'تعديل مستخدم'),
  def('identity', 'user', 'disable', 'تعطيل/تفعيل مستخدم'),
  def('identity', 'user', 'reset_password', 'إعادة تعيين كلمة مرور مستخدم'),
  def('identity', 'user', 'create_from_employee', 'إنشاء حساب مستخدم للموظف ودعوته'),
  def('identity', 'role', 'read', 'عرض الأدوار'),
  def('identity', 'role', 'manage', 'إدارة الأدوار والصلاحيات'),
];

export type DefaultRole = {
  code: string;
  nameAr: string;
  nameEn: string;
  /** '*' = كل الصلاحيات (ويُعاد مزامنتها دائماً)، وإلا دوال مطابقة على الرمز */
  grants: '*' | ((code: string) => boolean);
};

const isRead = (c: string) => c.endsWith('.read');

/** الأدوار الافتراضية الخمسة؛ قابلة للتعديل بعد إنشائها (عدا admin فيُزامَن دائماً). */
export const DEFAULT_ROLES: readonly DefaultRole[] = [
  { code: 'admin', nameAr: 'مدير النظام', nameEn: 'System Admin', grants: '*' },
  {
    code: 'hr_manager',
    nameAr: 'مدير الموارد البشرية',
    nameEn: 'HR Manager',
    grants: (c) => !c.startsWith('identity.role.'),
  },
  {
    code: 'hr_officer',
    nameAr: 'موظف موارد بشرية',
    nameEn: 'HR Officer',
    grants: (c) =>
      (isRead(c) ||
        c === 'leave.request.read_all' ||
        c === 'attendance.day.read_all' ||
        c === 'attendance.import.create' ||
        c === 'attendance.import.manage' ||
        c === 'attendance.correction.read_all' ||
        c === 'letters.document.issue' ||
        c === 'attendance.overtime.read_all') &&
      !c.startsWith('payroll.') &&
      c !== 'admin_actions.action.read' &&
      c !== 'system.audit.read' &&
      c !== 'system.job.read' &&
      c !== 'system.integration.read' &&
      c !== 'system.notification_template.read',
  },
  {
    code: 'manager',
    nameAr: 'مدير مباشر',
    nameEn: 'Line Manager',
    grants: (c) =>
      (isRead(c) && c.startsWith('org.')) ||
      c === 'leave.type.read' ||
      c === 'leave.holiday.read' ||
      c === 'attendance.shift.read' ||
      c === 'attendance.schedule.read' ||
      c === 'leave.request.submit' ||
      c === 'attendance.correction.submit' ||
      c === 'attendance.overtime.submit' ||
      c === 'approvals.request.submit' ||
      c === 'admin_actions.type.read' ||
      c === 'admin_actions.action.propose' ||
      c === 'employees.employee.read' ||
      c === 'employees.employment.read',
  },
  {
    code: 'employee',
    nameAr: 'موظف',
    nameEn: 'Employee',
    grants: (c) =>
      c === 'system.company.read' ||
      c === 'leave.type.read' ||
      c === 'leave.holiday.read' ||
      c === 'leave.request.submit' ||
      c === 'attendance.correction.submit' ||
      c === 'attendance.overtime.submit' ||
      c === 'approvals.request.submit' ||
      c === 'employees.employee.read' ||
      c === 'employees.employment.read',
  },
];
