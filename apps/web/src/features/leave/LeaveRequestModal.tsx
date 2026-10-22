import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { ACCEPT } from './LeaveAttachments';
import type { LeaveTypeRow, Preview } from './types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KIND_COLORS = { work: 'blue', weekend: 'gray', holiday: 'orange' } as const;

/** نموذج طلب إجازة بمعاينة حيّة (الأيام الفعلية والرصيد قبل/بعد) من الخادم. */
export const LeaveRequestModal = ({ onClose }: { onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const types = useList<LeaveTypeRow>('/leave-types', { pageSize: 200, isActive: true });
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [firstHalf, setFirstHalf] = useState(false);
  const [lastHalf, setLastHalf] = useState(false);
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const type = types.data?.data.find((x) => x.id === typeId);
  const halfOk = type?.allowHalfDay ?? false;

  const body = {
    ...(employeeId ? { employeeId } : {}),
    leaveTypeId: typeId,
    startDate: start,
    endDate: end,
    firstDayHalf: halfOk && firstHalf,
    lastDayHalf: halfOk && lastHalf,
    reason: reason.trim() || null,
  };
  const ready = !!typeId && ISO.test(start) && ISO.test(end) && end >= start;
  const preview = useQuery({
    queryKey: ['/leave-requests', 'preview', body],
    queryFn: async () => (await api.post<Preview>('/leave-requests/preview', body)).data,
    enabled: ready,
    retry: false,
  });
  const p = ready ? preview.data : undefined;

  const submit = useMutation({
    mutationFn: async () => {
      const created = (await api.post<{ id: string }>('/leave-requests', body)).data;
      // المرفق اختياري؛ فشل رفعه لا يُلغي الطلب (يمكن إرفاقه لاحقاً من «إجازاتي»)
      // The attachment is optional; a failed upload never cancels the request (attach later from My leave)
      if (attachment) {
        try {
          await api.upload(`/leave-requests/${created.id}/attachments`, attachment, {
            name: attachment.name,
          });
        } catch (e) {
          notifications.show({
            color: 'orange',
            message: t('leave.attachments.failed') + errorMessage(e, t),
          });
        }
      }
      return created;
    },
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('leave.submitted') });
      await qc.invalidateQueries({ queryKey: ['/leave-requests'] });
      await qc.invalidateQueries({ queryKey: ['/leave-balances'] });
      await qc.invalidateQueries({ queryKey: ['/approvals'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const blocked = !p || p.overlaps.length > 0 || !p.sufficient;
  return (
    <Modal opened onClose={onClose} title={t('leave.newRequest')} centered size="lg">
      <Stack>
        {can('leave.request.manage') && (
          <EmployeeSelect label={t('leave.onBehalf')} value={employeeId} onChange={setEmployeeId} />
        )}
        <Select
          label={t('leave.type')}
          required
          data={(types.data?.data ?? []).map((x) => ({
            value: x.id,
            label: localName(x, i18n.language),
          }))}
          value={typeId}
          onChange={setTypeId}
        />
        <Group grow align="flex-start">
          <TextInput
            type="date"
            dir="ltr"
            label={t('leave.from')}
            required
            value={start}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setStart(v);
              if (!end || end < v) setEnd(v);
            }}
          />
          <TextInput
            type="date"
            dir="ltr"
            label={t('leave.to')}
            required
            min={start || undefined}
            value={end}
            onChange={(e) => setEnd(e.currentTarget.value)}
          />
        </Group>
        {halfOk && (
          <Group>
            <Switch
              label={t('leave.firstHalf')}
              checked={firstHalf}
              onChange={(e) => setFirstHalf(e.currentTarget.checked)}
            />
            <Switch
              label={t('leave.lastHalf')}
              checked={lastHalf}
              onChange={(e) => setLastHalf(e.currentTarget.checked)}
            />
          </Group>
        )}
        <Textarea
          label={t('leave.reason')}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <FileInput
          label={t('leave.attachments.add')}
          description={
            type?.requiresAttachment
              ? t('leave.attachments.typeNeeds')
              : t('leave.attachments.hint')
          }
          placeholder={t('leave.attachments.pick')}
          accept={ACCEPT}
          value={attachment}
          onChange={setAttachment}
          clearable
        />

        {ready && preview.isError && <Alert color="red">{errorMessage(preview.error, t)}</Alert>}
        {p && (
          <Stack gap="xs" data-testid="leave-preview">
            <Group justify="space-between">
              <Text fw={600}>
                {t('leave.totalDays')}: {p.totalDays}
              </Text>
              {p.deductsBalance ? (
                <Text size="sm">
                  {t('leave.balance')}: {p.balance} → {p.balanceAfter}
                </Text>
              ) : (
                <Badge variant="light" color="gray">
                  {t('leave.unpaidNote')}
                </Badge>
              )}
            </Group>
            <Table.ScrollContainer minWidth={300}>
              <Table withTableBorder>
                <Table.Tbody>
                  {p.days.map((d) => (
                    <Table.Tr key={d.date}>
                      <Table.Td>{fmt.date(d.date)}</Table.Td>
                      <Table.Td>
                        <Badge color={KIND_COLORS[d.kind]} variant="light">
                          {t(`leave.kinds.${d.kind}`)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{d.units}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {!p.sufficient && <Alert color="red">{t('leave.insufficient')}</Alert>}
            {p.overlaps.length > 0 && <Alert color="red">{t('leave.overlap')}</Alert>}
          </Stack>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={blocked} loading={submit.isPending} onClick={() => submit.mutate()}>
            {t('leave.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
