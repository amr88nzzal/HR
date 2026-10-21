import {
  Badge,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Table,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useLookup } from '../employees/shared';
import { FormModal } from './crud';
import type { Group as PayGroup, Period } from './runs-types';

export const statusColor = { draft: 'gray', approved: 'blue', locked: 'teal' } as const;

/** دورات الرواتب: شهر × مجموعة دفع × عملة. */
export const PeriodsPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['/payroll', 'periods'],
    queryFn: async () => (await api.get<Period[]>('/payroll/periods')).data,
  });
  const groups = useQuery({
    queryKey: ['/payroll', 'groups'],
    queryFn: async () => (await api.get<PayGroup[]>('/payroll/groups')).data,
    enabled: can('payroll.group.read'),
  });
  const currencies = useLookup('/currencies', 'system.currency.read');
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    currency: '',
    payGroupId: '',
  });
  const create = useMutation({
    mutationFn: async () =>
      api.post('/payroll/periods', {
        year: v.year,
        month: v.month,
        currency: v.currency,
        payGroupId: v.payGroupId || null,
      }),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['/payroll', 'periods'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const codes = currencies.rows.map((r) => String(r['code']));
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.payrollPeriods')}</Title>
        {can('payroll.period.create') && (
          <Button
            onClick={() => {
              setV((p) => ({ ...p, currency: p.currency || codes[0] || '' }));
              setOpen(true);
            }}
          >
            {t('payroll.run.newPeriod')}
          </Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.run.month')}</Table.Th>
            <Table.Th>{t('payroll.run.group')}</Table.Th>
            <Table.Th>{t('payroll.run.currency')}</Table.Th>
            <Table.Th>{t('payroll.run.status')}</Table.Th>
            <Table.Th>{t('payroll.run.employees')}</Table.Th>
            <Table.Th>{t('payroll.run.net')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td dir="ltr">{`${p.year}-${String(p.month).padStart(2, '0')}`}</Table.Td>
              <Table.Td>{p.groupName}</Table.Td>
              <Table.Td dir="ltr">{p.currency}</Table.Td>
              <Table.Td>
                <Badge color={statusColor[p.status]}>{t(`payroll.run.statuses.${p.status}`)}</Badge>
              </Table.Td>
              <Table.Td>{p.employeesCount}</Table.Td>
              <Table.Td dir="ltr">{p.netTotal}</Table.Td>
              <Table.Td>
                <Button component={Link} to={`/payroll/periods/${p.id}`} size="xs" variant="subtle">
                  {t('payroll.run.open')}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <FormModal
        opened={open}
        title={t('payroll.run.newPeriod')}
        onClose={() => setOpen(false)}
        onSubmit={() => create.mutate()}
        submitting={create.isPending}
        error={null}
      >
        <Group grow>
          <NumberInput
            label={t('payroll.run.year')}
            value={v.year}
            min={2000}
            max={2100}
            onChange={(x) => setV((p) => ({ ...p, year: Number(x) }))}
          />
          <NumberInput
            label={t('payroll.run.monthNo')}
            value={v.month}
            min={1}
            max={12}
            onChange={(x) => setV((p) => ({ ...p, month: Number(x) }))}
          />
        </Group>
        <NativeSelect
          label={t('payroll.run.currency')}
          value={v.currency}
          data={codes}
          onChange={(e) => {
            const value = e.currentTarget.value; // قبل دالة التحديث / before the updater
            setV((p) => ({ ...p, currency: value }));
          }}
        />
        <NativeSelect
          label={t('payroll.run.group')}
          value={v.payGroupId}
          data={[
            { value: '', label: t('payroll.run.defaultGroup') },
            ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.nameAr })),
          ]}
          onChange={(e) => {
            const value = e.currentTarget.value; // قبل دالة التحديث / before the updater
            setV((p) => ({ ...p, payGroupId: value }));
          }}
        />
      </FormModal>
    </Stack>
  );
};
