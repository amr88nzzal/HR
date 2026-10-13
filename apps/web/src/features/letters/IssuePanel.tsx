import { Alert, Button, Group, Select, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import type { IssuedRow, TemplateRow } from './types';

const PAGE_SIZE = 20;

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

/** سجل الوثائق الصادرة مع إصدار وثيقة جديدة؛ بتثبيت موظف (بطاقته) أو بلا تثبيت (السجل العام). */
export const IssuePanel = ({ employeeId }: { employeeId?: string }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [tpl, setTpl] = useState<string | null>(null);
  const [emp, setEmp] = useState<string | null>(employeeId ?? null);
  const canIssue = can('letters.document.issue');
  const templates = useQuery({
    queryKey: ['/letter-templates', 'issuable'],
    queryFn: async () => (await api.get<TemplateRow[]>('/letter-templates')).data,
    enabled: canIssue && can('letters.template.read'),
    retry: false,
  });
  const list = useQuery({
    queryKey: ['/issued-documents', employeeId ?? 'all', page],
    queryFn: async () => {
      const r = await api.get<IssuedRow[]>('/issued-documents', {
        employeeId,
        page,
        pageSize: PAGE_SIZE,
      });
      return { rows: r.data, total: (r.meta as { total?: number } | undefined)?.total ?? 0 };
    },
    retry: false,
  });
  const issue = useMutation({
    mutationFn: async () =>
      api.post('/issued-documents', { templateId: tpl, employeeId: employeeId ?? emp }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('letters.issued') });
      await qc.invalidateQueries({ queryKey: ['/issued-documents'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const download = async (r: IssuedRow) => {
    try {
      saveBlob(await api.blob(`/issued-documents/${r.id}/content`), `${r.title}.pdf`);
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  const columns: Column<IssuedRow>[] = [
    ...(employeeId
      ? []
      : [
          {
            key: 'emp',
            header: t('attendance.employee'),
            render: (r: IssuedRow) => r.employeeName,
          },
        ]),
    { key: 'title', header: t('letters.docTitle'), render: (r) => r.title },
    {
      key: 'ver',
      header: t('letters.version'),
      render: (r) => `v${r.templateVersionNo}`,
      ltr: true,
    },
    { key: 'date', header: t('attendance.date'), render: (r) => fmt.date(r.createdAt), ltr: true },
  ];
  return (
    <Stack>
      {canIssue && (
        <Group align="flex-end">
          <Select
            label={t('letters.template')}
            w={300}
            searchable
            value={tpl}
            onChange={setTpl}
            data={(templates.data ?? [])
              .filter((x) => x.isActive && x.activeVersionId)
              .map((x) => ({ value: x.id, label: `${x.nameAr} (${x.language})` }))}
          />
          {!employeeId && (
            <EmployeeSelect label={t('attendance.employee')} value={emp} onChange={setEmp} />
          )}
          <Button
            disabled={!tpl || !(employeeId ?? emp)}
            loading={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {t('letters.issue')}
          </Button>
        </Group>
      )}
      {list.isError && <Alert color="red">{errorMessage(list.error, t)}</Alert>}
      <DataTable
        columns={columns}
        rows={list.data?.rows ?? []}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.total ?? 0}
        onPage={setPage}
        actions={(r) => (
          <Button size="xs" variant="subtle" onClick={() => void download(r)}>
            {t('letters.download')}
          </Button>
        )}
      />
    </Stack>
  );
};
