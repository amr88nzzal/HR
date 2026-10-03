import React, { useState } from 'react';
import {
  User,
  Clock,
  Banknote,
  CalendarCheck,
  CreditCard,
  FileText,
  Printer,
  Calendar,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Building,
  PlusCircle,
  Eye
} from 'lucide-react';
import { Employee, DailyAttendanceRecord, LeaveRequest, Loan, EmployeeDebtInvoice, PayrollRun, Payslip, Company } from '../../types/hrms';
import { formatMoney } from '../../utils/decimal';
import { formatDateAr, getDayName, getTodayDateString } from '../../utils/date';
import { attendanceService } from '../../services/attendanceService';
import { leaveService } from '../../services/leaveService';
import { storage } from '../../services/storage';

interface EmployeePortalViewProps {
  employee: Employee;
  attendanceDays: DailyAttendanceRecord[];
  leaves: LeaveRequest[];
  loans: Loan[];
  debts: EmployeeDebtInvoice[];
  payrollRuns: PayrollRun[];
  company: Company;
  onRefresh: () => void;
}

export const EmployeePortalView: React.FC<EmployeePortalViewProps> = ({
  employee,
  attendanceDays,
  leaves,
  loans,
  debts,
  payrollRuns,
  company,
  onRefresh
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'attendance' | 'payslips' | 'leaves' | 'loans'>('profile');
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);

  // Leave submission state
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<'annual' | 'sick'>('annual');
  const [startDate, setStartDate] = useState(getTodayDateString());
  const [endDate, setEndDate] = useState(getTodayDateString());
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveError, setLeaveError] = useState('');

  // Live punch message
  const [punchMsg, setPunchMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const myAttendance = attendanceDays.filter(d => d.employeeId === employee.id);
  const myLeaves = leaves.filter(l => l.employeeId === employee.id);
  const myLoans = loans.filter(l => l.employeeId === employee.id);
  const myDebts = debts.filter(d => d.employeeId === employee.id);

  // My payslips from all calculated runs
  const myPayslips = payrollRuns.flatMap(r => r.payslips.filter(p => p.employeeId === employee.id));

  const handleLivePunch = (type: 'in' | 'out') => {
    try {
      attendanceService.recordLivePunch(employee.id, type);
      setPunchMsg({
        text: `تم تسجيل حركة ${type === 'in' ? 'الدخول' : 'الانصراف'} الخاصة بك بنجاح في تمام ${new Date().toLocaleTimeString('ar-JO')}`
      });
      onRefresh();
      setTimeout(() => setPunchMsg(null), 3000);
    } catch (e: any) {
      setPunchMsg({ text: e.message || 'حدث خطأ أثناء التسجيل', isError: true });
    }
  };

  const handleSubmitLeave = (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveError('');
    try {
      leaveService.submitLeaveRequest({
        employeeId: employee.id,
        leaveType,
        startDate,
        endDate,
        reason: leaveReason
      });
      setIsLeaveModalOpen(false);
      setLeaveReason('');
      onRefresh();
    } catch (err: any) {
      setLeaveError(err.message || 'حدث خطأ أثناء تقديم الطلب');
    }
  };

  return (
    <div className="space-y-6">
      {/* Portal Header Greeting */}
      <div className="bg-gradient-to-r from-emerald-800 via-teal-900 to-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 text-white font-bold flex items-center justify-center text-xl border border-white/20 shadow-inner">
            {employee.fullNameAr.substring(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-400/30 font-semibold">
                بوابة الخدمة الذاتية للموظف
              </span>
              <span className="text-xs text-slate-300 font-mono">({employee.employeeNo})</span>
            </div>
            <h1 className="text-xl font-bold mt-1">{employee.fullNameAr}</h1>
            <p className="text-xs text-slate-300">{employee.jobTitleId} • {company.nameAr}</p>
          </div>
        </div>

        {/* Live Punch Simulator for Employee */}
        <div className="bg-white/10 p-3 rounded-xl border border-white/10 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-200 font-medium">تسجيل حضورك اليوم:</span>
            <span className="font-mono text-emerald-300 font-bold">{getTodayDateString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleLivePunch('in')}
              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>تسجيل دخول</span>
            </button>
            <button
              onClick={() => handleLivePunch('out')}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1 border border-white/20"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>تسجيل انصراف</span>
            </button>
          </div>
          {punchMsg && (
            <p className={`text-[11px] font-bold ${punchMsg.isError ? 'text-rose-300' : 'text-emerald-300'}`}>
              {punchMsg.text}
            </p>
          )}
        </div>
      </div>

      {/* Portal Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'profile' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <User className="w-4 h-4" />
          <span>ملفي الوظيفي وبياناتي</span>
        </button>

        <button
          onClick={() => setActiveTab('payslips')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'payslips' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Banknote className="w-4 h-4" />
          <span>كشوفات وقسائم الرواتب الشهرية</span>
        </button>

        <button
          onClick={() => setActiveTab('attendance')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'attendance' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>سجل دوامي وبصماتي</span>
        </button>

        <button
          onClick={() => setActiveTab('leaves')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'leaves' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CalendarCheck className="w-4 h-4" />
          <span>إجازاتي وأرصدتي</span>
        </button>

        <button
          onClick={() => setActiveTab('loans')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'loans' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>سلفي وذمم الالتزامات</span>
        </button>
      </div>

      {/* TAB 1: MY PROFILE */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            المعلومات الشخصية والوظيفية والبنكية
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-400 text-[10px]">الاسم الرباعي:</span>
              <p className="font-bold text-slate-900 mt-0.5">{employee.fullNameAr}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-400 text-[10px]">الرقم الوطني / الإقامة:</span>
              <p className="font-bold font-mono text-slate-900 mt-0.5">{employee.nationalId}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-400 text-[10px]">تاريخ التعيين:</span>
              <p className="font-bold font-mono text-slate-900 mt-0.5">{employee.hireDate}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-slate-400 text-[10px]">معرّف البصمة ZKTeco:</span>
              <p className="font-bold font-mono text-emerald-700 mt-0.5">{employee.zktecoId}</p>
            </div>
          </div>

          {/* Financial details */}
          <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 space-y-2">
            <h4 className="text-xs font-bold text-emerald-950">تفاصيل الراتب والبدلات والحساب البنكي</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
              <div>
                <span className="text-slate-500 text-[10px]">الراتب الأساسي:</span>
                <p className="font-bold text-slate-800">{formatMoney(employee.basicSalary, 3)}</p>
              </div>
              <div>
                <span className="text-slate-500 text-[10px]">بدل سكن:</span>
                <p className="font-semibold text-slate-800">{formatMoney(employee.housingAllowance, 3)}</p>
              </div>
              <div>
                <span className="text-slate-500 text-[10px]">بدل مواصلات:</span>
                <p className="font-semibold text-slate-800">{formatMoney(employee.transportAllowance, 3)}</p>
              </div>
              <div>
                <span className="text-slate-500 text-[10px]">إجمالي الراتب التعاقدي:</span>
                <p className="font-bold text-emerald-800">
                  {formatMoney(
                    employee.basicSalary + employee.housingAllowance + employee.transportAllowance + employee.otherAllowances,
                    3
                  )}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-emerald-200/50 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-600 gap-1">
              <span>البنك المحول إليه: {employee.bankName}</span>
              <span className="font-mono text-[11px] text-slate-800" dir="ltr">IBAN: {employee.bankIban}</span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MY PAYSLIPS (NEW REQUIRED CALCULATION WORKFLOW) */}
      {activeTab === 'payslips' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              كشوفات وقسائم الرواتب الشهرية الصادرة
            </h3>
            <p className="text-xs text-slate-500">
              يتم احتساب الراتب الإجمالي أولاً، ثم الاستقطاعات النظامية لإظهار صافي الراتب، يليه استقطاع السلف وفواتير الذمم للوصول للصافي النهائي المستحق للتسديد.
            </p>
          </div>

          <div className="space-y-3">
            {myPayslips.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
                لا توجد قسائم رواتب صادرة لهذا الحساب حتى الآن.
              </div>
            ) : (
              myPayslips.map(slip => (
                <div key={slip.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h4 className="font-bold text-sm text-slate-900">
                        كشف راتب شهر {slip.payrollRunId.replace('run-', '')}
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        رقم المرجع المحاسبي: {slip.accountingRefNo}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedPayslip(slip)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                    >
                      <Eye className="w-4 h-4" />
                      <span>عرض وطباعة القسيمة الرسمية</span>
                    </button>
                  </div>

                  {/* Progressive Calculation Step-by-Step Display */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                    {/* Step 1: Gross */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 block">1. إجمالي الراتب والبدلات:</span>
                      <p className="font-bold font-mono text-slate-900 text-sm mt-0.5">
                        {formatMoney(slip.grossEarnings, 3)}
                      </p>
                      <span className="text-[10px] text-slate-500 mt-1 block">الأساسي + البدلات</span>
                    </div>

                    {/* Step 2: Statutory Deductions */}
                    <div className="p-3 bg-rose-50/50 rounded-xl border border-rose-100">
                      <span className="text-[10px] text-rose-500 block">2. الاستقطاعات النظامية:</span>
                      <p className="font-bold font-mono text-rose-600 text-sm mt-0.5">
                        {formatMoney(slip.statutoryDeductions || (slip.grossEarnings - slip.netSalaryBeforeLoans), 3)}
                      </p>
                      <span className="text-[10px] text-rose-700 mt-1 block">ضمان (7.5%) + ضريبة + غياب</span>
                    </div>

                    {/* Step 3: Net Before Loans */}
                    <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                      <span className="text-[10px] text-blue-600 block font-semibold">3. صافي الراتب قبل السلف:</span>
                      <p className="font-bold font-mono text-blue-700 text-sm mt-0.5">
                        {formatMoney(slip.netSalaryBeforeLoans, 3)}
                      </p>
                      <span className="text-[10px] text-blue-800 mt-1 block">صافي الراتب المستحق</span>
                    </div>

                    {/* Step 4: Final Net Payable */}
                    <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-xs">
                      <span className="text-[10px] text-emerald-100 block font-semibold">4. الصافي المستحق للتسديد:</span>
                      <p className="font-bold font-mono text-base mt-0.5">
                        {formatMoney(slip.finalNetPayable || slip.netSalary, 3)}
                      </p>
                      <span className="text-[10px] text-emerald-200 mt-1 block">بعد خصم السلف والذمم ({formatMoney(slip.totalDebtsAndLoans, 3)})</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: MY ATTENDANCE */}
      {activeTab === 'attendance' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">سجل حركات الحضور والانصراف</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">التاريخ</th>
                  <th className="py-2.5 px-3">اليوم</th>
                  <th className="py-2.5 px-3">الدخول الأول</th>
                  <th className="py-2.5 px-3">الانصراف الأخير</th>
                  <th className="py-2.5 px-3">التأخير</th>
                  <th className="py-2.5 px-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {myAttendance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      لا توجد سجلات حضور مسجلة لهذا الحساب.
                    </td>
                  </tr>
                ) : (
                  myAttendance.map(att => (
                    <tr key={att.id}>
                      <td className="py-2.5 px-3 font-mono text-slate-800">{att.date}</td>
                      <td className="py-2.5 px-3 font-semibold">{getDayName(att.date)}</td>
                      <td className="py-2.5 px-3 font-mono">{att.firstIn || '-'}</td>
                      <td className="py-2.5 px-3 font-mono">{att.lastOut || '-'}</td>
                      <td className="py-2.5 px-3 font-mono text-rose-600">
                        {att.lateMinutes > 0 ? `${att.lateMinutes} دقيقة` : '-'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {att.status === 'present' ? 'حاضر' : att.status === 'absent' ? 'غياب' : att.status === 'leave' ? 'إجازة' : 'عطلة'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: MY LEAVES */}
      {activeTab === 'leaves' && (
        <div className="space-y-4">
          {/* Leave Balances Cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-center">
              <span className="text-xs text-emerald-800 font-semibold">رصيد الإجازات السنوية المتاح</span>
              <h3 className="text-2xl font-bold text-emerald-900 mt-1">{employee.annualLeaveBalance} يوماً</h3>
            </div>
            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-200 text-center">
              <span className="text-xs text-blue-800 font-semibold">رصيد الإجازات المرضية المتاح</span>
              <h3 className="text-2xl font-bold text-blue-900 mt-1">{employee.sickLeaveBalance} يوماً</h3>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">سجل طلبات الإجازات السابقة</h3>
              <button
                onClick={() => setIsLeaveModalOpen(true)}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>تقديم طلب إجازة</span>
              </button>
            </div>

            <div className="space-y-2">
              {myLeaves.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">لا توجد طلبات إجازة سابقة.</p>
              ) : (
                myLeaves.map(l => (
                  <div key={l.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-slate-900">
                        {l.leaveType === 'annual' ? 'إجازة سنوية' : 'إجازة مرضية'} ({l.totalDays} أيام)
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">من {l.startDate} إلى {l.endDate}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                      {l.status === 'approved' ? 'معتمدة' : l.status === 'pending' ? 'قيد الانتظار' : 'مرفوضة'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: MY LOANS & DEBTS */}
      {activeTab === 'loans' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              السلف المالية وأقساطها الشهرية
            </h3>
            {myLoans.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">لا توجد سلف نشطة مسجلة على حسابك.</p>
            ) : (
              myLoans.map(loan => (
                <div key={loan.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400">سلفة مالية معتمدة:</span>
                    <p className="font-bold text-slate-900">{formatMoney(loan.amount, 3)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">القسط الشهري:</span>
                    <p className="font-bold text-rose-600">{formatMoney(loan.monthlyInstallment, 3)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">الرصيد المتبقي للسداد:</span>
                    <p className="font-bold text-blue-700">{formatMoney(loan.remainingAmount, 3)}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              فواتير الذمم والمشتريات والعهد المستحقة للخصم
            </h3>
            {myDebts.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">لا توجد فواتير ذمم مستحقة عليك.</p>
            ) : (
              myDebts.map(debt => (
                <div key={debt.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-slate-900">{debt.description}</p>
                    <span className="text-[10px] font-mono text-slate-400">رقم الفاتورة: {debt.invoiceNo} • {debt.date}</span>
                  </div>
                  <div className="text-left font-mono font-bold text-rose-600">
                    {formatMoney(debt.amount, 3)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* DETAILED PAYSLIP POPUP */}
      {selectedPayslip && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200 printable-area">
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{company.nameAr}</h3>
                <p className="text-xs text-slate-500">قسيمة الراتب الشهرية الرسمية - {selectedPayslip.payrollRunId.replace('run-', '')}</p>
              </div>
              <button
                onClick={() => setSelectedPayslip(null)}
                className="text-slate-400 hover:text-slate-600 text-xs no-print cursor-pointer"
              >
                إغلاق ✕
              </button>
            </div>

            {/* Calculations Breakdown */}
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 border border-slate-200">
                <div className="flex justify-between font-bold text-slate-800">
                  <span>1. إجمالي الراتب والبدلات التعاقدية (Gross):</span>
                  <span className="font-mono">{formatMoney(selectedPayslip.grossEarnings, 3)}</span>
                </div>
                <div className="flex justify-between text-rose-600">
                  <span>2. الاستقطاعات النظامية (ضمان 7.5% + ضريبة + غياب):</span>
                  <span className="font-mono">- {formatMoney(selectedPayslip.statutoryDeductions || (selectedPayslip.grossEarnings - selectedPayslip.netSalaryBeforeLoans), 3)}</span>
                </div>
                <div className="flex justify-between font-bold text-blue-800 pt-1 border-t border-slate-200">
                  <span>3. صافي الراتب قبل السلف والذمم:</span>
                  <span className="font-mono">{formatMoney(selectedPayslip.netSalaryBeforeLoans, 3)}</span>
                </div>
                <div className="flex justify-between text-purple-700">
                  <span>4. استقطاع السلف وفواتير الذمم:</span>
                  <span className="font-mono">- {formatMoney(selectedPayslip.totalDebtsAndLoans, 3)}</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-800 text-sm pt-1.5 border-t-2 border-slate-800">
                  <span>الصافي النهائي المستحق للتحويل البنكي:</span>
                  <span className="font-mono">{formatMoney(selectedPayslip.finalNetPayable || selectedPayslip.netSalary, 3)}</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-slate-100 font-bold text-slate-700">
                    <tr>
                      <th className="p-2">البند</th>
                      <th className="p-2">التصنيف</th>
                      <th className="p-2 text-left">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedPayslip.lines.map(l => (
                      <tr key={l.id}>
                        <td className="p-2 font-semibold">{l.nameAr}</td>
                        <td className="p-2 text-slate-500">
                          {l.type === 'earning' && 'استحقاق'}
                          {l.type === 'statutory_deduction' && 'استقطاع نظامي'}
                          {l.type === 'debt_deduction' && 'سلف / ذمم'}
                          {l.type === 'employer_contribution' && 'مساهمة شركة'}
                        </td>
                        <td className="p-2 font-mono font-bold text-left" dir="ltr">{formatMoney(l.amount, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-100 no-print">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة القسيمة</span>
              </button>
              <button
                onClick={() => setSelectedPayslip(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
