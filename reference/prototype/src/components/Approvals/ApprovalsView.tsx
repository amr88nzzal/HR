import React, { useState } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  Banknote,
  AlertTriangle,
  User,
  X
} from 'lucide-react';
import { LeaveRequest, Employee, PayrollRun, DailyAttendanceRecord } from '../../types/hrms';
import { leaveService } from '../../services/leaveService';
import { payrollService } from '../../services/payrollService';
import { formatMoney } from '../../utils/decimal';

interface ApprovalsViewProps {
  leaves: LeaveRequest[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  attendanceDays: DailyAttendanceRecord[];
  onRefresh: () => void;
}

export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  leaves,
  employees,
  payrollRuns,
  attendanceDays,
  onRefresh
}) => {
  const pendingLeaves = leaves.filter(l => l.status === 'pending');
  const pendingRuns = payrollRuns.filter(r => r.status === 'calculated');
  const incompleteAttendance = attendanceDays.filter(a => a.status === 'incomplete');

  const [rejectModal, setRejectModal] = useState<{ id: string; type: 'leave' | 'payroll'; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleApproveLeave = (id: string) => {
    try {
      leaveService.approveLeaveRequest(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleApprovePayroll = (id: string) => {
    try {
      payrollService.approvePayrollRun(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleConfirmReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModal || !rejectReason.trim()) return;

    if (rejectModal.type === 'leave') {
      leaveService.rejectLeaveRequest(rejectModal.id, rejectReason);
    }
    setRejectModal(null);
    setRejectReason('');
    onRefresh();
  };

  const totalPending = pendingLeaves.length + pendingRuns.length;

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-emerald-600" />
            <span>صندوق الموافقات وسير العمل الموحد</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة واعتماد طلبات الإجازات وكشوف الرواتب الشهرية وتصحيحات الدوام لضمان دورة عمل آمنة وموثقة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-semibold">إجمالي الطلبات المعلقة:</span>
          <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">
            {totalPending} طلب
          </span>
        </div>
      </div>

      {/* SECTION 1: PAYROLL RUNS REQUIRING APPROVAL */}
      {pendingRuns.length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-blue-900 font-bold text-sm border-b border-blue-100 pb-2">
            <Banknote className="w-4 h-4 text-blue-700" />
            <h4>كشوفات الرواتب الشهرية الجاهزة للاعتماد الرسمي</h4>
          </div>

          <div className="space-y-2">
            {pendingRuns.map(run => (
              <div key={run.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-blue-50/50 border border-blue-100">
                <div>
                  <h5 className="font-bold text-xs text-slate-900">{run.titleAr}</h5>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    إجمالي الصافي المستحق للتسديد: <strong className="text-emerald-700">{formatMoney(run.totalFinalNetPayable || run.totalNet, 3)}</strong> • لعدد {run.totalEmployees} موظف
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleApprovePayroll(run.id)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>اعتماد كشف الرواتب</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 2: LEAVE REQUESTS */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <span>طلبات الإجازات المعلقة بانتظار الاعتماد ({pendingLeaves.length})</span>
          </h4>
        </div>

        {pendingLeaves.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            صندوق طلبات الإجازات فارغ حالياً، لا توجد طلبات معلقة.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pendingLeaves.map(leave => {
              const emp = employees.find(e => e.id === leave.employeeId);
              return (
                <div key={leave.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/80 transition">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-sm shrink-0">
                      {emp?.fullNameAr.substring(0, 1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900 text-xs">{emp?.fullNameAr}</p>
                        <span className="text-[10px] text-slate-400 font-mono">({emp?.employeeNo})</span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold">
                          {leave.leaveType === 'annual' ? 'إجازة سنوية' : leave.leaveType === 'sick' ? 'إجازة مرضية' : 'إجازة أخرى'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        الفترة: من <strong className="font-mono text-slate-800">{leave.startDate}</strong> إلى <strong className="font-mono text-slate-800">{leave.endDate}</strong> ({leave.totalDays} أيام عمل)
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        السبب: {leave.reason}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApproveLeave(leave.id)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>موافقة واعتماد</span>
                    </button>
                    <button
                      onClick={() => setRejectModal({ id: leave.id, type: 'leave', name: emp?.fullNameAr || '' })}
                      className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>رفض الطلب</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* REJECTION REASON MODAL */}
      {rejectModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleConfirmReject}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-rose-700">رفض الطلب</h3>
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              يرجى كتابة سبب رفض الطلب الخاص بالموظف <strong>{rejectModal.name}</strong> لإبلاغه رسمياً وتوثيق الإجراء.
            </p>

            <textarea
              rows={3}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="اكتب سبب الرفض هنا..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-rose-500"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                تأكيد الرفض
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
