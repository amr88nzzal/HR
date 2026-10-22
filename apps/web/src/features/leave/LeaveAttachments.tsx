import { Alert, Button, FileInput, Group, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';

type Attachment = { id: string; name: string; mimeType: string; sizeBytes: number };

export const ACCEPT = 'application/pdf,image/jpeg,image/png';
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * مرفقات طلب الإجازة: قائمة وتنزيل وحذف ورفع (اختيارية دائماً)، مع تنبيه إن كان النوع يتطلب مرفقاً.
 * Leave request attachments: list, download, delete, upload (always optional) with a hint when the type requires one.
 */
export const LeaveAttachments = ({
  requestId,
  canEdit,
  requiresAttachment = false,
}: {
  requestId: string;
  canEdit: boolean;
  requiresAttachment?: boolean;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['/leave-requests', requestId, 'attachments'];
  const [file, setFile] = useState<File | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<Attachment[]>(`/leave-requests/${requestId}/attachments`)).data,
  });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const upload = useMutation({
    mutationFn: async (f: File) =>
      api.upload(`/leave-requests/${requestId}/attachments`, f, { name: f.name }),
    onSuccess: async () => {
      setFile(null);
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`/leave-requests/${requestId}/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: fail,
  });
  const download = async (a: Attachment) => {
    try {
      downloadBlob(
        await api.blob(`/leave-requests/${requestId}/attachments/${a.id}/content`),
        a.name,
      );
    } catch (e) {
      fail(e);
    }
  };
  const rows = list.data ?? [];
  return (
    <Stack gap="xs">
      {requiresAttachment && rows.length === 0 && list.isSuccess && (
        <Alert color="orange">{t('leave.attachments.missing')}</Alert>
      )}
      {rows.length > 0 && (
        <Table withTableBorder>
          <Table.Tbody>
            {rows.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>{a.name}</Table.Td>
                <Table.Td dir="ltr">{kb(a.sizeBytes)}</Table.Td>
                <Table.Td w={1}>
                  <Group gap="xs" wrap="nowrap">
                    <Button size="compact-xs" variant="default" onClick={() => void download(a)}>
                      {t('leave.attachments.download')}
                    </Button>
                    {canEdit && (
                      <Button
                        size="compact-xs"
                        color="red"
                        variant="light"
                        loading={remove.isPending && remove.variables === a.id}
                        onClick={() => remove.mutate(a.id)}
                      >
                        {t('leave.attachments.remove')}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {rows.length === 0 && list.isSuccess && !requiresAttachment && (
        <Text size="sm" c="dimmed">
          {t('leave.attachments.none')}
        </Text>
      )}
      {canEdit && (
        <Group align="flex-end" wrap="nowrap">
          <FileInput
            style={{ flex: 1 }}
            label={t('leave.attachments.add')}
            description={t('leave.attachments.hint')}
            accept={ACCEPT}
            value={file}
            onChange={setFile}
            clearable
          />
          <Button
            disabled={!file}
            loading={upload.isPending}
            onClick={() => file && upload.mutate(file)}
          >
            {t('leave.attachments.upload')}
          </Button>
        </Group>
      )}
    </Stack>
  );
};
