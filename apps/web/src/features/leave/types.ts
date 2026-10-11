export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';

export const LEAVE_STATUS_COLORS: Record<LeaveStatus, string> = {
  pending: 'blue',
  approved: 'green',
  rejected: 'red',
  withdrawn: 'gray',
  cancelled: 'gray',
};

export type LeaveTypeRow = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isPaid: boolean;
  allowHalfDay: boolean;
  requiresAttachment: boolean;
  color: string | null;
  isActive: boolean;
};

export type LeaveRequestRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeNameAr: string;
  leaveTypeNameEn: string | null;
  startDate: string;
  endDate: string;
  firstDayHalf: boolean;
  lastDayHalf: boolean;
  reason: string | null;
  chargedDays: string;
  status: LeaveStatus;
  approvalRequestId: string | null;
  createdAt: string;
};

export type Preview = {
  days: { date: string; kind: 'work' | 'weekend' | 'holiday'; units: string }[];
  totalDays: string;
  deductsBalance: boolean;
  balance: string | null;
  balanceAfter: string | null;
  sufficient: boolean;
  overlaps: { id: string; startDate: string; endDate: string; status: string }[];
};

export type BalanceRow = {
  leaveTypeId: string;
  balance: string;
  lots: {
    id: string;
    entryType: 'accrual' | 'carry_over' | 'adjustment';
    days: string;
    remaining: string;
    effectiveDate: string;
    expiresOn: string | null;
  }[];
};
