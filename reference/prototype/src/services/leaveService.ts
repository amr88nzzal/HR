import { LeaveRequest, LeaveType } from '../types/hrms';
import { storage } from './storage';
import { getWorkingDaysBetween } from '../utils/date';
import { attendanceService } from './attendanceService';

export class LeaveService {
  /**
   * Submit a new leave request with balance validation
   */
  submitLeaveRequest(params: {
    employeeId: string;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
    attachmentName?: string;
  }): LeaveRequest {
    const employees = storage.getEmployees();
    const emp = employees.find(e => e.id === params.employeeId);
    if (!emp) throw new Error('الموظف غير موجود');

    const settings = storage.getSettings();
    // Calculate working days excluding weekend (Friday)
    const totalDays = getWorkingDaysBetween(params.startDate, params.endDate, settings.weekendDays);
    if (totalDays <= 0) {
      throw new Error('الفترة المحددة تقع بالكامل ضمن أيام العطلة الأسبوعية أو تاريخ البداية بعد النهاية');
    }

    // Check available balance
    if (params.leaveType === 'annual' && emp.annualLeaveBalance < totalDays) {
      throw new Error(`الرصيد المتاح من الإجازات السنوية (${emp.annualLeaveBalance} يوم) لا يكفي لتغطية مدة الطلب (${totalDays} يوم)`);
    }

    if (params.leaveType === 'sick' && emp.sickLeaveBalance < totalDays) {
      throw new Error(`الرصيد المتاح من الإجازات المرضية (${emp.sickLeaveBalance} يوم) لا يكفي لتغطية مدة الطلب (${totalDays} يوم)`);
    }

    const newRequest: LeaveRequest = {
      id: 'leave-' + Math.random().toString(36).substring(2, 9),
      employeeId: params.employeeId,
      leaveType: params.leaveType,
      startDate: params.startDate,
      endDate: params.endDate,
      totalDays,
      reason: params.reason,
      attachmentName: params.attachmentName,
      status: 'pending',
      submittedAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };

    const leaves = storage.getLeaveRequests();
    storage.saveLeaveRequests([newRequest, ...leaves]);

    storage.logAction(
      'تقديم طلب إجازة',
      'create',
      'leaves',
      `تم تقديم طلب إجازة ${params.leaveType === 'annual' ? 'سنوية' : 'مرضية'} للموظف ${emp.fullNameAr} لمدة ${totalDays} يوم من ${params.startDate} إلى ${params.endDate}`
    );

    return newRequest;
  }

  /**
   * Approve a leave request and deduct balance
   */
  approveLeaveRequest(requestId: string): LeaveRequest {
    const leaves = storage.getLeaveRequests();
    const target = leaves.find(l => l.id === requestId);
    if (!target) throw new Error('طلب الإجازة غير موجود');
    if (target.status !== 'pending') throw new Error('الطلب ليس في حالة قيد الانتظار');

    const employees = storage.getEmployees();
    const emp = employees.find(e => e.id === target.employeeId);
    if (!emp) throw new Error('الموظف غير موجود');

    // Deduct balance
    if (target.leaveType === 'annual') {
      emp.annualLeaveBalance = Math.max(0, emp.annualLeaveBalance - target.totalDays);
    } else if (target.leaveType === 'sick') {
      emp.sickLeaveBalance = Math.max(0, emp.sickLeaveBalance - target.totalDays);
    }
    storage.saveEmployees(employees);

    target.status = 'approved';
    target.reviewedBy = storage.getUserSession().name;
    target.reviewedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    storage.saveLeaveRequests(leaves);

    storage.logAction(
      'اعتماد طلب إجازة',
      'approve',
      'leaves',
      `تمت الموافقة على طلب إجازة الموظف ${emp.fullNameAr} لمدة ${target.totalDays} يوم وخصمها من الرصيد`
    );

    // Update attendance for the days of leave
    let cur = new Date(target.startDate);
    const end = new Date(target.endDate);
    while (cur <= end) {
      const dStr = cur.toISOString().substring(0, 10);
      attendanceService.processDailyAttendance(dStr);
      cur.setDate(cur.getDate() + 1);
    }

    return target;
  }

  /**
   * Reject a leave request
   */
  rejectLeaveRequest(requestId: string, reason: string): LeaveRequest {
    const leaves = storage.getLeaveRequests();
    const target = leaves.find(l => l.id === requestId);
    if (!target) throw new Error('طلب الإجازة غير موجود');

    target.status = 'rejected';
    target.rejectionReason = reason;
    target.reviewedBy = storage.getUserSession().name;
    target.reviewedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    storage.saveLeaveRequests(leaves);

    storage.logAction(
      'رفض طلب إجازة',
      'update',
      'leaves',
      `تم رفض طلب إجازة الموظف. السبب: ${reason}`
    );

    return target;
  }
}

export const leaveService = new LeaveService();
