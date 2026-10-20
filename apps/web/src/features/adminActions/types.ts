import type { ActionCategory, ActionStatus } from '@hrms/shared';

/** نوع إجازة إداري كما يعيده الـ API / Admin action type as returned by the API */
export type ActionType = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  category: ActionCategory;
  payrollEffect: 'none' | 'deduction' | 'bonus';
  requiresApproval: boolean;
  requiresAcknowledgment: boolean;
  letterTemplateCode: string | null;
  escalationTypeId: string | null;
  escalationCount: number | null;
  escalationWindowDays: number | null;
  isActive: boolean;
  version: number;
};

/** صف قائمة الإجراءات / Admin action list row */
export type ActionRow = {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  typeId: string;
  typeCode: string;
  typeName: string;
  category: ActionCategory;
  payrollEffect: 'none' | 'deduction' | 'bonus';
  requiresAcknowledgment: boolean;
  letterTemplateCode: string | null;
  status: ActionStatus;
  title: string;
  actionDate: string;
  effectiveDate: string;
  amount: string | null;
  currency: string | null;
  payrollYear: number | null;
  payrollMonth: number | null;
  appliedPeriodId: string | null;
  approvalRequestId: string | null;
  issuedDocumentId: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  version: number;
  description?: string | null;
  cancelReason?: string | null;
  decidedAt?: string | null;
};

export type MyActionRow = {
  id: string;
  typeName: string;
  typeNameEn: string | null;
  category: ActionCategory;
  requiresAcknowledgment: boolean;
  title: string;
  description: string | null;
  actionDate: string;
  effectiveDate: string;
  amount: string | null;
  currency: string | null;
  acknowledgedAt: string | null;
  decidedAt: string | null;
};

export const categoryColor: Record<ActionCategory, string> = {
  notice: 'gray',
  warning: 'orange',
  penalty: 'red',
  reward_cash: 'teal',
  reward_moral: 'cyan',
  commendation: 'green',
  promotion: 'blue',
  other: 'gray',
};

export const statusColor: Record<ActionStatus, string> = {
  draft: 'gray',
  pending: 'yellow',
  approved: 'teal',
  rejected: 'red',
  cancelled: 'gray',
};
