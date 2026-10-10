export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'withdrawn';

export const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending: 'blue',
  approved: 'green',
  rejected: 'red',
  returned: 'orange',
  withdrawn: 'gray',
};

export type ApprovalRow = {
  id: string;
  requestType: string;
  title: string;
  status: ApprovalStatus;
  requesterName: string;
  submittedAt: string;
};

export type ApprovalDetail = ApprovalRow & {
  payload: Record<string, unknown>;
  finalNote: string | null;
  currentPosition: number | null;
  requesterUserId: string;
  steps: { id: string; position: number; nameAr: string; nameEn: string | null }[];
  assignees: {
    id: string;
    position: number;
    userId: string;
    userName: string;
    delegatedFromUserId: string | null;
    status: 'pending' | 'acted' | 'cancelled';
  }[];
  actions: {
    id: string;
    action: 'submit' | 'resubmit' | 'approve' | 'reject' | 'return' | 'withdraw';
    note: string | null;
    createdAt: string;
    actorName: string;
    onBehalfOfUserId: string | null;
  }[];
  canAct: boolean;
  canWithdraw: boolean;
  canResubmit: boolean;
};
