import React, { useState } from 'react';
import {
  BarChart3,
  Download,
  Printer,
  FileSpreadsheet,
  Banknote,
  Clock,
  ShieldCheck,
  CalendarCheck
} from 'lucide-react';
import { Employee, PayrollRun, DailyAttendanceRecord, LeaveRequest } from '../../types/hrms';
import { formatMoney } from '../../utils/decimal';

interface ReportsViewProps {
  employees: Employee[];
  payrollRuns: PayrollRun[];
  attendanceDays: DailyAttendanceRecord[];
  leaves: LeaveRequest[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  employees,
  payrollRuns,
  attendanceDays,
  leaves
}) => {
  const [activeReport, setActiveReport] = useState<'payroll' | 'attendance' | 'social_security' | 'leaves'>('payroll');
  const [selectedMonth, setSelectedMonth] = useState('2026-10');

  const currentRun = payrollRuns.find(r => r.month === selectedMonth);

  // CSV Export utility
  const handleExportCSV = () => {
    let csvContent = '';
    let filename = `report_${activeReport}_${selectedMonth}.csv`;

    if (activeReport === 'payroll') {
      const headers = ['رقم_الموظف', 'الاسم', 'المرجع_المحاسبي', 'الرقم_الوطني', 'الأساسي', 'إجمالي_الراتب_Gross', 'الاستقطاعات_النظامية', 'الصافي_قبل_السلف', 'السلف_وفواتير_الذمم', 'الصافي_المستحق_للتسديد', 'الآيبان'];
      const rows = (currentRun?.payslips || []).map(p => {
        return [
          p.employeeNo,
          `"${p.employeeName}"`,
          p.accountingRefNo,
          p.nationalId,
          p.basicSalary,
          p.grossEarnings,
          p.statutoryDeductions,
          p.netSalaryBeforeLoans,
          p.totalDebtsAndLoans,
          p.finalNetPayable,
          p.bankIban
        ].join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    } else if (activeReport === 'social_security') {
      const headers = ['رقم_الموظف', 'الاسم', 'الرقم_الوطني', 'الراتب_الخاضع', 'حصة_الموظف_7.5%', 'حصة_المنشأة_14.25%', 'إجمالي_الاشتراك'];
      const rows = (currentRun?.payslips || []).map(p => {
        const empSS = p.lines.find(l => l.code === 'DED_SS_EMP')?.amount || 0;
        const compSS = p.lines.find(l => l.code === 'COMP_SS_SHARE')?.amount || 0;
        return [
          p.employeeNo,
          `"${p.employeeName}"`,
          p.nationalId,
          p.grossEarnings,
          empSS,
          compSS,
          empSS + compSS
        ].join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    } else if (activeReport === 'leaves') {
      const headers = ['رقم_الموظف', 'الاسم', 'رصيد_سنوي_متاح', 'رصيد_مرضي_متاح'];
      const rows = employees.map(e => [
        e.employeeNo,
        `"${e.fullNameAr}"`,
        e.annualLeaveBalance,
        e.sickLeaveBalance
      ].join(','));
      csvContent = [headers.join(','), ...rows].join('\n');
    } else {
      const headers = ['رقم_الموظف', 'الاسم', 'أيام_الغياب', 'دقائق_التأخير', 'ساعات_الإضافي'];
      const rows = employees.map(e => {
        const empDays = attendanceDays.filter(a => a.employeeId === e.id && a.date.startsWith(selectedMonth));
        const absents = empDays.filter(a => a.status === 'absent').length;
        const lates = empDays.reduce((acc, cur) => acc + (cur.lateMinutes || 0), 0);
        const overtimes = empDays.reduce((acc, cur) => acc + (cur.overtimeMinutes || 0), 0);
        return [
          e.employeeNo,
          `"${e.fullNameAr}"`,
          absents,
          lates,
          Math.round((overtimes / 60) * 10) / 10
        ].join(',');
      });
      csvContent = [headers.join(','), ...rows].join('\n');
    }

    // Prepend UTF-8 BOM so Excel opens Arabic correctly
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Report Selection Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs no-print">
        <div className="flex flex-wrap items-center gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveReport('payroll')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeReport === 'payroll' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Banknote className="w-3.5 h-3.5 text-emerald-600" />
            <span>كشف الرواتب الشهرية المعتمد</span>
          </button>
          <button
            onClick={() => setActiveReport('social_security')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeReport === 'social_security' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>اشتراكات الضمان الاجتماعي الأردني</span>
          </button>
          <button
            onClick={() => setActiveReport('attendance')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeReport === 'attendance' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>تقرير الغياب والتأخيرات</span>
          </button>
          <button
            onClick={() => setActiveReport('leaves')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeReport === 'leaves' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarCheck className="w-3.5 h-3.5 text-purple-600" />
            <span>أرصدة الإجازات</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-800"
          />
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تصدير Excel / CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>طباعة</span>
          </button>
        </div>
      </div>

      {/* Report Data Display */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs p-6 space-y-4 printable-area">
        <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {activeReport === 'payroll' && `كشف الرواتب الشهرية - شهر ${selectedMonth}`}
              {activeReport === 'social_security' && `تقرير اشتراكات الضمان الاجتماعي الأردني - شهر ${selectedMonth}`}
              {activeReport === 'attendance' && `تقرير الحضور والانصراف والغياب لشهر ${selectedMonth}`}
              {activeReport === 'leaves' && 'كشف أرصدة الإجازات السنوية والمرضية لجميع الموظفين'}
            </h3>
            <p className="text-xs text-slate-500">شركة النخبة للتقنية - الأردن • العملة: دينار أردني (JOD)</p>
          </div>
        </div>

        {/* PAYROLL REPORT TABLE */}
        {activeReport === 'payroll' && (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">رقم الموظف</th>
                  <th className="py-2.5 px-3">اسم الموظف</th>
                  <th className="py-2.5 px-3">المرجع المحاسبي</th>
                  <th className="py-2.5 px-3">الإجمالي (Gross)</th>
                  <th className="py-2.5 px-3 text-rose-600">الاستقطاعات النظامية</th>
                  <th className="py-2.5 px-3 text-blue-700">الصافي قبل السلف والذمم</th>
                  <th className="py-2.5 px-3 text-purple-700">السلف والذمم المستردة</th>
                  <th className="py-2.5 px-3 text-emerald-800">الصافي النهائي المستحق للتسديد</th>
                  <th className="py-2.5 px-3">الآيبان البنكي (IBAN)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(currentRun?.payslips || []).map(p => {
                  return (
                    <tr key={p.id}>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{p.employeeNo}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{p.employeeName}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">{p.accountingRefNo}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">{formatMoney(p.grossEarnings, 3)}</td>
                      <td className="py-2.5 px-3 font-mono text-rose-600">{formatMoney(p.statutoryDeductions, 3)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700 bg-blue-50/20">{formatMoney(p.netSalaryBeforeLoans, 3)}</td>
                      <td className="py-2.5 px-3 font-mono text-purple-700 bg-purple-50/20">{formatMoney(p.totalDebtsAndLoans, 3)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-800 bg-emerald-50/30 text-sm">{formatMoney(p.finalNetPayable, 3)}</td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500" dir="ltr">{p.bankIban}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300">
                <tr>
                  <td colSpan={3} className="py-3 px-3 text-left">الإجمالي العام لكشف الرواتب:</td>
                  <td className="py-3 px-3 font-mono">{currentRun ? formatMoney(currentRun.totalGross, 3) : '-'}</td>
                  <td className="py-3 px-3 font-mono text-rose-600">{currentRun ? formatMoney(currentRun.totalStatutoryDeductions, 3) : '-'}</td>
                  <td className="py-3 px-3 font-mono text-blue-800">{currentRun ? formatMoney(currentRun.totalNetBeforeLoans, 3) : '-'}</td>
                  <td className="py-3 px-3 font-mono text-purple-800">{currentRun ? formatMoney(currentRun.totalLoansAndDebts, 3) : '-'}</td>
                  <td className="py-3 px-3 font-mono text-emerald-800 text-sm font-bold">
                    {currentRun ? formatMoney(currentRun.totalFinalNetPayable, 3) : '-'}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* SOCIAL SECURITY REPORT TABLE */}
        {activeReport === 'social_security' && (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">رقم الموظف</th>
                  <th className="py-2.5 px-3">اسم الموظف</th>
                  <th className="py-2.5 px-3">الرقم الوطني</th>
                  <th className="py-2.5 px-3">الأجر الخاضع للضمان</th>
                  <th className="py-2.5 px-3">اقتطاع الموظف (7.5%)</th>
                  <th className="py-2.5 px-3">مساهمة المنشأة (14.25%)</th>
                  <th className="py-2.5 px-3">إجمالي التوريد الشهري (21.75%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(currentRun?.payslips || []).map(p => {
                  const empSS = p.lines.find(l => l.code === 'DED_SS_EMP')?.amount || 0;
                  const compSS = p.lines.find(l => l.code === 'COMP_SS_SHARE')?.amount || 0;
                  const totalSS = empSS + compSS;
                  return (
                    <tr key={p.id}>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{p.employeeNo}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{p.employeeName}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{p.nationalId}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{formatMoney(p.grossEarnings, 3)}</td>
                      <td className="py-2.5 px-3 font-mono text-rose-600">{formatMoney(empSS, 3)}</td>
                      <td className="py-2.5 px-3 font-mono text-blue-700">{formatMoney(compSS, 3)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-800">{formatMoney(totalSS, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* LEAVES REPORT TABLE */}
        {activeReport === 'leaves' && (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">رقم الموظف</th>
                  <th className="py-2.5 px-3">اسم الموظف</th>
                  <th className="py-2.5 px-3">تاريخ التعيين</th>
                  <th className="py-2.5 px-3">رصيد الإجازات السنوية المتاح</th>
                  <th className="py-2.5 px-3">رصيد الإجازات المرضية المتاح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map(e => (
                  <tr key={e.id}>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{e.employeeNo}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{e.fullNameAr}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{e.hireDate}</td>
                    <td className="py-2.5 px-3 font-bold text-emerald-700">{e.annualLeaveBalance} يوماً</td>
                    <td className="py-2.5 px-3 font-bold text-blue-700">{e.sickLeaveBalance} يوماً</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ATTENDANCE REPORT TABLE */}
        {activeReport === 'attendance' && (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">رقم الموظف</th>
                  <th className="py-2.5 px-3">اسم الموظف</th>
                  <th className="py-2.5 px-3">أيام الغياب بدون عذر</th>
                  <th className="py-2.5 px-3">إجمالي دقائق التأخير الصباحي</th>
                  <th className="py-2.5 px-3">ساعات العمل الإضافي المعتمدة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map(e => {
                  const empDays = attendanceDays.filter(a => a.employeeId === e.id && a.date.startsWith(selectedMonth));
                  const absents = empDays.filter(a => a.status === 'absent').length;
                  const lates = empDays.reduce((acc, cur) => acc + (cur.lateMinutes || 0), 0);
                  const overtimes = empDays.reduce((acc, cur) => acc + (cur.overtimeMinutes || 0), 0);
                  return (
                    <tr key={e.id}>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{e.employeeNo}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{e.fullNameAr}</td>
                      <td className="py-2.5 px-3 font-bold text-rose-600">{absents} أيام</td>
                      <td className="py-2.5 px-3 font-mono text-amber-700">{lates} دقيقة</td>
                      <td className="py-2.5 px-3 font-bold text-emerald-700">{Math.round((overtimes / 60) * 10) / 10} ساعة</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
