import React, { useState } from 'react';
import {
  Settings,
  ShieldCheck,
  Building,
  Fingerprint,
  Calendar,
  Save,
  RotateCcw,
  CheckCircle2,
  DollarSign,
  Clock,
  Banknote,
  CalendarCheck,
  CreditCard,
  Layers,
  HelpCircle
} from 'lucide-react';
import { SystemSettings, Company } from '../../types/hrms';
import { storage } from '../../services/storage';

interface SettingsViewProps {
  settings: SystemSettings;
  company: Company;
  onRefresh: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  company,
  onRefresh
}) => {
  const [activeTab, setActiveTab] = useState<'company' | 'attendance' | 'payroll' | 'social_security' | 'leaves' | 'loans' | 'zkteco'>('company');
  const [formData, setFormData] = useState<SystemSettings>({ ...settings });
  const [companyData, setCompanyData] = useState<Company>({ ...company });
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    storage.saveSettings(formData);
    storage.saveCompany(companyData);
    storage.logAction('تحديث إعدادات وسياسات النظام', 'update', 'settings', 'تم حفظ السياسات والقواعد المخصصة للنظام');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
    onRefresh();
  };

  const handleResetDemo = () => {
    if (confirm('هل أنت متأكد من رغبتك في إعادة ضبط جميع الإعدادات والبيانات إلى الوضع المصنعي الافتراضي؟')) {
      storage.resetAll();
      onRefresh();
      window.location.reload();
    }
  };

  const daysOfWeek = [
    { id: 6, label: 'السبت' },
    { id: 0, label: 'الأحد' },
    { id: 1, label: 'الإثنين' },
    { id: 2, label: 'الثلاثاء' },
    { id: 3, label: 'الأربعاء' },
    { id: 4, label: 'الخميس' },
    { id: 5, label: 'الجمعة' }
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            <span>إعدادات وسياسات النظام الشاملة (System Control Center)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            ضبط متقدم وتخصيص 100% لكافة سياسات الشركة، الورديات، أسس احتساب كشوف الرواتب، الضمان، الإجازات، وأجهزة ZKTeco.
          </p>
        </div>

        <button
          onClick={handleResetDemo}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer self-start md:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>إعادة ضبط البيانات المصنعية</span>
        </button>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('company')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'company' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building className="w-3.5 h-3.5 text-emerald-600" />
          <span>الشركة والمطبوعات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('attendance')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'attendance' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-blue-600" />
          <span>أوقات الدوام والورديات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payroll')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'payroll' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Banknote className="w-3.5 h-3.5 text-emerald-700" />
          <span>كشف الرواتب والأجور</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('social_security')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'social_security' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
          <span>الضمان والضريبة</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('leaves')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'leaves' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CalendarCheck className="w-3.5 h-3.5 text-amber-600" />
          <span>سياسات الإجازات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('loans')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'loans' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5 text-rose-600" />
          <span>السلف والذمم المالية</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('zkteco')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'zkteco' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Fingerprint className="w-3.5 h-3.5 text-teal-600" />
          <span>تكامل أجهزة ZKTeco</span>
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* TAB 1: COMPANY & BRANDING */}
        {activeTab === 'company' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              بيانات المنشأة والهوية والمطبوعات الرسمية
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">اسم المنشأة بالعربية:</label>
                <input
                  type="text"
                  required
                  value={companyData.nameAr}
                  onChange={(e) => setCompanyData({ ...companyData, nameAr: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">اسم المنشأة بالإنجليزية:</label>
                <input
                  type="text"
                  required
                  value={companyData.nameEn}
                  onChange={(e) => setCompanyData({ ...companyData, nameEn: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-800"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">رقم السجل التجاري (CR):</label>
                <input
                  type="text"
                  value={companyData.crNumber}
                  onChange={(e) => setCompanyData({ ...companyData, crNumber: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">الرقم الضريبي:</label>
                <input
                  type="text"
                  value={companyData.taxNumber}
                  onChange={(e) => setCompanyData({ ...companyData, taxNumber: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">رقم المنشأة بالضمان الاجتماعي:</label>
                <input
                  type="text"
                  value={companyData.socialSecurityNumber}
                  onChange={(e) => setCompanyData({ ...companyData, socialSecurityNumber: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-emerald-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">رقم الهاتف الرسمي:</label>
                <input
                  type="text"
                  value={companyData.phone}
                  onChange={(e) => setCompanyData({ ...companyData, phone: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">البريد الإلكتروني الرسمي:</label>
                <input
                  type="email"
                  value={companyData.email}
                  onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">الموقع الإلكتروني:</label>
                <input
                  type="text"
                  value={companyData.website}
                  onChange={(e) => setCompanyData({ ...companyData, website: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-600 mb-1">العنوان التفصيلي ومقر الشركة:</label>
              <input
                type="text"
                value={companyData.address}
                onChange={(e) => setCompanyData({ ...companyData, address: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
              />
            </div>

            <div className="text-xs">
              <label className="block text-slate-600 mb-1">تذييل الخطابات والمطبوعات الرسمية:</label>
              <textarea
                rows={2}
                value={companyData.officialLetterFooter}
                onChange={(e) => setCompanyData({ ...companyData, officialLetterFooter: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
              />
            </div>
          </div>
        )}

        {/* TAB 2: ATTENDANCE & SHIFTS */}
        {activeTab === 'attendance' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              سياسات الحضور والانصراف والورديات وساعات العمل
            </h4>

            {/* Work days picker */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">أيام العمل الأسبوعية الرسمية:</label>
              <div className="flex flex-wrap gap-2 text-xs">
                {daysOfWeek.map(day => {
                  const isChecked = formData.workDays.includes(day.id);
                  return (
                    <button
                      type="button"
                      key={day.id}
                      onClick={() => {
                        let newDays = [...formData.workDays];
                        if (isChecked) {
                          newDays = newDays.filter(d => d !== day.id);
                        } else {
                          newDays.push(day.id);
                        }
                        const newWeekends = daysOfWeek.map(d => d.id).filter(id => !newDays.includes(id));
                        setFormData({ ...formData, workDays: newDays, weekendDays: newWeekends });
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                        isChecked
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">الأيام غير المحددة تعتبر تلقائياً عطلات أسبوعية رسمية (حالياً: الجمعة).</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2">
              <div>
                <label className="block text-slate-600 mb-1">وقت بدء الوردية الافتراضية:</label>
                <input
                  type="time"
                  value={formData.defaultShiftStartTime}
                  onChange={(e) => setFormData({ ...formData, defaultShiftStartTime: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">وقت انتهاء الوردية الافتراضية:</label>
                <input
                  type="time"
                  value={formData.defaultShiftEndTime}
                  onChange={(e) => setFormData({ ...formData, defaultShiftEndTime: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">فترة سماح التأخير الصباحي (دقائق):</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={formData.graceMinutesLate}
                  onChange={(e) => setFormData({ ...formData, graceMinutesLate: parseInt(e.target.value, 10) || 0 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-400">التأخير بعد هذه المدة يتم حسابه بالدقائق</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">فترة سماح الخروج المبكر (دقائق):</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={formData.graceMinutesEarly}
                  onChange={(e) => setFormData({ ...formData, graceMinutesEarly: parseInt(e.target.value, 10) || 0 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">معامل أجر العمل الإضافي في الأيام العادية:</label>
                <input
                  type="number"
                  step="0.05"
                  value={formData.overtimeNormalRate}
                  onChange={(e) => setFormData({ ...formData, overtimeNormalRate: parseFloat(e.target.value) || 1.25 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-emerald-800"
                />
                <span className="text-[10px] text-slate-400">القانون الأردني: 1.25 من أجر الساعة المعتاد</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">معامل أجر الإضافي في العطل والأعياد الرسمية:</label>
                <input
                  type="number"
                  step="0.05"
                  value={formData.overtimeWeekendRate}
                  onChange={(e) => setFormData({ ...formData, overtimeWeekendRate: parseFloat(e.target.value) || 1.5 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-emerald-800"
                />
                <span className="text-[10px] text-slate-400">القانون الأردني: 1.50 من أجر الساعة المعتاد</span>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-600 mb-1">سياسة معالجة البصمة الناقصة (تسجيل دخول فقط دون انصراف):</label>
              <select
                value={formData.incompletePunchPolicy}
                onChange={(e) => setFormData({ ...formData, incompletePunchPolicy: e.target.value as any })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold"
              >
                <option value="alert_only">تنبيه وإشعار مسؤول HR فقط لطلب التبرير (موصى به)</option>
                <option value="half_day">احتساب نصف يوم دوام ونصف يوم غياب</option>
                <option value="absent">اعتبار اليوم غياباً كاملاً لحين تقديم تصحيح رسمي</option>
              </select>
            </div>
          </div>
        )}

        {/* TAB 3: PAYROLL CALCULATION POLICIES */}
        {activeTab === 'payroll' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              قواعد وأسس احتساب كشف الرواتب الشهرية
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">أساس احتساب الأجر اليومي:</label>
                <select
                  value={formData.salaryDayBasis}
                  onChange={(e) => setFormData({ ...formData, salaryDayBasis: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-800"
                >
                  <option value="fixed_30">أساس 30 يوماً شهرياً ثابتاً (الافتراضي والمعتمد بالأردن)</option>
                  <option value="actual_month_days">أيام الشهر الفعلية (28 أو 29 أو 30 أو 31)</option>
                  <option value="actual_work_days">أيام العمل الفعلية فقط في الشهر</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">يوم صرف الرواتب الشهري المعتاد بالشركة:</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={formData.salaryPayDayOfMonth}
                  onChange={(e) => setFormData({ ...formData, salaryPayDayOfMonth: parseInt(e.target.value, 10) || 28 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-400">مثال: يوم 28 من كل شهر ميلادي</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">سياسة استقطاع التأخيرات الصباحية:</label>
                <select
                  value={formData.lateDeductionPolicy}
                  onChange={(e) => setFormData({ ...formData, lateDeductionPolicy: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold"
                >
                  <option value="cumulative_hours">تراكمي بالساعات (خصم أجر الساعات المتأخرة بعد سقف السماح)</option>
                  <option value="quarter_day_after_hour">خصم ربع يوم عمل عند تجاوز 60 دقيقة تأخير</option>
                  <option value="strict_minutes">خصم الدقائق الصريحة بالتناسب مع أجر الدقيقة</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">العملة ورمز الكسور:</label>
                <input
                  type="text"
                  disabled
                  value="دينار أردني (د.أ - JOD) • 3 خانات عشرية (فلس)"
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 font-bold text-slate-600 cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SOCIAL SECURITY & TAX */}
        {activeTab === 'social_security' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              قواعد الضمان الاجتماعي الأردني وضريبة الدخل
            </h4>

            {/* Social Security */}
            <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  id="ss_active"
                  checked={formData.socialSecurityEnabled}
                  onChange={(e) => setFormData({ ...formData, socialSecurityEnabled: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="ss_active" className="text-slate-900 font-bold">
                  تفعيل اقتطاعات الضمان الاجتماعي تلقائياً في كشف الرواتب
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">نسبة اقتطاع الموظف (الافتراضي 7.5%):</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.employeeSocialSecurityRate}
                    onChange={(e) => setFormData({ ...formData, employeeSocialSecurityRate: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                  <span className="text-[10px] text-slate-500">{(formData.employeeSocialSecurityRate * 100).toFixed(2)}%</span>
                </div>

                <div>
                  <label className="block text-slate-600 mb-1">نسبة مساهمة المنشأة (الافتراضي 14.25%):</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.companySocialSecurityRate}
                    onChange={(e) => setFormData({ ...formData, companySocialSecurityRate: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                  <span className="text-[10px] text-slate-500">{(formData.companySocialSecurityRate * 100).toFixed(2)}%</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">الحد الأدنى للأجر الخاضع للضمان (د.أ):</label>
                  <input
                    type="number"
                    value={formData.socialSecurityMinSalary}
                    onChange={(e) => setFormData({ ...formData, socialSecurityMinSalary: parseFloat(e.target.value) || 260 })}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 mb-1">سقف الأجر الخاضع للضمان (د.أ):</label>
                  <input
                    type="number"
                    value={formData.socialSecurityMaxSalaryCap}
                    onChange={(e) => setFormData({ ...formData, socialSecurityMaxSalaryCap: parseFloat(e.target.value) || 3612 })}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Income Tax */}
            <div className="p-4 bg-purple-50/50 rounded-xl border border-purple-100 space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  id="tax_active"
                  checked={formData.incomeTaxEnabled}
                  onChange={(e) => setFormData({ ...formData, incomeTaxEnabled: e.target.checked })}
                  className="rounded text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="tax_active" className="text-slate-900 font-bold">
                  تفعيل اقتطاع ضريبة الدخل التقديرية بالشرائح
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">الإعفاء الشخصي السنوي للمكلف (د.أ):</label>
                  <input
                    type="number"
                    value={formData.incomeTaxPersonalExemptionYearly}
                    onChange={(e) => setFormData({ ...formData, incomeTaxPersonalExemptionYearly: parseFloat(e.target.value) || 9000 })}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                  <span className="text-[10px] text-slate-400">9,000 دينار أردني سنوياً</span>
                </div>

                <div>
                  <label className="block text-slate-600 mb-1">سقف إعفاء المعالين السنوي الإضافي (د.أ):</label>
                  <input
                    type="number"
                    value={formData.incomeTaxDependentExemptionYearly}
                    onChange={(e) => setFormData({ ...formData, incomeTaxDependentExemptionYearly: parseFloat(e.target.value) || 9000 })}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                  <span className="text-[10px] text-slate-400">حتى 9,000 دينار سنوياً</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: LEAVES POLICIES */}
        {activeTab === 'leaves' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              سياسات الإجازات والأرصدة وقواعد الترحيل
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">رصيد الإجازة السنوية الأولي (أيام):</label>
                <input
                  type="number"
                  value={formData.annualLeaveInitialDays}
                  onChange={(e) => setFormData({ ...formData, annualLeaveInitialDays: parseInt(e.target.value, 10) || 14 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-400">القانون الأردني: 14 يوماً للسنوات الـ 5 الأولى</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">رصيد الإجازة السنوية بعد الأقدمية (أيام):</label>
                <input
                  type="number"
                  value={formData.annualLeaveSeniorDays}
                  onChange={(e) => setFormData({ ...formData, annualLeaveSeniorDays: parseInt(e.target.value, 10) || 21 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-emerald-800"
                />
                <span className="text-[10px] text-slate-400">القانون الأردني: 21 يوماً لمن تجاوزت خدمته 5 سنوات</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">رصيد الإجازات المرضية السنوية (أيام):</label>
                <input
                  type="number"
                  value={formData.sickLeaveDays}
                  onChange={(e) => setFormData({ ...formData, sickLeaveDays: parseInt(e.target.value, 10) || 14 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-blue-800"
                />
                <span className="text-[10px] text-slate-400">مدفوعة الأجر بالكامل بتقرير طبي</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">سقف الأيام المسموح بترحيلها للسنة التالية:</label>
                <input
                  type="number"
                  value={formData.maxLeaveCarryOverDays}
                  onChange={(e) => setFormData({ ...formData, maxLeaveCarryOverDays: parseInt(e.target.value, 10) || 7 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-400">ما زاد عن ذلك يسقط أو يصرف نقداً</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">مهلة الإشعار المسبق لطلب الإجازة (أيام):</label>
                <input
                  type="number"
                  value={formData.leaveNoticeDaysRequired}
                  onChange={(e) => setFormData({ ...formData, leaveNoticeDaysRequired: parseInt(e.target.value, 10) || 2 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: LOANS & DEBTS */}
        {activeTab === 'loans' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              سياسات السلف وفواتير الذمم والمشتريات
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">الحد الأقصى لمبلغ السلفة (مضاعف الراتب الأساسي):</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.maxLoanMultiplierOfSalary}
                  onChange={(e) => setFormData({ ...formData, maxLoanMultiplierOfSalary: parseFloat(e.target.value) || 2 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-400">مثال: 2x تعني ضعف الراتب الأساسي</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">الحد الأقصى لأشهر السداد:</label>
                <input
                  type="number"
                  value={formData.maxLoanInstallmentsMonths}
                  onChange={(e) => setFormData({ ...formData, maxLoanInstallmentsMonths: parseInt(e.target.value, 10) || 12 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                />
                <span className="text-[10px] text-slate-400">مثال: 12 شهراً كحد أقصى</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">سقف نسبة الاستقطاع الشهري من صافي الراتب (%):</label>
                <input
                  type="number"
                  value={formData.maxMonthlyDeductionPercent}
                  onChange={(e) => setFormData({ ...formData, maxMonthlyDeductionPercent: parseInt(e.target.value, 10) || 30 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-rose-700"
                />
                <span className="text-[10px] text-slate-400">حماية لحقوق الموظف المعيشية</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 text-xs">
              <input
                type="checkbox"
                id="rec_enabled"
                checked={formData.receivablesDeductionEnabled}
                onChange={(e) => setFormData({ ...formData, receivablesDeductionEnabled: e.target.checked })}
                className="rounded text-emerald-600 focus:ring-emerald-500"
              />
              <label htmlFor="rec_enabled" className="text-slate-800 font-bold">
                تفعيل استقطاع فواتير الذمم والعهد والمشتريات مباشرة في كشف الرواتب الشهري بعد احتساب صافي الراتب
              </label>
            </div>
          </div>
        )}

        {/* TAB 7: ZKTECO INTEGRATION */}
        {activeTab === 'zkteco' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              إعدادات وتكامل أجهزة البصمة ZKTeco
            </h4>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 font-mono" dir="ltr">
              Format: {formData.zktecoFormatGuide}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">الفاصل المستخدم:</label>
                <input
                  type="text"
                  value={formData.zktecoSeparator}
                  onChange={(e) => setFormData({ ...formData, zktecoSeparator: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-center font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">رمز الدخول (In):</label>
                <input
                  type="text"
                  value={formData.zktecoCodeIn}
                  onChange={(e) => setFormData({ ...formData, zktecoCodeIn: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-center font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">رمز الانصراف (Out):</label>
                <input
                  type="text"
                  value={formData.zktecoCodeOut}
                  onChange={(e) => setFormData({ ...formData, zktecoCodeOut: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-center font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">منفذ الاتصال (Port):</label>
                <input
                  type="number"
                  value={formData.zktecoDefaultPort}
                  onChange={(e) => setFormData({ ...formData, zktecoDefaultPort: parseInt(e.target.value, 10) || 4370 })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-center font-bold"
                />
              </div>
            </div>
          </div>
        )}

        {/* Save Bar */}
        <div className="flex items-center justify-between pt-2">
          {saveSuccess ? (
            <span className="text-emerald-700 font-bold text-xs flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>تم حفظ وتحديث كافة السياسات والإعدادات بنجاح!</span>
            </span>
          ) : (
            <span></span>
          )}

          <button
            type="submit"
            className="px-7 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md transition flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>حفظ الإعدادات المعتمدة</span>
          </button>
        </div>
      </form>
    </div>
  );
};
