import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';
import { useFormat } from '../../lib/useFormat';
import { LeaveRequestModal } from './LeaveRequestModal';
import {
  LEAVE_STATUS_COLORS,
  type BalanceRow,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from './types';

const PAGE_SIZE = 20;

const Balances = () => {
  const { t, i18n } = useTranslation();
  const types = useList<LeaveTypeRow>('/leave-types', { pageSize: 200 });
  const q = useQuery({
    queryKey: ['/leave-balances', 'me'],
    queryFn: async () => (await api.get<BalanceRow[]>('/leave-balances/me')).data,
    retry: false,
  });
  if (q.isError || !q.data) return null;
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }}>
      {q.data.map((b) => {
        const ty = types.data?.data.find((x) => x.id === b.leaveTypeId);
        return (
          <Card key={b.leaveTypeId} withBorder padding="sm">
            <Text size="sm" c="dimmed">
              {ty ? localName(ty, i18n.language) : '—'}
            </Text>
            <Text fz={28} fw={700} dir="ltr" ta="start">
              {b.balance}
            </Text>
            <Text size="xs" c="dimmed">
              {t('leave.daysUnit')}
            </Text>
          </Card>
        );
      })}
    </SimpleGrid>
  );
};

const OverrideModal = ({ row, onClose }: { row: LeaveRequestRow; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [days, setDays] = useState<number | string>(Number(row.chargedDays));
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (await api.post(`/leave-requests/${row.id}/override`, { days: Number(days), reason })).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('table.saved') });
      await qc.invalidateQueries({ queryKey: ['/leave-requests'] });
      await qc.invalidateQueries({ queryKey: ['/leave-balances'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('leave.override')} centered>
      <Stack>
        <NumberInput
          label={t('leave.chargedDays')}
          value={days}
          onChange={setDays}
          min={0}
          max={999.99}
          decimalScale={2}
          step={0.5}
        />
        <TextInput
          label={t('leave.overrideReason')}
          required
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!reason.trim() || typeof days !== 'number'}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const RequestsTable = ({ mode }: { mode: 'me' | 'all' }) => {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [overriding, setOverriding] = useState<LeaveRequestRow | null>(null);
  const list = useList<LeaveRequestRow>(mode === 'me' ? '/leave-requests/me' : '/leave-requests', {
    page,
    pageSize: PAGE_SIZE,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => (await api.post(`/leave-requests/${id}/cancel`, {})).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('leave.cancelled') });
      await qc.invalidateQueries({ queryKey: ['/leave-requests'] });
      await qc.invalidateQueries({ queryKey: ['/leave-balances'] });
      await qc.invalidateQueries({ queryKey: ['/approvals'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirmCancel = (r: LeaveRequestRow) =>
    modals.openConfirmModal({
      title: t('leave.cancelRequest'),
      children: <Text size="sm">{t('leave.cancelConfirm')}</Text>,
      labels: { confirm: t('leave.cancelRequest'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => cancel.mutate(r.id),
    });
  const columns: Column<LeaveRequestRow>[] = [
    ...(mode === 'all'
      ? [
          {
            key: 'emp',
            header: t('leave.employee'),
            render: (r: LeaveRequestRow) => r.employeeName,
          },
        ]
      : []),
    {
      key: 'type',
      header: t('leave.type'),
      render: (r) =>
        localName({ nameAr: r.leaveTypeNameAr, nameEn: r.leaveTypeNameEn }, i18n.language),
    },
    {
      key: 'period',
      header: t('leave.period'),
      render: (r) =>
        r.startDate === r.endDate
          ? fmt.date(r.startDate)
          : `${fmt.date(r.startDate)} → ${fmt.date(r.endDate)}`,
    },
    { key: 'days', header: t('leave.chargedDays'), render: (r) => r.chargedDays },
    {
      key: 'status',
      header: t('leave.status'),
      render: (r) => (
        <Badge color={LEAVE_STATUS_COLORS[r.status]} variant="light">
          {t(`leave.statuses.${r.status}`)}
        </Badge>
      ),
    },
  ];
  const canManage = can('leave.request.manage');
  return (
    <>
      <DataTable
        tableId="leave.mine"
        columns={columns}
        rows={list.data?.data ?? []}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        actions={(r) => {
          const open = r.status === 'pending' || r.status === 'approved';
          if (!open) return null;
          return (
            <Group gap="xs" wrap="nowrap">
              {canManage && (
                <Button size="compact-xs" variant="default" onClick={() => setOverriding(r)}>
                  {t('leave.override')}
                </Button>
              )}
              <Button
                size="compact-xs"
                color="red"
                variant="light"
                onClick={() => confirmCancel(r)}
              >
                {t('leave.cancelRequest')}
              </Button>
            </Group>
          );
        }}
      />
      {overriding && <OverrideModal row={overriding} onClose={() => setOverriding(null)} />}
    </>
  );
};

/** إجازاتي: الأرصدة وطلباتي وطلب جديد، وللإدارة تبويب كل الطلبات. */
export const MyLeavePage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<string | null>('me');
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.myLeave')}</Title>
        {can('leave.request.submit') && (
          <Button onClick={() => setCreating(true)}>{t('leave.newRequest')}</Button>
        )}
      </Group>
      <Balances />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="me">{t('leave.tabs.me')}</Tabs.Tab>
          {can('leave.request.read_all') && <Tabs.Tab value="all">{t('leave.tabs.all')}</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="me">
          <RequestsTable mode="me" />
        </Tabs.Panel>
        <Tabs.Panel value="all">
          <RequestsTable mode="all" />
        </Tabs.Panel>
      </Tabs>
      {creating && <LeaveRequestModal onClose={() => setCreating(false)} />}
    </Stack>
  );
};
