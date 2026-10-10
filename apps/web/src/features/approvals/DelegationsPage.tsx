import {
  Badge,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Switch,
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
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';

type Delegation = {
  id: string;
  delegatorUserId: string;
  delegatorName: string;
  delegateUserId: string;
  delegateName: string;
  validFrom: string;
  validTo: string;
  requestType: string | null;
  note: string | null;
  isActive: boolean;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export const DelegationsPage = () => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canAll = can('approvals.delegation.manage');
  const [showAll, setShowAll] = useState(false);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [note, setNote] = useState('');

  const users = useQuery({
    queryKey: ['/approval-delegations', 'users'],
    queryFn: async () =>
      (await api.get<{ id: string; displayName: string }[]>('/approval-delegations/users')).data,
  });
  const list = useQuery({
    queryKey: ['/approval-delegations', 'list', showAll],
    queryFn: async () =>
      (await api.get<Delegation[]>('/approval-delegations', showAll ? { all: true } : {})).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['/approval-delegations'] });
  const add = useMutation({
    mutationFn: async () =>
      void (await api.post('/approval-delegations', {
        delegateUserId: delegate,
        validFrom: from,
        validTo: to,
        note: note || null,
      })),
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('delegations.added') });
      setDelegate(null);
      setNote('');
      await refresh();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/approval-delegations/${id}`)),
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('delegations.cancelled') });
      await refresh();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const today = todayIso();
  const live = (d: Delegation) => d.isActive && d.validTo >= today;

  return (
    <Stack>
      <Title order={2}>{t('delegations.title')}</Title>
      <Text size="sm" c="dimmed">
        {t('delegations.hint')}
      </Text>
      <Card withBorder>
        <Group align="flex-end">
          <Select
            label={t('delegations.delegate')}
            value={delegate}
            onChange={setDelegate}
            searchable
            data={(users.data ?? []).map((u) => ({ value: u.id, label: u.displayName }))}
          />
          <TextInput
            type="date"
            label={t('delegations.from')}
            value={from}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
          <TextInput
            type="date"
            label={t('delegations.to')}
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
          <TextInput
            label={t('delegations.note')}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <Button
            disabled={!delegate || !from || !to}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            {t('delegations.add')}
          </Button>
        </Group>
      </Card>
      {canAll && (
        <Switch
          label={t('delegations.showAll')}
          checked={showAll}
          onChange={(e) => setShowAll(e.currentTarget.checked)}
        />
      )}
      <Table.ScrollContainer minWidth={600}>
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('delegations.delegator')}</Table.Th>
              <Table.Th>{t('delegations.delegate')}</Table.Th>
              <Table.Th>{t('delegations.from')}</Table.Th>
              <Table.Th>{t('delegations.to')}</Table.Th>
              <Table.Th />
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(list.data ?? []).map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>{d.delegatorName}</Table.Td>
                <Table.Td>{d.delegateName}</Table.Td>
                <Table.Td>{fmt.date(d.validFrom)}</Table.Td>
                <Table.Td>{fmt.date(d.validTo)}</Table.Td>
                <Table.Td>
                  <Badge color={live(d) ? 'teal' : 'gray'} variant="light">
                    {live(d) ? t('delegations.active') : t('delegations.ended')}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {live(d) && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => cancel.mutate(d.id)}
                    >
                      {t('delegations.cancel')}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {!list.data?.length && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center">
                    {t('delegations.empty')}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
};
