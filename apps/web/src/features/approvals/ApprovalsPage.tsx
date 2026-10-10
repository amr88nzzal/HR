import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Tabs,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { STATUS_COLORS, type ApprovalRow } from './types';

const PAGE_SIZE = 20;

const NewRequest = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const submit = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ id: string }>('/approvals', {
          requestType: 'general',
          title,
          payload: {
            ...(description ? { description } : {}),
            ...(typeof amount === 'number' ? { amount } : {}),
          },
        })
      ).data,
    onSuccess: async (r) => {
      notifications.show({ color: 'green', message: t('approvals.submitted') });
      await qc.invalidateQueries({ queryKey: ['/approvals'] });
      onClose();
      void navigate({
        to: '/approvals/$approvalId' as never,
        params: { approvalId: r.id } as never,
      });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('approvals.newRequest')} centered>
      <Stack>
        <TextInput
          label={t('approvals.requestTitle')}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
          data-autofocus
        />
        <Textarea
          label={t('approvals.description')}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={2}
        />
        <NumberInput label={t('approvals.amount')} value={amount} onChange={setAmount} min={0} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!title.trim()}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {t('approvals.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const RequestsTable = ({ mode }: { mode: 'inbox' | 'mine' | 'all' }) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const path = mode === 'all' ? '/approvals' : `/approvals/${mode}`;
  const list = useList<ApprovalRow>(path, { page, pageSize: PAGE_SIZE });
  const columns: Column<ApprovalRow>[] = [
    { key: 'title', header: t('approvals.requestTitle'), render: (r) => r.title },
    { key: 'requester', header: t('approvals.requester'), render: (r) => r.requesterName },
    {
      key: 'status',
      header: t('approvals.status'),
      render: (r) => (
        <Badge color={STATUS_COLORS[r.status]} variant="light">
          {t(`approvals.statuses.${r.status}`)}
        </Badge>
      ),
    },
    { key: 'at', header: t('approvals.submittedAt'), render: (r) => fmt.dateTime(r.submittedAt) },
  ];
  return (
    <DataTable
      columns={columns}
      rows={list.data?.data ?? []}
      loading={list.isLoading}
      page={page}
      pageSize={PAGE_SIZE}
      total={list.data?.meta?.total ?? 0}
      onPage={setPage}
      onRowClick={(r) =>
        void navigate({
          to: '/approvals/$approvalId' as never,
          params: { approvalId: r.id } as never,
        })
      }
    />
  );
};

export const ApprovalsPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<string | null>('inbox');
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('approvals.title')}</Title>
        {can('approvals.request.submit') && (
          <Button onClick={() => setCreating(true)}>{t('approvals.newRequest')}</Button>
        )}
      </Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="inbox">{t('approvals.tabs.inbox')}</Tabs.Tab>
          <Tabs.Tab value="mine">{t('approvals.tabs.mine')}</Tabs.Tab>
          {can('approvals.request.read_all') && (
            <Tabs.Tab value="all">{t('approvals.tabs.all')}</Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="inbox">
          <RequestsTable mode="inbox" />
        </Tabs.Panel>
        <Tabs.Panel value="mine">
          <RequestsTable mode="mine" />
        </Tabs.Panel>
        <Tabs.Panel value="all">
          <RequestsTable mode="all" />
        </Tabs.Panel>
      </Tabs>
      {creating && <NewRequest onClose={() => setCreating(false)} />}
    </Stack>
  );
};
