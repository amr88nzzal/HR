import React from 'react';
import {
  LayoutDashboard,
  Users,
  Clock,
  Banknote,
  CalendarCheck,
  CreditCard,
  FileCheck2,
  FileText,
  BarChart3,
  Network,
  History,
  Settings,
  Building2,
  ShieldCheck,
  UserCheck,
  ChevronRight,
  ChevronLeft,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import { RoleType, UserSession } from '../types/hrms';

export type NavTab =
  | 'dashboard'
  | 'employees'
  | 'attendance'
  | 'payroll'
  | 'leaves'
  | 'loans'
  | 'approvals'
  | 'documents'
  | 'reports'
  | 'organization'
  | 'audit'
  | 'settings'
  | 'my_portal';

interface SidebarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  pendingApprovalsCount: number;
  session: UserSession;
  onSwitchRole: (role: RoleType) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  language?: 'ar' | 'en';
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  pendingApprovalsCount,
  session,
  onSwitchRole,
  isCollapsed,
  onToggleCollapse,
  language = 'ar'
}) => {
  const isEn = language === 'en';

  // Navigation Items according to Role
  const getNavItems = () => {
    if (session.role === 'employee') {
      return [
        { id: 'my_portal', label: isEn ? 'Self-Service Portal' : 'بوابة الخدمة الذاتية', icon: LayoutDashboard },
        { id: 'payroll', label: isEn ? 'My Payslips' : 'كشوفات وقسائم رواتبي', icon: Banknote },
        { id: 'attendance', label: isEn ? 'My Attendance' : 'سجل دوامي وبصماتي', icon: Clock },
        { id: 'leaves', label: isEn ? 'My Leaves' : 'إجازاتي وطلباتي', icon: CalendarCheck },
        { id: 'loans', label: isEn ? 'My Loans & Debts' : 'سلفي وفواتير الذمم', icon: CreditCard },
        { id: 'documents', label: isEn ? 'Request Document' : 'طلب شهادة رسمية', icon: FileText }
      ];
    }

    if (session.role === 'payroll_accountant') {
      return [
        { id: 'dashboard', label: isEn ? 'Financial Dashboard' : 'لوحة التحكم والتحليلات', icon: LayoutDashboard },
        { id: 'payroll', label: isEn ? 'Monthly Payroll' : 'كشف الرواتب الشهرية', icon: Banknote },
        { id: 'loans', label: isEn ? 'Loans & Debts' : 'السلف وفواتير الذمم', icon: CreditCard },
        {
          id: 'approvals',
          label: isEn ? 'Payroll Approvals' : 'اعتماد الرواتب والسلف',
          icon: FileCheck2,
          badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined
        },
        { id: 'reports', label: isEn ? 'Reports & Exports' : 'التقارير ومراكز التصدير', icon: BarChart3 },
        { id: 'audit', label: isEn ? 'Financial Audit Log' : 'سجل التدقيق المالي', icon: History }
      ];
    }

    if (session.role === 'department_manager') {
      return [
        { id: 'dashboard', label: isEn ? 'Dept Dashboard' : 'لوحة متابعة القسم', icon: LayoutDashboard },
        { id: 'employees', label: isEn ? 'Dept Employees' : 'موظفو القسم', icon: Users },
        { id: 'attendance', label: isEn ? 'Dept Attendance' : 'دوام وبصمات القسم', icon: Clock },
        { id: 'leaves', label: isEn ? 'Team Leaves' : 'إجازات فريق العمل', icon: CalendarCheck },
        {
          id: 'approvals',
          label: isEn ? 'Dept Approvals' : 'صندوق موافقات القسم',
          icon: FileCheck2,
          badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined
        },
        { id: 'documents', label: isEn ? 'Documents' : 'الوثائق والشهادات', icon: FileText }
      ];
    }

    // Default for HR Manager & Super Admin
    return [
      { id: 'dashboard', label: isEn ? 'Dashboard' : 'لوحة التحكم الرئيسية', icon: LayoutDashboard },
      { id: 'employees', label: isEn ? 'Employees' : 'شؤون الموظفين', icon: Users },
      { id: 'attendance', label: isEn ? 'Attendance & Biometrics' : 'الحضور والانصراف والبصمة', icon: Clock },
      { id: 'payroll', label: isEn ? 'Monthly Payroll' : 'كشف الرواتب الشهرية', icon: Banknote },
      { id: 'leaves', label: isEn ? 'Leaves & Balances' : 'الإجازات والأرصدة', icon: CalendarCheck },
      { id: 'loans', label: isEn ? 'Loans & Debts' : 'السلف وفواتير الذمم', icon: CreditCard },
      {
        id: 'approvals',
        label: isEn ? 'Approvals Inbox' : 'صندوق الموافقات',
        icon: FileCheck2,
        badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined
      },
      { id: 'documents', label: isEn ? 'Documents & Letters' : 'الوثائق والشهادات', icon: FileText },
      { id: 'reports', label: isEn ? 'Reports & Exports' : 'التقارير ومراكز التصدير', icon: BarChart3 },
      { id: 'organization', label: isEn ? 'Organization & Structure' : 'الهيكل التنظيمي والفروع', icon: Network },
      { id: 'audit', label: isEn ? 'Audit Logs' : 'سجل التدقيق والحركات', icon: History },
      { id: 'settings', label: isEn ? 'System Settings' : 'إعدادات وسياسات النظام', icon: Settings }
    ];
  };

  const navItems = getNavItems();

  return (
    <aside
      className={`bg-slate-900 text-slate-100 flex flex-col h-screen border-l border-slate-800 shadow-xl shrink-0 z-30 select-none transition-all duration-300 relative ${
        isCollapsed ? 'w-20' : 'w-72'
      }`}
    >
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-400/30 shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <h1 className="font-bold text-sm tracking-wide text-white flex items-center gap-1.5 truncate">
                <span>{isEn ? 'HRMS System' : 'نظام شؤون الموظفين'}</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/30">PRO</span>
              </h1>
              <p className="text-[11px] text-slate-400 truncate">{isEn ? 'Elite Solutions Jordan' : 'شركة النخبة للتقنية - الأردن'}</p>
            </div>
          )}
        </div>

        {/* Toggle Collapse Button */}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          title={isCollapsed ? (isEn ? 'Expand Sidebar' : 'إظهار القائمة كاملة') : (isEn ? 'Collapse Sidebar' : 'طي القائمة الجانبية')}
        >
          {isCollapsed ? <PanelRightOpen className="w-4 h-4 text-emerald-400" /> : <PanelRightClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Role Badge Indicator */}
      {!isCollapsed && (
        <div className="px-4 py-2 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between text-[11px]">
          <span className="text-slate-400">{isEn ? 'Active Role:' : 'الصلاحية المفعلة:'}</span>
          <span className="font-bold text-emerald-400 truncate max-w-[150px]">{session.roleTitleAr}</span>
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto p-2.5 space-y-1 custom-scrollbar">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id as NavTab)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer ${
                isCollapsed
                  ? 'justify-center p-3'
                  : 'justify-between px-3.5 py-2.5 text-right'
              } ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>
              {!isCollapsed && item.badge !== undefined && (
                <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm">
                  {item.badge}
                </span>
              )}
              {isCollapsed && item.badge !== undefined && (
                <span className="absolute top-1 left-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-slate-900"></span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Role Switcher Box */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/70 space-y-2">
        {!isCollapsed ? (
          <>
            <div className="flex items-center gap-3 p-2 bg-slate-800/60 rounded-xl border border-slate-700/50">
              <div className="w-8 h-8 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center text-xs shadow shrink-0">
                {session.name.substring(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-200 truncate">{session.name}</p>
                <p className="text-[10px] text-emerald-400 truncate">{session.roleTitleAr}</p>
              </div>
            </div>

            <div className="bg-slate-900 px-2.5 py-2 rounded-xl border border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-300 font-semibold">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isEn ? 'Switch System Role:' : 'تبديل الصلاحية للمعاينة:'}</span>
              </div>
              <select
                value={session.role}
                onChange={(e) => onSwitchRole(e.target.value as RoleType)}
                className="w-full bg-slate-800 text-slate-100 text-[11px] px-2 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer font-medium"
              >
                <option value="hr_manager">{isEn ? 'HR Manager' : 'مدير الموارد البشرية'}</option>
                <option value="payroll_accountant">{isEn ? 'Payroll Accountant' : 'المحاسب المالي للرواتب'}</option>
                <option value="department_manager">{isEn ? 'Department Manager' : 'مدير قسم (فريق العمل)'}</option>
                <option value="employee">{isEn ? 'Employee Self-Service' : 'موظف (بوابة الخدمة الذاتية)'}</option>
                <option value="super_admin">{isEn ? 'Super Admin' : 'مدير النظام الشامل'}</option>
              </select>
            </div>
          </>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={onToggleCollapse}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 flex items-center justify-center cursor-pointer shadow"
              title={isEn ? 'Expand User Options' : 'توسيع القائمة لإدارة المستخدم'}
            >
              <UserCheck className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
