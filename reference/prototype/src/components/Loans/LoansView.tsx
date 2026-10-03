import React, { useState } from 'react';
import {
  CreditCard,
  PlusCircle,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Banknote,
  X
} from 'lucide-react';
import { Loan, Employee } from '../../types/hrms';
import { storage } from '../../services/storage';
import { formatMoney } from '../../utils/decimal';

interface LoansViewProps {
  loans: Loan[];
  employees: Employee[];
  onRefresh: () => void;
}

export const LoansView: React.FC<LoansViewProps> = ({
  loans,
  employees,
  onRefresh
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [amount, setAmount] = useState<number>(300);
  const [monthlyInstallment, setMonthlyInstallment] = useState<number>(50);
  const [installmentsCount, setInstallmentsCount] = useState<number>(6);
  const [startDate, setStartDate] = useState<string>('2026-10');
  const [notes, setNotes] = useState<string>('');

  const handleAddLoan = (e: React.FormEvent) => {
    e.preventDefault();
    const newLoan: Loan = {
      id: 'loan-' + Math.random().toString(36).substring(2, 9),
      employeeId: selectedEmpId,
      amount,
      monthlyInstallment,
      installmentsCount,
      remainingAmount: amount,
      startDate,
      status: 'active',
      notes
    };

    const current = storage.getLoans();
    storage.saveLoans([newLoan, ...current]);

    const emp = employees.find(e => e.id === selectedEmpId);
    storage.logAction(
      'إضافة سلفة موظف',
      'create',
      'payroll',
      `تمت إضافة سلفة مالية بقيمة ${formatMoney(amount, 3)} للموظف ${emp?.fullNameAr} بأقساط شهرية ${formatMoney(monthlyInstallment, 3)}`
    );

    setIsAddModalOpen(false);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            <span>إدارة السلف والقروض المالية للموظفين</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            تُخصم أقساط السلف النشطة تلقائياً في مسير الرواتب الشهري ويتم تحديث الرصيد المتبقي فور تأكيد الصرف.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          <span>إضافة سلفة مالية جديدة</span>
        </button>
      </div>

      {/* Loans Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-3.5 px-4">الموظف</th>
                <th className="py-3.5 px-4">مبلغ السلفة الأصلي</th>
                <th className="py-3.5 px-4">القسط الشهري</th>
                <th className="py-3.5 px-4">الرصيد المتبقي</th>
                <th className="py-3.5 px-4">شهر بدء الخصم</th>
                <th className="py-3.5 px-4">الحالة</th>
                <th className="py-3.5 px-4">الملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    لا توجد سلف مالية مسجلة حالياً.
                  </td>
                </tr>
              ) : (
                loans.map(loan => {
                  const emp = employees.find(e => e.id === loan.employeeId);
                  return (
                    <tr key={loan.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900">{emp?.fullNameAr || '-'}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{emp?.employeeNo}</p>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {formatMoney(loan.amount, 3)}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-rose-600">
                        {formatMoney(loan.monthlyInstallment, 3)}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-blue-700">
                        {formatMoney(loan.remainingAmount, 3)}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {loan.startDate}
                      </td>
                      <td className="py-3 px-4">
                        {loan.status === 'active' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            نشطة (قيد الخصم)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            مكتملة السداد
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {loan.notes || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Loan Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleAddLoan}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">إضافة سلفة مالية جديدة</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">الموظف *</label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold"
                >
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.fullNameAr} (الأساسي: {formatMoney(e.basicSalary, 3)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">مبلغ السلفة الكلي (د.أ) *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={amount}
                    onChange={(e) => {
                      const a = parseFloat(e.target.value) || 0;
                      setAmount(a);
                      setMonthlyInstallment(roundAmount(a / installmentsCount));
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">عدد الأقساط الشهرية *</label>
                  <input
                    type="number"
                    min="1"
                    max="36"
                    required
                    value={installmentsCount}
                    onChange={(e) => {
                      const c = parseInt(e.target.value, 10) || 1;
                      setInstallmentsCount(c);
                      setMonthlyInstallment(roundAmount(amount / c));
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">القسط الشهري المحسوب (د.أ) *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={monthlyInstallment}
                    onChange={(e) => setMonthlyInstallment(parseFloat(e.target.value) || 0)}
                    className="w-full bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-bold text-emerald-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">شهر بدء الخصم *</label>
                  <input
                    type="month"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">السبب / الملاحظات:</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="موافقة الإدارة المالية على السلفة..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                حفظ السلفة
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

function roundAmount(val: number): number {
  return Math.round(val * 1000) / 1000;
}
