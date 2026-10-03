import React, { useState } from 'react';
import {
  Banknote,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Printer,
  Edit2,
  DollarSign,
  CreditCard,
  Building,
  Receipt,
  PlusCircle,
  X,
  Send,
  Eye
} from 'lucide-react';
import { PayrollRun, Payslip, PayslipLine, Employee, EmployeeDebtInvoice, Department } from '../../types/hrms';
import { payrollService } from '../../services/payrollService';
import { formatMoney } from '../../utils/decimal';
import { storage } from '../../services/storage';
import { FinancialCharts } from '../Dashboard/FinancialCharts';
import { BarChart2 } from 'lucide-react';

interface PayrollViewProps {
  payrollRuns: PayrollRun[];
  employees: Employee[];
  departments?: Department[];
  isDark?: boolean;
  language?: 'ar' | 'en';
  onRefresh: () => void;
}

export const PayrollView: React.FC<PayrollViewProps> = ({
  payrollRuns,
  employees,
  departments = [],
  isDark = false,
  language = 'ar',
  onRefresh
}) => {
  const isEn = language === 'en';
  const [selectedMonth, setSelectedMonth] = useState<string>('2026-10');
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'table' | 'charts'>('table');

  // Manual Override Payslip modal
  const [editingPayslip, setEditingPayslip] = useState<Payslip | null>(null);
  const [overrideLines, setOverrideLines] = useState<PayslipLine[]>([]);
  const [overrideNotes, setOverrideNotes] = useState<string>('');

  // Add Debt Invoice modal
  const [isAddDebtOpen, setIsAddDebtOpen] = useState(false);
  const [debtEmpId, setDebtEmpId] = useState(employees[0]?.id || '');
  const [debtInvoiceNo, setDebtInvoiceNo] = useState(`INV-${Date.now().toString().slice(-4)}`);
  const [debtDescription, setDebtDescription] = useState('فاتورة مشتريات شخصية / تسوية عهدة');
  const [debtAmount, setDebtAmount] = useState<number>(50);

  const currentRun = payrollRuns.find(r => r.month === selectedMonth);

  const handleCalculatePayroll = () => {
    payrollService.calculatePayrollRun(selectedMonth);
    onRefresh();
  };

  const handleApprovePayroll = () => {
    if (!currentRun) return;
    if (confirm(`هل أنت متأكد من اعتماد كشف رواتب شهر ${selectedMonth} رسمياً؟`)) {
      payrollService.approvePayrollRun(currentRun.id);
      onRefresh();
    }
  };

  const handlePayPayroll = () => {
    if (!currentRun) return;
    if (confirm(`هل أنت متأكد من تأكيد صرف كشف رواتب شهر ${selectedMonth} وتحديث السلف والذمم؟`)) {
      payrollService.markAsPaid(currentRun.id);
      onRefresh();
    }
  };

  const handleOpenEditPayslip = (slip: Payslip) => {
    setEditingPayslip(slip);
    setOverrideLines(JSON.parse(JSON.stringify(slip.lines)));
    setOverrideNotes('');
  };

  const handleSavePayslipOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayslip || !currentRun) return;
    if (!overrideNotes.trim()) {
      alert('يرجى كتابة سبب التعديل اليدوي في القسيمة لتوثيقه في سجل التدقيق');
      return;
    }

    payrollService.overridePayslip(currentRun.id, editingPayslip.employeeId, overrideLines, overrideNotes);
    setEditingPayslip(null);
    onRefresh();
  };

  const handleCreateDebt = (e: React.FormEvent) => {
    e.preventDefault();
    const newDebt: EmployeeDebtInvoice = {
      id: 'debt-' + Math.random().toString(36).substring(2, 8),
      employeeId: debtEmpId,
      invoiceNo: debtInvoiceNo,
      description: debtDescription,
      amount: debtAmount,
      date: new Date().toISOString().substring(0, 10),
      isDeducted: false
    };
    const debts = storage.getDebts();
    storage.saveDebts([newDebt, ...debts]);
    storage.logAction('إضافة فاتورة ذمة لموظف', 'create', 'payroll', `إضافة فاتورة ذمة ${debtInvoiceNo} بقيمة ${debtAmount} د.أ`);
    setIsAddDebtOpen(false);
    // Recalculate current month payroll
    payrollService.calculatePayrollRun(selectedMonth);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold text-slate-700">شهر كشف الرواتب:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
          />
          <button
            onClick={handleCalculatePayroll}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <Calculator className="w-4 h-4" />
            <span>{currentRun ? 'إعادة احتساب كشف الرواتب بالكامل' : 'احتساب كشف رواتب الشهر الآن'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddDebtOpen(true)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer no-print"
          >
            <Receipt className="w-4 h-4 text-purple-600" />
            <span>إضافة فاتورة ذمة / عهدة</span>
          </button>

          {currentRun && (
            <>
              <button
                onClick={() => window.print()}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer no-print"
                title="طباعة كشف رواتب الشهر كاملاً"
              >
                <Printer className="w-4 h-4 text-emerald-400" />
                <span>طباعة الكشف</span>
              </button>

              {currentRun.status === 'calculated' && (
                <button
                  onClick={handleApprovePayroll}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer no-print"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>اعتماد الكشف رسمياً</span>
                </button>
              )}

              {currentRun.status === 'approved' && (
                <button
                  onClick={handlePayPayroll}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer no-print"
                >
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                  <span>تأكيد صرف الرواتب وتحديث السلف</span>
                </button>
              )}

              {currentRun.status === 'paid' && (
                <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>تم صرف رواتب هذا الشهر</span>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {currentRun && (
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 no-print">
          <button
            onClick={() => setActiveSubTab('table')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'table'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Banknote className="w-4 h-4 text-emerald-600" />
            <span>كشف الرواتب وقسائم الموظفين ({currentRun.payslips.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('charts')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'charts'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart2 className="w-4 h-4 text-purple-600" />
            <span>الرسوم البيانية والتحليل المالي (Recharts)</span>
          </button>
        </div>
      )}

      {currentRun && activeSubTab === 'charts' && (
        <FinancialCharts
          payrollRun={currentRun}
          departments={departments}
          employees={employees}
          isDark={isDark}
          language={language}
        />
      )}

      {!currentRun ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <Banknote className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">
            لم يتم احتساب كشف رواتب شهر {selectedMonth} بعد
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            انقر على زر "احتساب كشف رواتب الشهر الآن" ليقوم المحرك الذكي باحتساب الراتب الإجمالي أولاً، ثم الاستقطاعات النظامية لإظهار صافي الراتب، يليه استقطاع السلف وفواتير الذمم لاحتساب الصافي المستحق للتسديد.
          </p>
          <button
            onClick={handleCalculatePayroll}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
          >
            بدء احتساب كشف الرواتب
          </button>
        </div>
      ) : activeSubTab === 'table' ? (
        <>
          {/* Executive Totals Cards showing the 5-step breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Step 1: Gross */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 block">1. إجمالي الرواتب والبدلات (Gross)</span>
              <h3 className="text-xl font-bold text-slate-900 mt-2 font-mono">
                {formatMoney(currentRun.totalGross, 3)}
              </h3>
              <p className="text-[10px] text-slate-400 mt-1">الأساسي + السكن + الانتقال + الإضافي</p>
            </div>

            {/* Step 2: Statutory Deductions & Step 3: Net Before Loans */}
            <div className="bg-white p-5 rounded-2xl border border-blue-200 shadow-xs">
              <span className="text-[11px] font-bold text-blue-700 block">3. صافي الرواتب قبل السلف والذمم</span>
              <h3 className="text-xl font-bold text-blue-800 mt-2 font-mono">
                {formatMoney(currentRun.totalNetBeforeLoans, 3)}
              </h3>
              <p className="text-[10px] text-slate-400 mt-1">
                بعد الاستقطاعات النظامية ({formatMoney(currentRun.totalStatutoryDeductions, 3)})
              </p>
            </div>

            {/* Step 4: Loans & Receivables */}
            <div className="bg-white p-5 rounded-2xl border border-purple-200 shadow-xs">
              <span className="text-[11px] font-bold text-purple-700 block">4. إجمالي السلف وفواتير الذمم المستردة</span>
              <h3 className="text-xl font-bold text-purple-800 mt-2 font-mono">
                {formatMoney(currentRun.totalLoansAndDebts, 3)}
              </h3>
              <p className="text-[10px] text-slate-400 mt-1">أقساط السلف + فواتير المشتريات والعهد</p>
            </div>

            {/* Step 5: Final Net Payable */}
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-5 rounded-2xl text-white shadow-md">
              <span className="text-[11px] font-bold text-emerald-100 block">5. الصافي النهائي المستحق للتسديد (Net Payable)</span>
              <h3 className="text-2xl font-bold mt-2 font-mono">
                {formatMoney(currentRun.totalFinalNetPayable, 3)}
              </h3>
              <p className="text-[10px] text-emerald-200 mt-1">
                المبلغ النهائي المحول للبنوك لعدد {currentRun.totalEmployees} موظف
              </p>
            </div>
          </div>

          {/* Payslips Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  كشف رواتب الموظفين لشهر {selectedMonth}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  تسلسل الاحتساب: الإجمالي ⟵ الاستقطاعات النظامية ⟵ الصافي قبل السلف ⟵ استقطاع السلف والذمم ⟵ الصافي المستحق للتسديد
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-3">رقم الموظف</th>
                    <th className="py-3 px-3">اسم الموظف</th>
                    <th className="py-3 px-3">المرجع المحاسبي</th>
                    <th className="py-3 px-3">إجمالي الراتب (Gross)</th>
                    <th className="py-3 px-3">الاستقطاعات النظامية</th>
                    <th className="py-3 px-3 text-blue-800">صافي الراتب قبل السلف</th>
                    <th className="py-3 px-3 text-purple-700">السلف وفواتير الذمم</th>
                    <th className="py-3 px-3 font-bold text-emerald-800">الصافي المستحق للتسديد</th>
                    <th className="py-3 px-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {currentRun.payslips.map(slip => (
                    <tr key={slip.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">{slip.employeeNo}</td>
                      <td className="py-3 px-3">
                        <p className="font-bold text-slate-900">{slip.employeeName}</p>
                        <p className="text-[10px] text-slate-400">{slip.departmentName} • {slip.jobTitle}</p>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-500">{slip.accountingRefNo}</td>
                      <td className="py-3 px-3 font-mono font-semibold text-slate-800">{formatMoney(slip.grossEarnings, 3)}</td>
                      <td className="py-3 px-3 font-mono text-rose-600">{formatMoney(slip.statutoryDeductions, 3)}</td>
                      <td className="py-3 px-3 font-mono font-bold text-blue-700 bg-blue-50/30">
                        {formatMoney(slip.netSalaryBeforeLoans, 3)}
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-purple-700 bg-purple-50/30">
                        {slip.totalDebtsAndLoans > 0 ? (
                          <span>
                            {formatMoney(slip.totalDebtsAndLoans, 3)}
                            {slip.receivablesDeduction > 0 && (
                              <span className="text-[9px] block text-purple-500">منها ذمم: {formatMoney(slip.receivablesDeduction, 3)}</span>
                            )}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-emerald-800 bg-emerald-50/40 text-sm">
                        {formatMoney(slip.finalNetPayable, 3)}
                        {slip.isManualOverride && (
                          <span className="mr-1 text-[9px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-bold">
                            تعديل يدوي
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setSelectedPayslip(slip)}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1"
                            title="عرض قسيمة الراتب المفصلة"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>القسيمة</span>
                          </button>
                          <button
                            onClick={() => handleOpenEditPayslip(slip)}
                            className="p-1 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition cursor-pointer"
                            title="تعديل يدوي موثق لبنود القسيمة"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {/* DETAILED PAYSLIP MODAL (WITH DISTINCT 5-STEP SECTIONAL BREAKDOWN) */}
      {selectedPayslip && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-7 space-y-6 shadow-2xl border border-slate-200 printable-area">
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">شركة النخبة للحلول والتقنية الذكية ذ.م.م</h2>
                <p className="text-xs text-slate-500">المملكة الأردنية الهاشمية - عمان - الشميساني</p>
                <p className="text-xs font-bold text-emerald-800 mt-1">
                  قسيمة الراتب الشهرية الرسمية - لشهر {selectedMonth}
                </p>
              </div>
              <div className="text-left" dir="ltr">
                <span className="text-xs font-bold text-slate-700 block">Elite Smart Solutions LLC</span>
                <span className="text-[11px] text-slate-400 block">Amman, Jordan</span>
                <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 block mt-1">
                  Currency: JOD (د.أ)
                </span>
              </div>
            </div>

            {/* Employee Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="text-slate-400 text-[10px]">اسم الموظف:</span>
                <p className="font-bold text-slate-900">{selectedPayslip.employeeName}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">رقم الموظف:</span>
                <p className="font-bold font-mono text-slate-900">{selectedPayslip.employeeNo}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">الرقم الوطني / الإقامة:</span>
                <p className="font-bold font-mono text-slate-900">{selectedPayslip.nationalId}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">القسم والمسمى:</span>
                <p className="font-semibold text-slate-900">{selectedPayslip.departmentName} - {selectedPayslip.jobTitle}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">اسم البنك:</span>
                <p className="font-semibold text-slate-900">{selectedPayslip.bankName}</p>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 text-[10px]">رقم الآيبان (IBAN):</span>
                <p className="font-mono text-[11px] text-slate-900" dir="ltr">{selectedPayslip.bankIban}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">المرجع المحاسبي:</span>
                <p className="font-mono text-slate-900">{selectedPayslip.accountingRefNo}</p>
              </div>
            </div>

            {/* Progressive Calculation Hierarchy Boxes */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800">بيان تفصيل واحتساب مستحقات الراتب:</h4>

              {/* Step 1: Gross Earnings */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-100 p-2.5 font-bold text-xs text-slate-800 flex justify-between">
                  <span>المرحلة الأولى: إجمالي الراتب والبدلات التعاقدية (Gross Earnings)</span>
                  <span className="font-mono text-slate-900">{formatMoney(selectedPayslip.grossEarnings, 3)}</span>
                </div>
                <div className="p-3 text-xs space-y-1.5 divide-y divide-slate-100">
                  {selectedPayslip.lines.filter(l => l.type === 'earning').map(line => (
                    <div key={line.id} className="flex justify-between items-center pt-1 text-slate-700">
                      <div>
                        <span className="font-semibold">{line.nameAr}</span>
                        <span className="text-[10px] text-slate-400 mr-2">({line.calcExplanation})</span>
                      </div>
                      <span className="font-mono font-bold" dir="ltr">{formatMoney(line.amount, 3)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 2: Statutory Deductions */}
              <div className="border border-rose-200 rounded-xl overflow-hidden">
                <div className="bg-rose-50 p-2.5 font-bold text-xs text-rose-800 flex justify-between">
                  <span>المرحلة الثانية: الاستقطاعات النظامية والإدارية (ضمان، ضريبة، غياب، تأخير)</span>
                  <span className="font-mono text-rose-700">- {formatMoney(selectedPayslip.statutoryDeductions, 3)}</span>
                </div>
                <div className="p-3 text-xs space-y-1.5 divide-y divide-rose-50">
                  {selectedPayslip.lines.filter(l => l.type === 'statutory_deduction').map(line => (
                    <div key={line.id} className="flex justify-between items-center pt-1 text-slate-700">
                      <div>
                        <span className="font-semibold text-rose-700">{line.nameAr}</span>
                        <span className="text-[10px] text-slate-400 mr-2">({line.calcExplanation})</span>
                      </div>
                      <span className="font-mono font-bold text-rose-600" dir="ltr">- {formatMoney(line.amount, 3)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 3: Net Before Loans Banner */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-xs font-bold text-blue-900">
                <span>المرحلة الثالثة: صافي الراتب المستحق (قبل السلف وفواتير الذمم):</span>
                <span className="font-mono text-base text-blue-800">{formatMoney(selectedPayslip.netSalaryBeforeLoans, 3)}</span>
              </div>

              {/* Step 4: Loans and Receivables Deductions */}
              {selectedPayslip.totalDebtsAndLoans > 0 && (
                <div className="border border-purple-200 rounded-xl overflow-hidden">
                  <div className="bg-purple-50 p-2.5 font-bold text-xs text-purple-900 flex justify-between">
                    <span>المرحلة الرابعة: استقطاع أقساط السلف وفواتير الذمم والمشتريات المستردة</span>
                    <span className="font-mono text-purple-800">- {formatMoney(selectedPayslip.totalDebtsAndLoans, 3)}</span>
                  </div>
                  <div className="p-3 text-xs space-y-1.5 divide-y divide-purple-50">
                    {selectedPayslip.lines.filter(l => l.type === 'debt_deduction').map(line => (
                      <div key={line.id} className="flex justify-between items-center pt-1 text-slate-700">
                        <div>
                          <span className="font-semibold text-purple-800">{line.nameAr}</span>
                          <span className="text-[10px] text-slate-400 mr-2">({line.calcExplanation})</span>
                        </div>
                        <span className="font-mono font-bold text-purple-700" dir="ltr">- {formatMoney(line.amount, 3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 5: Final Net Payable */}
              <div className="p-4 bg-slate-900 text-white rounded-xl flex items-center justify-between shadow-md">
                <div>
                  <span className="text-[11px] text-emerald-300 block font-bold">
                    المرحلة الخامسة: الصافي النهائي المستحق للتسديد والتحويل البنكي (Net Payable)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    صافي الراتب المستحق للموظف بعد سداد كافة الالتزامات والسلف وفواتير الذمم
                  </span>
                </div>
                <span className="font-mono text-xl font-bold text-emerald-400" dir="ltr">
                  {formatMoney(selectedPayslip.finalNetPayable, 3)}
                </span>
              </div>
            </div>

            {selectedPayslip.notes && (
              <div className="p-3 bg-purple-50 text-purple-900 rounded-xl text-xs border border-purple-200">
                <strong>ملاحظة التعديل اليدوي الموثق:</strong> {selectedPayslip.notes}
              </div>
            )}

            {/* Print & Close */}
            <div className="flex justify-between items-center pt-3 border-t border-slate-100 no-print">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة القسيمة الرسمية</span>
              </button>
              <button
                onClick={() => setSelectedPayslip(null)}
                className="px-5 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD DEBT INVOICE MODAL */}
      {isAddDebtOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleCreateDebt}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                إضافة فاتورة ذمة / عهدة مستردة على الموظف
              </h3>
              <button
                type="button"
                onClick={() => setIsAddDebtOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              سيتم خصم هذه الفاتورة مباشرة بعد احتساب صافي الراتب في كشف رواتب الشهر الحالي.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">الموظف *</label>
                <select
                  value={debtEmpId}
                  onChange={(e) => setDebtEmpId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold"
                >
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.fullNameAr} ({e.employeeNo})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">رقم الفاتورة / السند *</label>
                  <input
                    type="text"
                    required
                    value={debtInvoiceNo}
                    onChange={(e) => setDebtInvoiceNo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">المبلغ المطلوب خصمه (د.أ) *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={debtAmount}
                    onChange={(e) => setDebtAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono font-bold text-rose-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">بيان الفاتورة / سبب الذمة *</label>
                <textarea
                  rows={2}
                  required
                  value={debtDescription}
                  onChange={(e) => setDebtDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddDebtOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                تسجيل الفاتورة وإدراجها بالخصم
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MANUAL OVERRIDE PAYSLIP MODAL */}
      {editingPayslip && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleSavePayslipOverride}
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                تعديل يدوي موثق لقسيمة راتب: {editingPayslip.employeeName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPayslip(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {overrideLines.map((line, idx) => (
                <div key={line.id} className="flex items-center justify-between gap-3 p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div className="flex-1">
                    <p className="font-bold text-slate-800">{line.nameAr}</p>
                    <span className="text-[10px] text-slate-400">
                      {line.type === 'earning' ? 'استحقاق' : line.type === 'statutory_deduction' ? 'استقطاع نظامي' : 'سلف وذمم'}
                    </span>
                  </div>
                  <div className="w-36">
                    <input
                      type="number"
                      step="0.001"
                      value={line.amount}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        const copy = [...overrideLines];
                        copy[idx].amount = val;
                        copy[idx].isManualOverride = true;
                        setOverrideLines(copy);
                      }}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-xs font-mono font-bold text-left"
                      dir="ltr"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-rose-700">
                سبب التعديل اليدوي (إلزامي للتدقيق والامتثال) *:
              </label>
              <textarea
                rows={3}
                required
                value={overrideNotes}
                onChange={(e) => setOverrideNotes(e.target.value)}
                placeholder="مثال: تم تعديل خصم الغياب نظراً لتقديم إجازة مرضية معتمدة بأثر رجعي..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingPayslip(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                حفظ التعديلات في القسيمة
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
