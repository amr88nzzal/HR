import React, { useState } from 'react';
import {
  CalendarCheck,
  PlusCircle,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  FileText,
  User,
  X
} from 'lucide-react';
import { LeaveRequest, Employee, LeaveType } from '../../types/hrms';
import { leaveService } from '../../services/leaveService';
import { getWorkingDaysBetween, getTodayDateString } from '../../utils/date';
import { storage } from '../../services/storage';

interface LeavesViewProps {
  leaves: LeaveRequest[];
  employees: Employee[];
  onRefresh: () => void;
}

export const LeavesView: React.FC<LeavesViewProps> = ({
  leaves,
  employees,
  onRefresh
}) => {
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState<string>(getTodayDateString());
  const [endDate, setEndDate] = useState<string>(getTodayDateString());
  const [reason, setReason] = useState<string>('');
  const [attachmentName, setAttachmentName] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  // Rejection modal
  const [rejectingLeaveId, setRejectingLeaveId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const selectedEmp = employees.find(e => e.id === selectedEmpId);
  const settings = storage.getSettings();
  const calculatedDays = getWorkingDaysBetween(startDate, endDate, settings.weekendDays);

  const handleSubmitLeave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      leaveService.submitLeaveRequest({
        employeeId: selectedEmpId,
        leaveType,
        startDate,
        endDate,
        reason,
        attachmentName: attachmentName.trim() || undefined
      });
      setIsSubmitModalOpen(false);
      setReason('');
      onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'حدث خطأ أثناء تقديم الطلب');
    }
  };

  const handleApprove = (leaveId: string) => {
    try {
      leaveService.approveLeaveRequest(leaveId);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingLeaveId || !rejectReason.trim()) return;
    try {
      leaveService.rejectLeaveRequest(rejectingLeaveId, rejectReason);
      setRejectingLeaveId(null);
      setRejectReason('');
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Submit Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-emerald-600" />
            <span>نظام الإجازات وتتبع الأرصدة (قانون العمل الأردني)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            الاستحقاق: 14 يوماً سنوياً (21 يوماً لمن أمضى 5 سنوات في الخدمة)، و14 يوماً مرضية مدفوعة الأجر بالكامل.
          </p>
        </div>

        <button
          onClick={() => {
            setIsSubmitModalOpen(true);
            setFormError('');
          }}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          <span>تقديم طلب إجازة جديد</span>
        </button>
      </div>

      {/* Employees Leave Balances Cards */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
        <h4 className="text-xs font-bold text-slate-800">أرصدة إجازات الموظفين الحالية (المتاحة للاستهلاك)</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {employees.map(emp => (
            <div key={emp.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-center space-y-1">
              <p className="text-xs font-bold text-slate-800 truncate">{emp.fullNameAr}</p>
              <div className="flex items-center justify-center gap-2 text-xs pt-1">
                <div>
                  <span className="text-[10px] text-slate-400 block">سنوية</span>
                  <span className="font-bold text-emerald-700">{emp.annualLeaveBalance} ي</span>
                </div>
                <span className="text-slate-300">|</span>
                <div>
                  <span className="text-[10px] text-slate-400 block">مرضية</span>
                  <span className="font-bold text-blue-700">{emp.sickLeaveBalance} ي</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leave Requests Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800">سجل طلبات الإجازات المقدمة</h4>
          <span className="text-xs text-slate-400 font-mono">إجمالي الطلبات: {leaves.length}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-3 px-4">الموظف</th>
                <th className="py-3 px-4">نوع الإجازة</th>
                <th className="py-3 px-4">الفترة والمدة</th>
                <th className="py-3 px-4">الأيام المحتسبة (بدون الجمعة)</th>
                <th className="py-3 px-4">السبب / المرفق</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {leaves.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    لا توجد طلبات إجازة مسجلة في النظام.
                  </td>
                </tr>
              ) : (
                leaves.map(req => {
                  const emp = employees.find(e => e.id === req.employeeId);
                  const isPending = req.status === 'pending';

                  return (
                    <tr key={req.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900">{emp?.fullNameAr || '-'}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{emp?.employeeNo}</p>
                      </td>
                      <td className="py-3 px-4 font-semibold">
                        {req.leaveType === 'annual' && <span className="text-emerald-800">إجازة سنوية</span>}
                        {req.leaveType === 'sick' && <span className="text-blue-800">إجازة مرضية</span>}
                        {req.leaveType === 'unpaid' && <span className="text-slate-600">بدون راتب</span>}
                        {req.leaveType === 'maternity' && <span className="text-purple-800">إجازة أمومة</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-slate-800 font-semibold">
                          {req.startDate} إلى {req.endDate}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {req.totalDays} أيام عمل
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs">
                        <p className="truncate">{req.reason}</p>
                        {req.attachmentName && (
                          <span className="text-[10px] text-emerald-700 flex items-center gap-1 font-semibold mt-0.5">
                            <FileText className="w-3 h-3" />
                            <span>مرفق: {req.attachmentName}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {req.status === 'approved' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle className="w-3 h-3" />
                            <span>معتمدة</span>
                          </span>
                        )}
                        {req.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" />
                            <span>قيد الانتظار</span>
                          </span>
                        )}
                        {req.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            <XCircle className="w-3 h-3" />
                            <span>مرفوضة</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isPending ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleApprove(req.id)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                              title="اعتماد الإجازة"
                            >
                              اعتماد
                            </button>
                            <button
                              onClick={() => {
                                setRejectingLeaveId(req.id);
                                setRejectReason('');
                              }}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition cursor-pointer"
                              title="رفض الإجازة"
                            >
                              رفض
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {req.reviewedBy ? `بواسطة: ${req.reviewedBy}` : '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SUBMIT LEAVE REQUEST MODAL */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleSubmitLeave}
            className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">تقديم طلب إجازة جديد</h3>
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 font-medium">
                {formError}
              </div>
            )}

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
                      {e.fullNameAr} (سنوية: {e.annualLeaveBalance} ي | مرضية: {e.sickLeaveBalance} ي)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">نوع الإجازة *</label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold"
                >
                  <option value="annual">إجازة سنوية اعتيادية</option>
                  <option value="sick">إجازة مرضية (بتقرير طبي)</option>
                  <option value="unpaid">إجازة بدون راتب</option>
                  <option value="maternity">إجازة أمومة (70 يوماً)</option>
                  <option value="marriage">إجازة زواج</option>
                  <option value="bereavement">إجازة وفاة (عزاء)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">تاريخ البداية *</label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">تاريخ النهاية *</label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              {/* Working days preview */}
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                <span className="text-emerald-900 font-medium">عدد أيام العمل المحتسبة (بدون الجمعة):</span>
                <span className="font-bold text-sm text-emerald-800 font-mono">{calculatedDays} أيام</span>
              </div>

              <div>
                <label className="block text-slate-600 mb-1">سبب الإجازة *</label>
                <textarea
                  rows={2}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="اكتب سبب طلب الإجازة هنا..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">اسم الملف المرفق (اختياري للتقارير الطبية):</label>
                <input
                  type="text"
                  value={attachmentName}
                  onChange={(e) => setAttachmentName(e.target.value)}
                  placeholder="medical_report.pdf"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                إرسال الطلب للاعتماد
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectingLeaveId && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleReject}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-rose-700">رفض طلب الإجازة</h3>
              <button
                type="button"
                onClick={() => setRejectingLeaveId(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <label className="block text-slate-700 font-semibold">
                سبب الرفض (إلزامي لإبلاغ الموظف وتوثيق القرار) *:
              </label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="يرجى ذكر سبب الرفض (مثال: حاجة العمل الماسة خلال هذه الفترة أو تعارض مع إجازة زميل آخر)..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectingLeaveId(null)}
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
