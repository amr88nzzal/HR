import { Alert, Button, FileInput, Group, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';

type Attachment = { id: string; name: string; mimeType: string; sizeBytes: number };

export const LOAN_ACCEPT = 'application/pdf,image/jpeg,image/png';
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** يرفع ملفاً لسلفة/فاتورة موجودة / Uploads a file to an existing loan/invoice. */
export const uploadLoanFile = (loanId: string, f: File) =>
  api.upload(`/payroll/loans/${loanId}/attachments`, f, { name: f.name });

/**
 * مرفقات السلفة/فاتورة الذمم: قائمة وتنزيل وحذف ورفع (اختيارية دائماً)، مع تنبيه إن كان النوع يتطلب مرفقاً.
 * Loan/receivable attachments: list, download, delete, upload (always optional) with a hint when the type requires one.
 */
export const LoanAttachments = ({
  loanId,
  canEdit,
  requiresAttachment = false,
}: {
  loanId: string;
  canEdit: boolean;
  requiresAttachment?: boolean;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['/payroll', 'loan-attachments', loanId];
  const [file, setFile] = useState<File | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<Attachment[]>(`/payroll/loans/${loanId}/attachments`)).data,
  });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ['/payroll', 'loans'] });
    await qc.invalidateQueries({ queryKey: ['/payroll', 'loan', loanId] });
  };
  const upload = useMutation({
    mutationFn: (f: File) => uploadLoanFile(loanId, f),
    onSuccess: async () => {
      setFile(null);
      await refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`/payroll/loans/${loanId}/attachments/${id}`),
    onSuccess: refresh,
    onError: fail,
  });
  const download = async (a: Attachment) => {
    try {
      downloadBlob(await api.blob(`/payroll/loans/${loanId}/attachments/${a.id}/content`), a.name);
    } catch (e) {
      fail(e);
    }
  };
  const rows = list.data ?? [];
  return (
    <Stack gap="xs">
      {requiresAttachment && rows.length === 0 && list.isSuccess && (
        <Alert color="orange">{t('loans.attachments.missing')}</Alert>
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
                      {t('loans.attachments.download')}
                    </Button>
                    {canEdit && (
                      <Button
                        size="compact-xs"
                        color="red"
                        variant="light"
                        loading={remove.isPending && remove.variables === a.id}
                        onClick={() => remove.mutate(a.id)}
                      >
                        {t('loans.attachments.remove')}
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
          {t('loans.attachments.none')}
        </Text>
      )}
      {canEdit && (
        <Group align="flex-end" wrap="nowrap">
          <FileInput
            style={{ flex: 1 }}
            label={t('loans.attachments.add')}
            description={t('loans.attachments.hint')}
            accept={LOAN_ACCEPT}
            value={file}
            onChange={setFile}
            clearable
          />
          <Button
            disabled={!file}
            loading={upload.isPending}
            onClick={() => file && upload.mutate(file)}
          >
            {t('loans.attachments.upload')}
          </Button>
        </Group>
      )}
    </Stack>
  );
};
