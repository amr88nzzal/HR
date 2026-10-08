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
  def('identity', 'user', 'read', 'عرض المستخدمين'),
  def('identity', 'user', 'create', 'إضافة مستخدم'),
  def('identity', 'user', 'update', 'تعديل مستخدم'),
  def('identity', 'user', 'disable', 'تعطيل/تفعيل مستخدم'),
  def('identity', 'user', 'reset_password', 'إعادة تعيين كلمة مرور مستخدم'),
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
    grants: (c) => isRead(c) && c !== 'system.audit.read',
  },
  {
    code: 'manager',
    nameAr: 'مدير مباشر',
    nameEn: 'Line Manager',
    grants: (c) =>
      (isRead(c) && c.startsWith('org.')) ||
      c === 'employees.employee.read' ||
      c === 'employees.employment.read',
  },
  {
    code: 'employee',
    nameAr: 'موظف',
    nameEn: 'Employee',
    grants: (c) =>
      c === 'system.company.read' ||
      c === 'employees.employee.read' ||
      c === 'employees.employment.read',
  },
];
