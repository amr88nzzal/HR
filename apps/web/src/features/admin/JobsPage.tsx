import {
  ActionIcon,
  Badge,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh, IconReload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { JOB_QUEUES, JOB_STATUSES, type JobRunDto } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { useFormat } from '../../lib/useFormat';

const PAGE_SIZE = 25;
const COLORS: Record<string, string> = {
  queued: 'gray',
  running: 'blue',
  retrying: 'orange',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'gray',
};

const Details = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const one = useQuery({
    queryKey: ['/jobs', 'one', id],
    queryFn: async () =>
      (await api.get<JobRunDto & { payload: unknown; result: unknown }>(`/jobs/${id}`)).data,
  });
  const d = one.data;
  return (
    <Modal opened onClose={onClose} title={d?.jobName ?? ''} size="lg" centered>
      {d && (
        <Stack gap="xs">
          {d.error && (
            <Text c="red" size="sm" dir="auto">
              {d.error}
            </Text>
          )}
          <Text fw={600} size="sm">
            {t('jobsPage.payload')}
          </Text>
          <Code block dir="ltr">
            {JSON.stringify(d.payload, null, 2)}
          </Code>
          <Text fw={600} size="sm">
            {t('jobsPage.result')}
          </Text>
          <Code block dir="ltr">
            {JSON.stringify(d.result, null, 2)}
          </Code>
        </Stack>
      )}
    </Modal>
  );
};

export const JobsPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [queue, setQueue] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const list = useList('/jobs', {
    page,
    pageSize: PAGE_SIZE,
    status: status ?? undefined,
    queue: queue ?? undefined,
  });
  const stats = useQuery({
    queryKey: ['/jobs', 'stats'],
    queryFn: async () => (await api.get<Record<string, number>>('/jobs/stats')).data,
    refetchInterval: 15_000,
  });
  const retry = useMutation({
    mutationFn: async (id: string) => void (await api.post(`/jobs/${id}/retry`, {})),
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('jobsPage.retried') });
      return qc.invalidateQueries({ queryKey: ['/jobs'] });
    },
    onError: () => notifications.show({ color: 'red', message: t('jobsPage.retryFailed') }),
  });

  const rows = (list.data?.data ?? []) as unknown as JobRunDto[];
  const columns: Column<JobRunDto>[] = [
    { key: 'name', header: t('jobsPage.job'), render: (r) => r.jobName, ltr: true },
    { key: 'queue', header: t('jobsPage.queue'), render: (r) => r.queue, ltr: true },
    {
      key: 'status',
      header: t('jobsPage.status'),
      render: (r) => (
        <Badge color={COLORS[r.status]} variant="light">
          {t(`jobsPage.statuses.${r.status}`)}
        </Badge>
      ),
    },
    {
      key: 'attempt',
      header: t('jobsPage.attempt'),
      render: (r) => `${r.attempt}/${r.maxAttempts}`,
    },
    { key: 'created', header: t('jobsPage.created'), render: (r) => fmt.dateTime(r.createdAt) },
    {
      key: 'finished',
      header: t('jobsPage.finished'),
      render: (r) => (r.finishedAt ? fmt.dateTime(r.finishedAt) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'failed' && can('system.job.retry') ? (
          <Tooltip label={t('jobsPage.retry')}>
            <ActionIcon
              variant="subtle"
              loading={retry.isPending}
              aria-label={t('jobsPage.retry')}
              onClick={(e) => {
                e.stopPropagation();
                retry.mutate(r.id);
              }}
            >
              <IconReload size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('jobsPage.title')}</Title>
        <ActionIcon
          variant="light"
          aria-label={t('jobsPage.refresh')}
          onClick={() => void qc.invalidateQueries({ queryKey: ['/jobs'] })}
        >
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>
      <Group gap="xs">
        {JOB_STATUSES.map((s) => (
          <Badge
            key={s}
            color={COLORS[s]}
            variant={status === s ? 'filled' : 'light'}
            size="lg"
            style={{ cursor: 'pointer' }}
            onClick={() => (setStatus(status === s ? null : s), setPage(1))}
          >
            {t(`jobsPage.statuses.${s}`)}: {stats.data?.[s] ?? 0}
          </Badge>
        ))}
        <Text size="xs" c="dimmed">
          {t('jobsPage.last24h')}
        </Text>
      </Group>
      <Group align="flex-end">
        <Select
          label={t('jobsPage.queue')}
          value={queue}
          onChange={(v) => (setQueue(v), setPage(1))}
          clearable
          placeholder={t('table.all')}
          data={JOB_QUEUES.map((q) => ({ value: q, label: q }))}
          w={200}
        />
      </Group>
      <DataTable
        columns={columns}
        rows={rows}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        onRowClick={(r) => setDetail(r.id)}
      />
      {detail && <Details id={detail} onClose={() => setDetail(null)} />}
    </Stack>
  );
};
