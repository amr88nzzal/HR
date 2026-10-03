/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/Dashboard/DashboardView';
import { EmployeesView } from './components/Employees/EmployeesView';
import { AttendanceView } from './components/Attendance/AttendanceView';
import { PayrollView } from './components/Payroll/PayrollView';
import { LeavesView } from './components/Leaves/LeavesView';
import { LoansView } from './components/Loans/LoansView';
import { ApprovalsView } from './components/Approvals/ApprovalsView';
import { DocumentsView } from './components/Documents/DocumentsView';
import { ReportsView } from './components/Reports/ReportsView';
import { OrganizationView } from './components/Organization/OrganizationView';
import { AuditLogView } from './components/AuditLog/AuditLogView';
import { SettingsView } from './components/Settings/SettingsView';
import { EmployeePortalView } from './components/EmployeePortal/EmployeePortalView';
import { storage, ROLE_SESSIONS } from './services/storage';
import { attendanceService } from './services/attendanceService';
import { payrollService } from './services/payrollService';
import { getTodayDateString } from './utils/date';
import { RoleType } from './types/hrms';
import { Clock, Fingerprint, X, ShieldAlert, UserCheck } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState(storage.getUserSession());
  const [currentTab, setCurrentTab] = useState<NavTab>(
    session.role === 'employee' ? 'my_portal' : 'dashboard'
  );

  // App data state
  const [company, setCompany] = useState(storage.getCompany());
  const [branches, setBranches] = useState(storage.getBranches());
  const [departments, setDepartments] = useState(storage.getDepartments());
  const [jobTitles, setJobTitles] = useState(storage.getJobTitles());
  const [shifts, setShifts] = useState(storage.getShifts());
  const [employees, setEmployees] = useState(storage.getEmployees());
  const [attendanceDays, setAttendanceDays] = useState(storage.getDailyAttendanceRecords());
  const [leaves, setLeaves] = useState(storage.getLeaveRequests());
  const [loans, setLoans] = useState(storage.getLoans());
  const [debts, setDebts] = useState(storage.getDebts());
  const [payrollRuns, setPayrollRuns] = useState(storage.getPayrollRuns());
  const [auditLogs, setAuditLogs] = useState(storage.getAuditLogs());
  const [settings, setSettings] = useState(storage.getSettings());

  // UI Theme, Language, and Sidebar Collapse State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('hrms_theme') as 'light' | 'dark') || 'light';
  });
  const [language, setLanguage] = useState<'ar' | 'en'>(() => {
    return (localStorage.getItem('hrms_lang') as 'ar' | 'en') || 'ar';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('hrms_sidebar_collapsed') === 'true';
  });

  // Quick modals state
  const [isQuickPunchOpen, setIsQuickPunchOpen] = useState(false);
  const [quickPunchEmpId, setQuickPunchEmpId] = useState(employees[0]?.id || '');
  const [quickPunchMsg, setQuickPunchMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Effects for Theme and Language synchronization
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('hrms_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', language);
    localStorage.setItem('hrms_lang', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('hrms_sidebar_collapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  const handleToggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleToggleLanguage = () => {
    setLanguage(prev => (prev === 'ar' ? 'en' : 'ar'));
  };

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(prev => !prev);
  };

  const refreshAll = () => {
    setCompany(storage.getCompany());
    setBranches(storage.getBranches());
    setDepartments(storage.getDepartments());
    setJobTitles(storage.getJobTitles());
    setShifts(storage.getShifts());
    setEmployees(storage.getEmployees());
    setAttendanceDays(storage.getDailyAttendanceRecords());
    setLeaves(storage.getLeaveRequests());
    setLoans(storage.getLoans());
    setDebts(storage.getDebts());
    setPayrollRuns(storage.getPayrollRuns());
    setAuditLogs(storage.getAuditLogs());
    setSettings(storage.getSettings());
    setSession(storage.getUserSession());
  };

  // Initial calculation check on mount
  useEffect(() => {
    const today = getTodayDateString();
    attendanceService.processDailyAttendance(today);

    // If no payroll run exists for 2026-10, calculate it once as demo seed
    const runs = storage.getPayrollRuns();
    if (!runs.some(r => r.month === '2026-10')) {
      payrollService.calculatePayrollRun('2026-10');
    }

    refreshAll();
  }, []);

  const handleSwitchRole = (role: RoleType) => {
    const newSession = ROLE_SESSIONS[role] || { ...session, role };
    storage.setUserSession(newSession);
    setSession(newSession);

    // Automatically navigate to relevant view on role switch
    if (role === 'employee') {
      setCurrentTab('my_portal');
    } else {
      if (currentTab === 'my_portal') {
        setCurrentTab('dashboard');
      }
    }

    storage.logAction('تبديل صلاحية المستخدم', 'update', 'settings', `تم تبديل دور الجلسة إلى: ${newSession.roleTitleAr}`);
    refreshAll();
  };

  const handleRecordQuickPunch = (type: 'in' | 'out') => {
    if (!quickPunchEmpId) return;
    try {
      attendanceService.recordLivePunch(quickPunchEmpId, type);
      const emp = employees.find(e => e.id === quickPunchEmpId);
      setQuickPunchMsg({
        text: `تم تسجيل حركة ${type === 'in' ? 'الدخول' : 'الانصراف'} بنجاح للموظف ${emp?.fullNameAr}`
      });
      refreshAll();
      setTimeout(() => {
        setQuickPunchMsg(null);
        setIsQuickPunchOpen(false);
      }, 1800);
    } catch (e: any) {
      setQuickPunchMsg({ text: e.message || 'حدث خطأ أثناء التسجيل', isError: true });
    }
  };

  // Role-based filtering of data for views
  let effectiveEmployees = employees;
  let effectiveAttendanceDays = attendanceDays;
  let effectiveLeaves = leaves;

  if (session.role === 'department_manager' && session.departmentId) {
    effectiveEmployees = employees.filter(e => e.departmentId === session.departmentId);
    effectiveAttendanceDays = attendanceDays.filter(a => effectiveEmployees.some(e => e.id === a.employeeId));
    effectiveLeaves = leaves.filter(l => effectiveEmployees.some(e => e.id === l.employeeId));
  }

  const currentEmployee = employees.find(e => e.id === session.employeeId) || employees[0];

  const pendingApprovalsCount =
    effectiveLeaves.filter(l => l.status === 'pending').length +
    payrollRuns.filter(r => r.status === 'calculated').length;

  const currentBranch = branches.find(b => b.id === session.branchId) || branches[0];

  return (
    <div className="flex h-screen bg-slate-100/90 dark:bg-slate-950 text-slate-800 dark:text-slate-100 antialiased overflow-hidden font-['Cairo',sans-serif] transition-colors duration-200">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        pendingApprovalsCount={pendingApprovalsCount}
        session={session}
        onSwitchRole={handleSwitchRole}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        language={language}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header
          currentTab={currentTab}
          currentBranch={currentBranch}
          onQuickPunchClick={() => setIsQuickPunchOpen(true)}
          onZKTecoImportClick={() => setCurrentTab('attendance')}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          language={language}
          onToggleLanguage={handleToggleLanguage}
        />

        {/* Informative Banner when in restricted role */}
        {session.role === 'employee' && (
          <div className="bg-emerald-900 text-emerald-100 text-xs py-1.5 px-6 flex items-center justify-between border-b border-emerald-800/60 shrink-0 no-print">
            <span className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span>أنت الآن في <strong>بوابة الخدمة الذاتية للموظف</strong> ({currentEmployee.fullNameAr}) - يمكنك فقط الاطلاع على بياناتك وقسائمك ودوامك وتقديم إجازاتك.</span>
            </span>
            <span className="text-[11px] bg-emerald-800 px-2 py-0.5 rounded font-mono">Employee View</span>
          </div>
        )}

        {session.role === 'department_manager' && (
          <div className="bg-blue-900 text-blue-100 text-xs py-1.5 px-6 flex items-center justify-between border-b border-blue-800/60 shrink-0 no-print">
            <span className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-400" />
              <span>أنت الآن بصلاحية <strong>مدير قسم تكنولوجيا المعلومات</strong> - يقتصر العرض والموافقات على موظفي قسمك فقط ({effectiveEmployees.length} موظف).</span>
            </span>
            <span className="text-[11px] bg-blue-800 px-2 py-0.5 rounded font-mono">Department View</span>
          </div>
        )}

        {session.role === 'payroll_accountant' && (
          <div className="bg-purple-900 text-purple-100 text-xs py-1.5 px-6 flex items-center justify-between border-b border-purple-800/60 shrink-0 no-print">
            <span className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-purple-400" />
              <span>أنت الآن بصلاحية <strong>المحاسب المالي للرواتب</strong> - التركيز على كشوفات الرواتب الشهرية، الرسوم البيانية، السلف والذمم، وتصدير التقارير المحاسبية.</span>
            </span>
            <span className="text-[11px] bg-purple-800 px-2 py-0.5 rounded font-mono">Payroll Accountant View</span>
          </div>
        )}

        {/* Viewport Content with Scroll */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto">
            {/* EMPLOYEE PORTAL VIEW */}
            {(currentTab === 'my_portal' || session.role === 'employee') && (
              <EmployeePortalView
                employee={currentEmployee}
                attendanceDays={attendanceDays}
                leaves={leaves}
                loans={loans}
                debts={debts}
                payrollRuns={payrollRuns}
                company={company}
                onRefresh={refreshAll}
              />
            )}

            {/* ADMINISTRATIVE & MANAGEMENT VIEWS (Visible when NOT in employee mode) */}
            {session.role !== 'employee' && (
              <>
                {currentTab === 'dashboard' && (
                  <DashboardView
                    employees={effectiveEmployees}
                    attendanceDays={effectiveAttendanceDays}
                    leaves={effectiveLeaves}
                    payrollRuns={payrollRuns}
                    auditLogs={auditLogs}
                    departments={departments}
                    session={session}
                    isDark={theme === 'dark'}
                    language={language}
                    onNavigate={setCurrentTab}
                    onRefreshData={refreshAll}
                  />
                )}

                {currentTab === 'employees' && (
                  <EmployeesView
                    employees={effectiveEmployees}
                    branches={branches}
                    departments={departments}
                    jobTitles={jobTitles}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'attendance' && (
                  <AttendanceView
                    employees={effectiveEmployees}
                    attendanceDays={effectiveAttendanceDays}
                    shifts={shifts}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'payroll' && (
                  <PayrollView
                    payrollRuns={payrollRuns}
                    employees={effectiveEmployees}
                    departments={departments}
                    isDark={theme === 'dark'}
                    language={language}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'leaves' && (
                  <LeavesView
                    leaves={effectiveLeaves}
                    employees={effectiveEmployees}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'loans' && (
                  <LoansView
                    loans={loans}
                    employees={effectiveEmployees}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'approvals' && (
                  <ApprovalsView
                    leaves={effectiveLeaves}
                    employees={effectiveEmployees}
                    payrollRuns={payrollRuns}
                    attendanceDays={effectiveAttendanceDays}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'documents' && (
                  <DocumentsView
                    employees={effectiveEmployees}
                    company={company}
                  />
                )}

                {currentTab === 'reports' && (
                  <ReportsView
                    employees={effectiveEmployees}
                    payrollRuns={payrollRuns}
                    attendanceDays={effectiveAttendanceDays}
                    leaves={effectiveLeaves}
                  />
                )}

                {currentTab === 'organization' && (
                  <OrganizationView
                    company={company}
                    branches={branches}
                    departments={departments}
                    jobTitles={jobTitles}
                    employees={effectiveEmployees}
                    isDark={theme === 'dark'}
                    onRefresh={refreshAll}
                  />
                )}

                {currentTab === 'audit' && (
                  <AuditLogView
                    auditLogs={auditLogs}
                  />
                )}

                {currentTab === 'settings' && (
                  <SettingsView
                    settings={settings}
                    company={company}
                    onRefresh={refreshAll}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Quick Punch Modal from Header */}
      {isQuickPunchOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in no-print">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>تسجيل بصمة حضور سريعة</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsQuickPunchOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 mb-1 font-semibold">الموظف:</label>
                <select
                  value={quickPunchEmpId}
                  onChange={(e) => setQuickPunchEmpId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-semibold text-slate-800 dark:text-slate-100"
                >
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.fullNameAr} ({e.employeeNo} - {e.zktecoId})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => handleRecordQuickPunch('in')}
                  className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <Clock className="w-4 h-4" />
                  <span>دخول (In: 1)</span>
                </button>
                <button
                  onClick={() => handleRecordQuickPunch('out')}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>انصراف (Out: 0)</span>
                </button>
              </div>

              {quickPunchMsg && (
                <div className={`p-3 rounded-xl text-xs font-semibold ${quickPunchMsg.isError ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                  {quickPunchMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
