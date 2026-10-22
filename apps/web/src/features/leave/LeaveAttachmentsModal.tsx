import { Modal } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { LeaveAttachments } from './LeaveAttachments';

type Detail = { status: string; requiresAttachment: boolean };

/** نافذة مرفقات طلب من قائمة الطلبات: التعديل للمالك أثناء الانتظار وللإدارة حتى بعد الاعتماد. */
export const LeaveAttachmentsModal = ({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const detail = useQuery({
    queryKey: ['/leave-requests', requestId, 'detail'],
    queryFn: async () => (await api.get<Detail>(`/leave-requests/${requestId}`)).data,
  });
  const d = detail.data;
  const canEdit =
    !!d && (d.status === 'pending' || (d.status === 'approved' && can('leave.request.manage')));
  return (
    <Modal opened onClose={onClose} title={t('leave.attachments.title')} size="lg">
      {d && (
        <LeaveAttachments
          requestId={requestId}
          canEdit={canEdit}
          requiresAttachment={d.requiresAttachment}
        />
      )}
    </Modal>
  );
};
