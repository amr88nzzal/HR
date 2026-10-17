import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
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
import { EmployeeSelect } from '../employees/EmployeeSelect';
import type { BalanceRow, LeaveTypeRow } from './types';

type LedgerRow = {
  id: string;
  leaveTypeId: string;
  entryType: string;
  days: string;
  effectiveDate: string;
  expiresOn: string | null;
  reason: string | null;
};

const AdjustModal = ({
  employeeId,
  types,
  onClose,
}: {
  employeeId: string;
  types: LeaveTypeRow[];
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [days, setDays] = useState<number | string>('');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/leave-balances/adjustments', {
          employeeId,
          leaveTypeId: typeId,
          days: Number(days),
          reason,
          ...(expires ? { expiresOn: expires } : {}),
        })
      ).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('table.saved') });
      await qc.invalidateQueries({ queryKey: ['/leave-balances'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const ok = !!typeId && typeof days === 'number' && days !== 0 && !!reason.trim();
  return (
    <Modal opened onClose={onClose} title={t('leave.adjust')} centered>
      <Stack>
        <Select
          label={t('leave.type')}
          required
          data={types.map((x) => ({ value: x.id, label: localName(x, i18n.language) }))}
          value={typeId}
          onChange={setTypeId}
        />
        <NumberInput
          label={t('leave.adjustDays')}
          description={t('leave.adjustHint')}
          required
          allowNegative
          decimalScale={2}
          step={0.5}
          value={days}
          onChange={setDays}
        />
        <TextInput
          label={t('leave.overrideReason')}
          required
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        {typeof days === 'number' && days > 0 && (
          <TextInput
            type="date"
            dir="ltr"
            label={t('leave.expiresOn')}
            value={expires}
            onChange={(e) => setExpires(e.currentTarget.value)}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

/** أرصدة الموظفين ودفتر الحركات والتعديل اليدوي (للموارد البشرية). */
export const BalancesAdminPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [page, setPage] = useState(1);
  const types = useList<LeaveTypeRow>('/leave-types', { pageSize: 200 });
  const name = (id: string) => {
    const ty = types.data?.data.find((x) => x.id === id);
    return ty ? localName(ty, i18n.language) : '—';
  };
  const balances = useQuery({
    queryKey: ['/leave-balances', 'emp', employeeId],
    queryFn: async () =>
      (await api.get<BalanceRow[]>('/leave-balances', { employeeId: employeeId as string })).data,
    enabled: !!employeeId,
  });
  const ledger = useList<LedgerRow>(
    '/leave-balances/ledger',
    { employeeId: employeeId ?? undefined, page, pageSize: 20 },
    !!employeeId,
  );
  const cols: Column<LedgerRow>[] = [
    { key: 'd', header: t('leave.date'), render: (r) => fmt.date(r.effectiveDate) },
    { key: 'type', header: t('leave.type'), render: (r) => name(r.leaveTypeId) },
    {
      key: 'kind',
      header: t('leave.entry'),
      render: (r) => (
        <Badge variant="light">{t(`leave.entries.${r.entryType}`, r.entryType)}</Badge>
      ),
    },
    { key: 'days', header: t('leave.days'), ltr: true, render: (r) => r.days },
    {
      key: 'exp',
      header: t('leave.expiresOn'),
      render: (r) => (r.expiresOn ? fmt.date(r.expiresOn) : '—'),
    },
    { key: 'why', header: t('leave.overrideReason'), render: (r) => r.reason ?? '—' },
  ];
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.leaveBalances')}</Title>
        {can('leave.balance.adjust') && employeeId && (
          <Button onClick={() => setAdjusting(true)}>{t('leave.adjust')}</Button>
        )}
      </Group>
      <EmployeeSelect
        label={t('leave.employee')}
        value={employeeId}
        onChange={(v) => {
          setEmployeeId(v);
          setPage(1);
        }}
      />
      {employeeId && (
        <>
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('leave.type')}</Table.Th>
                <Table.Th>{t('leave.balance')}</Table.Th>
                <Table.Th>{t('leave.openLots')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(balances.data ?? []).map((b) => (
                <Table.Tr key={b.leaveTypeId}>
                  <Table.Td>{name(b.leaveTypeId)}</Table.Td>
                  <Table.Td dir="ltr" ta="start">
                    {b.balance}
                  </Table.Td>
                  <Table.Td>
                    {b.lots.length === 0 ? (
                      '—'
                    ) : (
                      <Text size="xs">
                        {b.lots
                          .map(
                            (l) =>
                              `${l.remaining}${l.expiresOn ? ` (${fmt.date(l.expiresOn)})` : ''}`,
                          )
                          .join(' · ')}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Title order={4}>{t('leave.ledger')}</Title>
          <DataTable
            tableId="leave.balances"
            columns={cols}
            rows={ledger.data?.data ?? []}
            loading={ledger.isLoading}
            page={page}
            pageSize={20}
            total={ledger.data?.meta?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
      {adjusting && employeeId && (
        <AdjustModal
          employeeId={employeeId}
          types={types.data?.data ?? []}
          onClose={() => setAdjusting(false)}
        />
      )}
    </Stack>
  );
};
