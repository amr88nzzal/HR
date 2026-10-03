import React, { useState } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  CalendarCheck,
  Banknote,
  Clock,
  ArrowUpRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  FileCheck,
  ChevronLeft,
  BarChart2,
  PieChart as PieIcon,
  CreditCard,
  ShieldCheck,
  Receipt
} from 'lucide-react';
import { Employee, DailyAttendanceRecord, LeaveRequest, PayrollRun, AuditLogItem, Department, UserSession } from '../../types/hrms';
import { formatMoney } from '../../utils/decimal';
import { getTodayDateString, formatDateAr } from '../../utils/date';
import { attendanceService } from '../../services/attendanceService';
import { FinancialCharts } from './FinancialCharts';
import { NavTab } from '../Sidebar';

interface DashboardViewProps {
  employees: Employee[];
  attendanceDays: DailyAttendanceRecord[];
  leaves: LeaveRequest[];
  payrollRuns: PayrollRun[];
  auditLogs: AuditLogItem[];
  departments?: Department[];
  session?: UserSession;
  isDark?: boolean;
  language?: 'ar' | 'en';
  onNavigate: (tab: NavTab) => void;
  onRefreshData: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  employees,
  attendanceDays,
  leaves,
  payrollRuns,
  auditLogs,
  departments = [],
  session,
  isDark = false,
  language = 'ar',
  onNavigate,
  onRefreshData
}) => {
  const isEn = language === 'en';
  const todayStr = getTodayDateString();
  const todayAttendance = attendanceDays.filter(d => d.date === todayStr);

  const presentCount = todayAttendance.filter(d => d.status === 'present').length;
  const absentCount = todayAttendance.filter(d => d.status === 'absent').length;
  const leaveCount = todayAttendance.filter(d => d.status === 'leave').length;
  const incompleteCount = todayAttendance.filter(d => d.status === 'incomplete').length;

  const activeEmployeesCount = employees.filter(e => e.status === 'active').length;
  const pendingLeaves = leaves.filter(l => l.status === 'pending');

  const currentMonthRun = payrollRuns.find(r => r.month === '2026-10') || payrollRuns[0];

  const isAccountant = session?.role === 'payroll_accountant';
  const [viewMode, setViewMode] = useState<'standard' | 'financial_analytics'>(
    isAccountant ? 'financial_analytics' : 'standard'
  );

  // Quick punch state
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [punchMsg, setPunchMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const handleQuickPunch = (type: 'in' | 'out') => {
    if (!selectedEmpId) return;
    try {
      attendanceService.recordLivePunch(selectedEmpId, type);
      setPunchMsg({
        text: `تم تسجيل حركة ${type === 'in' ? 'الدخول' : 'الانصراف'} بنجاح للموظف في تمام ${new Date().toLocaleTimeString('ar-JO')}`
      });
      onRefreshData();
      setTimeout(() => setPunchMsg(null), 4000);
    } catch (e: any) {
      setPunchMsg({ text: e.message || 'حدث خطأ أثناء تسجيل البصمة', isError: true });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Welcome & Summary Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-md border border-slate-700/60 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -translate-x-1/2 -translate-y-1/2"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isEn ? 'Jordanian Labor & Social Security Standard (JOD)' : 'نظام العمل والضمان الاجتماعي الأردني مفعل (د.أ - JOD)'}</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              {isAccountant
                ? (isEn ? 'Financial Payroll & Decision Support Dashboard' : 'لوحة تحكم المحاسب المالي للرواتب وصنع القرار')
                : (isEn ? 'HRMS Executive Overview Dashboard' : 'أهلاً بك في نظام شؤون الموظفين المتكامل')}
            </h1>
            <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-2xl">
              {isAccountant
                ? (isEn ? 'Visual breakdown of monthly payroll, statutory social security, tax withholdings, and loan recoveries.' : 'تحليل مرئي لتوزيع الرواتب الشهرية، الاستقطاعات القانونية، واسترداد السلف وفواتير الذمم للمساعدة في اتخاذ القرار.')
                : (isEn ? 'Intelligent automated tracking of staff profiles, ZKTeco biometrics, leaves, and 5-stage payroll runs.' : 'إدارة ذكية ومؤتمتة لملفات الموظفين، سجلات البصمة ZKTeco، الإجازات، وكشوف الرواتب الشهرية بأعلى دقة حسابية.')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onNavigate('payroll')}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs md:text-sm font-semibold shadow-md transition flex items-center gap-2 cursor-pointer"
            >
              <Banknote className="w-4 h-4" />
              <span>{isEn ? 'October 2026 Payroll' : 'كشف رواتب شهر 10-2026'}</span>
            </button>
            <button
              onClick={() => onNavigate('attendance')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs md:text-sm font-semibold border border-slate-700 transition flex items-center gap-2 cursor-pointer"
            >
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>{isEn ? "Today's Attendance" : 'متابعة دوام اليوم'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dashboard Mode Switcher */}
      <div className={`flex flex-wrap items-center justify-between gap-3 p-2 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs`}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('financial_analytics')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              viewMode === 'financial_analytics'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>{isEn ? 'Financial & Recharts Analytics' : 'الرسوم البيانية والتحليل المالي للرواتب'}</span>
            {isAccountant && (
              <span className="bg-emerald-800 text-[10px] text-emerald-100 px-1.5 py-0.2 rounded font-mono">
                Accountant
              </span>
            )}
          </button>

          <button
            onClick={() => setViewMode('standard')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              viewMode === 'standard'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>{isEn ? 'HR Operations & Attendance' : 'مؤشرات العمليات الإدارية والدوام'}</span>
          </button>
        </div>

        <span className="text-xs text-slate-500 dark:text-slate-400 px-2 hidden sm:inline">
          {isEn ? 'Executive decision support dashboard' : 'لوحة دعم القرار والمحاسبة المالية'}
        </span>
      </div>

      {/* RECHARTS FINANCIAL CHARTS VIEW (Specialized for Accountant & Decision Making) */}
      {viewMode === 'financial_analytics' && (
        <FinancialCharts
          payrollRun={currentMonthRun}
          departments={departments}
          employees={employees}
          isDark={isDark}
          language={language}
        />
      )}

      {/* STANDARD HR OPERATIONS VIEW */}
      {viewMode === 'standard' && (
        <>
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Active Employees */}
            <div
              onClick={() => onNavigate('employees')}
              className={`p-5 rounded-2xl border shadow-xs transition cursor-pointer ${
                isDark ? 'bg-slate-800 border-slate-700 hover:border-slate-600' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {isEn ? 'Total Active Employees' : 'إجمالي الموظفين'}
                </span>
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{activeEmployeesCount} {isEn ? 'Employees' : 'موظف'}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                  <span className="text-emerald-600 font-semibold">{isEn ? '100% Active' : '100% نشط'}</span>
                  <span>{isEn ? 'across branches' : 'عبر 3 فروع و 5 أقسام'}</span>
                </p>
              </div>
            </div>

            {/* Card 2: Today's Attendance */}
            <div
              onClick={() => onNavigate('attendance')}
              className={`p-5 rounded-2xl border shadow-xs transition cursor-pointer ${
                isDark ? 'bg-slate-800 border-slate-700 hover:border-slate-600' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {isEn ? "Today's Attendance" : `حضور اليوم (${formatDateAr(todayStr)})`}
                </span>
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{presentCount} {isEn ? 'Present' : 'حاضر'}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
                  <span className="text-rose-600 font-semibold">{absentCount} {isEn ? 'Absent' : 'غياب'}</span>
                  <span>•</span>
                  <span className="text-amber-600 font-semibold">{incompleteCount} {isEn ? 'Missing punch' : 'بصمة ناقصة'}</span>
                </p>
              </div>
            </div>

            {/* Card 3: Pending Leaves */}
            <div
              onClick={() => onNavigate('leaves')}
              className={`p-5 rounded-2xl border shadow-xs transition cursor-pointer ${
                isDark ? 'bg-slate-800 border-slate-700 hover:border-slate-600' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {isEn ? 'Pending Leave Requests' : 'طلبات الإجازات'}
                </span>
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <CalendarCheck className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{pendingLeaves.length} {isEn ? 'Pending' : 'قيد الموافقة'}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                  <span className="text-amber-600 font-semibold">{leaveCount} {isEn ? 'on leave' : 'موظف'}</span>
                  <span>{isEn ? 'approved today' : 'في إجازة رسمية اليوم'}</span>
                </p>
              </div>
            </div>

            {/* Card 4: Current Month Payroll */}
            <div
              onClick={() => onNavigate('payroll')}
              className={`p-5 rounded-2xl border shadow-xs transition cursor-pointer ${
                isDark ? 'bg-slate-800 border-slate-700 hover:border-slate-600' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {isEn ? 'October 2026 Payroll' : 'كشف رواتب شهر 10-2026'}
                </span>
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <Banknote className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {currentMonthRun ? formatMoney(currentMonthRun.totalFinalNetPayable, 3) : (isEn ? 'Pending' : 'قيد الإعداد')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                  <span className="text-purple-600 dark:text-purple-400 font-semibold">
                    {currentMonthRun?.status === 'paid' ? (isEn ? 'Paid out' : 'تم الصرف') : currentMonthRun?.status === 'approved' ? (isEn ? 'Approved' : 'معتمد') : (isEn ? 'Calculated' : 'محسوب جاهز للمراجعة')}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Main Grid: Interactive Attendance Punch + Pending Approvals */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Quick Punch & ZKTeco Integration Card */}
            <div className={`p-5 rounded-2xl border shadow-xs space-y-4 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-emerald-600" />
                  <span>{isEn ? 'Live Attendance Punch Simulator' : 'تسجيل بصمة فورية (محاكاة الجهاز)'}</span>
                </h2>
                <span className="text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-mono">
                  Live Punch
                </span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEn
                  ? 'Simulate check-in / check-out punch instantly to observe real-time calculation of late minutes and hours.'
                  : 'يمكنك محاكاة حركة الدخول أو الانصراف لموظف بشكل فوري لمعاينة كيفية معالجة التأخير والساعات مباشرة.'}
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isEn ? 'Select Employee:' : 'اختر الموظف:'}
                  </label>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs py-2 px-3 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.fullNameAr} ({e.employeeNo} - {e.zktecoId})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    onClick={() => handleQuickPunch('in')}
                    className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Clock className="w-4 h-4" />
                    <span>{isEn ? 'Check-in (In: 1)' : 'تسجيل دخول (In: 1)'}</span>
                  </button>
                  <button
                    onClick={() => handleQuickPunch('out')}
                    className="py-2.5 px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span>{isEn ? 'Check-out (Out: 0)' : 'تسجيل انصراف (Out: 0)'}</span>
                  </button>
                </div>

                {punchMsg && (
                  <div className={`p-3 rounded-xl text-xs font-medium ${punchMsg.isError ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                    {punchMsg.text}
                  </div>
                )}
              </div>

              {/* ZKTeco Format Banner */}
              <div className={`p-3 rounded-xl border text-[11px] space-y-1.5 ${isDark ? 'bg-slate-900/60 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-200/80 text-slate-600'}`}>
                <div className="font-semibold text-slate-800 dark:text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>تنسيق بصمة ZKTeco المعتمد:</span>
                </div>
                <div className="bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-700 dark:text-slate-300 overflow-x-auto text-left" dir="ltr">
                  Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ
                </div>
                <button
                  onClick={() => onNavigate('attendance')}
                  className="text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1 pt-1"
                >
                  <span>{isEn ? 'Open ZKTeco Import Wizard' : 'فتح معالج استيراد ملفات البصمة'}</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Center & Right Column: Pending Approvals & Activity Feed */}
            <div className="lg:col-span-2 space-y-6">
              {/* Pending Leaves Box */}
              <div className={`p-5 rounded-2xl border shadow-xs ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between border-b pb-3 mb-4 border-slate-100 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-amber-500" />
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                      {isEn ? 'Pending Leave Requests Awaiting Review' : 'طلبات الإجازات المعلقة بانتظار الاعتماد'}
                    </h2>
                    <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-bold">
                      {pendingLeaves.length}
                    </span>
                  </div>
                  <button
                    onClick={() => onNavigate('leaves')}
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                  >
                    <span>{isEn ? 'View all' : 'عرض الكل'}</span>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>

                {pendingLeaves.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    {isEn ? 'No pending leave requests at this time.' : 'لا توجد طلبات إجازة معلقة حالياً، جميع الطلبات تمت مراجعتها.'}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {pendingLeaves.slice(0, 3).map(req => {
                      const emp = employees.find(e => e.id === req.employeeId);
                      return (
                        <div
                          key={req.id}
                          className={`flex items-center justify-between p-3 rounded-xl border transition ${
                            isDark ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-100 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                              {emp?.fullNameAr?.substring(0, 1) || 'م'}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-800 dark:text-white">{emp?.fullNameAr}</p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                إجازة {req.leaveType === 'annual' ? 'سنوية' : 'مرضية'} لمدة {req.totalDays} أيام ({req.startDate} إلى {req.endDate})
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => onNavigate('approvals')}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            {isEn ? 'Review' : 'مراجعة'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Audit Log Preview */}
              <div className={`p-5 rounded-2xl border shadow-xs ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between border-b pb-3 mb-4 border-slate-100 dark:border-slate-700">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                    {isEn ? 'Recent Operations & Financial Audit Trail' : 'آخر الحركات الإدارية والمالية (سجل التدقيق)'}
                  </h2>
                  <button
                    onClick={() => onNavigate('audit')}
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                  >
                    <span>{isEn ? 'Full Log' : 'السجل الكامل'}</span>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {auditLogs.slice(0, 4).map(item => (
                    <div key={item.id} className="flex items-start gap-3 text-xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{item.action}</p>
                        <p className="text-slate-500 dark:text-slate-400 text-[11px]">{item.description}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0 font-mono" dir="ltr">
                        {item.timestamp.substring(11, 16)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
