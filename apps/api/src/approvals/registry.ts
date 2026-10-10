import type { Ctx } from '../db/tenant.js';

export type ApprovalOutcome = 'approved' | 'rejected' | 'withdrawn';
export type ApprovalRequestRow = {
  id: string;
  requestType: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  requesterUserId: string;
  payload: Record<string, unknown>;
};

/**
 * نوع طلب تسجّله كل وحدة (إجازات، تصحيح حضور...) في الكود.
 * `onFinal` يُنفَّذ داخل معاملة القرار نفسها عند الموافقة النهائية أو الرفض أو السحب،
 * فإما أن يثبت القرار وأثره معاً أو لا يثبت أيٌّ منهما.
 */
export type ApprovalRequestType = {
  key: string;
  nameAr: string;
  nameEn?: string;
  /** هل يُسمح بتقديمه عبر POST /approvals (للأنواع العامة)؛ الأنواع المرتبطة بوحدة تُقدَّم من وحدتها */
  apiSubmittable?: boolean;
  onFinal?: (ctx: Ctx, request: ApprovalRequestRow, outcome: ApprovalOutcome) => Promise<void>;
};

const types = new Map<string, ApprovalRequestType>();

export const registerApprovalRequestType = (def: ApprovalRequestType): void => {
  types.set(def.key, def);
};
export const getApprovalRequestType = (key: string): ApprovalRequestType | undefined =>
  types.get(key);
export const listApprovalRequestTypes = (): ApprovalRequestType[] => [...types.values()];

// نوع عام للتجربة والاعتماد العام قبل ربط وحدات الأعمال
registerApprovalRequestType({
  key: 'general',
  nameAr: 'طلب عام',
  nameEn: 'General request',
  apiSubmittable: true,
});
