import React from 'react';
import {
  MapPin,
  Calendar,
  Clock,
  Fingerprint,
  Sun,
  Moon,
  Globe,
  PanelRightClose,
  PanelRightOpen,
  Building2
} from 'lucide-react';
import { NavTab } from './Sidebar';
import { Branch } from '../types/hrms';
import { formatDateAr, getDayName, getTodayDateString } from '../utils/date';

interface HeaderProps {
  currentTab: NavTab;
  currentBranch: Branch;
  onQuickPunchClick: () => void;
  onZKTecoImportClick: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  language?: 'ar' | 'en';
  onToggleLanguage?: () => void;
}

const TAB_TITLES_AR: Record<NavTab, { title: string; subtitle: string }> = {
  dashboard: { title: 'لوحة التحكم التنفيذية', subtitle: 'نظرة شاملة ومؤشرات أداء الموارد البشرية الحية' },
  my_portal: { title: 'بوابة الخدمة الذاتية للموظف', subtitle: 'متابعة بياناتك الشخصية، سجل دوامك، إجازاتك، وقسائم رواتبك' },
  employees: { title: 'إدارة شؤون الموظفين', subtitle: 'سجلات الموظفين والعقود والبيانات البنكية والمراجع' },
  attendance: { title: 'الحضور والانصراف وأجهزة البصمة', subtitle: 'متابعة الدوام اليومي والورديات واستيراد بيانات ZKTeco' },
  payroll: { title: 'كشف الرواتب الشهرية والبدلات', subtitle: 'احتساب دقيق: الإجمالي ثم الصافي قبل السلف ثم الصافي المستحق للتسديد' },
  leaves: { title: 'نظام الإجازات والأرصدة', subtitle: 'تقديم واعتماد الإجازات وسجل حركات الأرصدة (FIFO)' },
  loans: { title: 'إدارة السلف وفواتير الذمم', subtitle: 'جدول الأقساط والخصم التلقائي من كشوف الرواتب الشهرية' },
  approvals: { title: 'صندوق الموافقات وسير العمل', subtitle: 'الطلبات المعلقة قيد مراجعة واعتماد المسؤولين' },
  documents: { title: 'الوثائق والشهادات الصادرة', subtitle: 'شهادات الخبرة وإثبات الراتب مع رمز QR للتحقق' },
  reports: { title: 'التقارير ومراكز التصدير', subtitle: 'كشوفات الرواتب والحضور والضمان المتوافقة مع المحاسبة' },
  organization: { title: 'الهيكل التنظيمي والفروع', subtitle: 'شجرة الشركات، الفروع، الأقسام، والأدوار والمسميات الوظيفية' },
  audit: { title: 'سجل التدقيق وتتبع العمليات', subtitle: 'سجل آمن غير قابل للتعديل لجميع الحركات الإدارية والمالية' },
  settings: { title: 'إعدادات وسياسات النظام الشاملة', subtitle: 'تخصيص 100% للورديات، كشف الرواتب، الضمان، الإجازات، وأجهزة ZKTeco' }
};

const TAB_TITLES_EN: Record<NavTab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Executive Dashboard', subtitle: 'Comprehensive overview and real-time HR performance metrics' },
  my_portal: { title: 'Employee Self-Service Portal', subtitle: 'Access personal profile, attendance records, leaves, and payslips' },
  employees: { title: 'Employee Affairs Management', subtitle: 'Personnel profiles, contracts, banking details, and records' },
  attendance: { title: 'Attendance & Biometrics', subtitle: 'Daily shifts tracking and ZKTeco biometric log processing' },
  payroll: { title: 'Monthly Payroll Register', subtitle: '5-step precision: Gross -> Statutory Net -> Loans & Debts -> Final Net' },
  leaves: { title: 'Leaves & Balances System', subtitle: 'Leave submissions, balance ledger, and automated approvals' },
  loans: { title: 'Loans & Receivables', subtitle: 'Installment schedules and automatic payroll deductions' },
  approvals: { title: 'Approvals & Workflow Inbox', subtitle: 'Pending managerial and financial approvals' },
  documents: { title: 'Official Documents & Letters', subtitle: 'Employment and salary certificates with QR verification' },
  reports: { title: 'Reports & Export Center', subtitle: 'Payroll registers, attendance logs, and social security filings' },
  organization: { title: 'Organization Structure & Entities', subtitle: 'Companies, Branches, Departments, and Job Roles' },
  audit: { title: 'Audit Trail & Activity Log', subtitle: 'Tamper-proof compliance log of all financial and administrative actions' },
  settings: { title: 'System Policies & Configuration', subtitle: '100% customizable shifts, payroll rules, Jordan social security' }
};

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  currentBranch,
  onQuickPunchClick,
  onZKTecoImportClick,
  isCollapsed = false,
  onToggleCollapse,
  theme = 'light',
  onToggleTheme,
  language = 'ar',
  onToggleLanguage
}) => {
  const isEn = language === 'en';
  const tabInfo = isEn
    ? (TAB_TITLES_EN[currentTab] || { title: 'HRMS System', subtitle: '' })
    : (TAB_TITLES_AR[currentTab] || { title: 'نظام شؤون الموظفين', subtitle: '' });

  const todayStr = getTodayDateString();
  const dayName = getDayName(todayStr);

  return (
    <header className="h-18 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-4 md:px-7 flex items-center justify-between shrink-0 shadow-xs z-20 transition-colors duration-200">
      {/* Title & Subtitle + Sidebar toggle button */}
      <div className="flex items-center gap-3">
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title={isCollapsed ? (isEn ? 'Expand sidebar' : 'إظهار القائمة الجانبية') : (isEn ? 'Collapse sidebar' : 'طي القائمة الجانبية')}
          >
            {isCollapsed ? (
              <PanelRightOpen className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <PanelRightClose className="w-5 h-5" />
            )}
          </button>
        )}

        <div>
          <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <span>{tabInfo.title}</span>
          </h2>
          <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
            {tabInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Center / Right controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Branch indicator */}
        <div className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40 text-xs font-medium">
          <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>{isEn ? (currentBranch?.nameEn || currentBranch?.nameAr) : (currentBranch?.nameAr || 'المقر الرئيسي - عمان')}</span>
        </div>

        {/* Date in Jordan */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-medium">
          <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>{isEn ? todayStr : `${dayName}، ${formatDateAr(todayStr)}`}</span>
        </div>

        {/* Language Switcher Button */}
        {onToggleLanguage && (
          <button
            onClick={onToggleLanguage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer shadow-xs"
            title={isEn ? 'تبديل إلى العربية' : 'Switch to English'}
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-mono">{isEn ? 'العربية' : 'EN'}</span>
          </button>
        )}

        {/* Theme Switcher Button (Dark / Light) */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className={`p-2 rounded-xl border transition cursor-pointer shadow-xs ${
              theme === 'dark'
                ? 'bg-slate-800 border-slate-700 text-amber-400 hover:bg-slate-750'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
            title={theme === 'dark' ? (isEn ? 'Switch to Light Mode' : 'تفعيل الوضع النهاري') : (isEn ? 'Switch to Dark Mode' : 'تفعيل الوضع الليلي')}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>
        )}

        {/* Quick Action: Live Punch */}
        <button
          onClick={onQuickPunchClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold shadow-xs transition cursor-pointer border border-slate-800 dark:border-slate-700"
          title={isEn ? 'Instant Attendance Punch' : 'تسجيل بصمة فورية لموظف'}
        >
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">{isEn ? 'Quick Punch' : 'بصمة سريعة'}</span>
        </button>

        {/* Quick Action: ZKTeco Import */}
        <button
          onClick={onZKTecoImportClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
          title={isEn ? 'Import ZKTeco Logs' : 'استيراد وتوزيع حركات جهاز البصمة'}
        >
          <Fingerprint className="w-4 h-4 text-emerald-100" />
          <span className="hidden sm:inline">{isEn ? 'ZKTeco Import' : 'استيراد ZKTeco'}</span>
        </button>
      </div>
    </header>
  );
};
