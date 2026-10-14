import { Badge, Button, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { employeeSalaryInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { useLookup } from '../employees/shared';
import { FormModal, firstIssue } from './crud';
import { ItemsEditor, itemsBody } from './ItemsEditor';
import type { Component, SalaryRow, Structure } from './types';

/** رواتب الموظف بخط زمني: كل راتب جديد يُنهي السابق تلقائياً قبل تاريخ سريانه بيوم. */
export const SalaryTab = ({ employeeId }: { employeeId: string }) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const path = `/employees/${employeeId}/salaries`;
  const manage = can('payroll.salary.manage');
  const list = useQuery({
    queryKey: [path],
    queryFn: async () => (await api.get<SalaryRow[]>(path)).data,
  });
  const structures = useQuery({
    queryKey: ['/payroll', 'structures'],
    queryFn: async () => (await api.get<Structure[]>('/payroll/structures')).data,
    enabled: can('payroll.structure.read'),
  });
  const comps = useQuery({
    queryKey: ['/payroll', 'components'],
    queryFn: async () => (await api.get<Component[]>('/payroll/components')).data,
    enabled: can('payroll.component.read'),
  });
  const currencies = useLookup('/currencies', 'system.currency.read');
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, unknown>>({});
  const [items, setItems] = useState<SalaryRow['components']>([]);
  const [error, setError] = useState<string | null>(null);
  const name = (r: { nameAr: string; nameEn: string | null }) =>
    (i18n.language === 'en' && r.nameEn) || r.nameAr;
  const rows = list.data ?? [];

  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const done = async () => {
    notifications.show({ color: 'teal', message: t('payroll.saved') });
    await qc.invalidateQueries({ queryKey: [path] });
  };
  const create = useMutation({
    mutationFn: async (body: unknown) => api.post(path, body),
    onSuccess: async () => {
      setOpen(false);
      await done();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`${path}/${id}`),
    onSuccess: done,
    onError: fail,
  });

  const start = () => {
    const base = currencies.rows.find((c) => c['isBase'] === true)?.['code'];
    setV({
      structureId: null,
      currency: rows[0]?.currency ?? (typeof base === 'string' ? base : ''),
      basicAmount: rows[0]?.basicAmount.replace(/\.?0+$/, '') ?? '',
      validFrom: '',
      note: '',
    });
    setItems([]);
    setError(null);
    setOpen(true);
  };
  const submit = () => {
    const body = {
      structureId: v['structureId'] || null,
      currency: v['currency'],
      basicAmount: v['basicAmount'],
      validFrom: v['validFrom'],
      note: v['note'] || null,
      components: itemsBody(items),
    };
    const issue = firstIssue(employeeSalaryInput, body);
    if (issue) return setError(issue);
    create.mutate(body);
  };
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  const set = (k: string, val: unknown) => setV((p) => ({ ...p, [k]: val }));

  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={600}>{t('payroll.salary.title')}</Text>
        {manage && <Button onClick={start}>{t('payroll.salary.add')}</Button>}
      </Group>
      {list.isSuccess && rows.length === 0 && <Text c="dimmed">{t('payroll.salary.empty')}</Text>}
      {rows.length > 0 && (
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('payroll.salary.validFrom')}</Table.Th>
              <Table.Th>{t('payroll.salary.validTo')}</Table.Th>
              <Table.Th>{t('payroll.salary.basic')}</Table.Th>
              <Table.Th>{t('payroll.salary.structure')}</Table.Th>
              <Table.Th>{t('payroll.salary.note')}</Table.Th>
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={r.id}>
                <Table.Td>{fmt.date(r.validFrom)}</Table.Td>
                <Table.Td>
                  {r.validTo ? (
                    fmt.date(r.validTo)
                  ) : (
                    <Badge variant="light" color="teal">
                      {t('payroll.salary.current')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td dir="ltr">
                  {r.basicAmount} {r.currency}
                </Table.Td>
                <Table.Td>{r.structureName ?? t('payroll.salary.noStructure')}</Table.Td>
                <Table.Td>{r.note ?? '—'}</Table.Td>
                <Table.Td>
                  {manage && i === 0 && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: t('payroll.salary.deleteLatest'),
                          children: <Text size="sm">{t('payroll.salary.deleteConfirm')}</Text>,
                          labels: { confirm: t('payroll.remove'), cancel: t('common.cancel') },
                          confirmProps: { color: 'red' },
                          onConfirm: () => remove.mutate(r.id),
                        })
                      }
                    >
                      {t('payroll.salary.deleteLatest')}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <FormModal
        opened={open}
        title={t('payroll.salary.add')}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitting={create.isPending}
        error={error}
      >
        <Group grow>
          <TextInput
            label={t('payroll.salary.basic')}
            dir="ltr"
            value={str('basicAmount')}
            onChange={(e) => set('basicAmount', e.currentTarget.value)}
          />
          <Select
            label={t('payroll.currency')}
            data={currencies.rows.map((c) => ({
              value: String(c['code']),
              label: String(c['code']),
            }))}
            value={str('currency') || null}
            onChange={(x) => set('currency', x ?? '')}
          />
          <TextInput
            label={t('payroll.salary.validFrom')}
            type="date"
            value={str('validFrom')}
            onChange={(e) => set('validFrom', e.currentTarget.value)}
          />
        </Group>
        <Select
          label={t('payroll.salary.structure')}
          clearable
          placeholder={t('payroll.salary.noStructure')}
          data={(structures.data ?? [])
            .filter((s) => s.isActive)
            .map((s) => ({ value: s.id, label: name(s) }))}
          value={(v['structureId'] as string | null) ?? null}
          onChange={(x) => set('structureId', x)}
        />
        <Text fw={600} size="sm">
          {t('payroll.salary.extra')}
        </Text>
        <ItemsEditor
          items={items}
          onChange={setItems}
          options={(comps.data ?? []).map((c) => ({ value: c.id, label: name(c) }))}
        />
        <TextInput
          label={t('payroll.salary.note')}
          value={str('note')}
          onChange={(e) => set('note', e.currentTarget.value)}
        />
      </FormModal>
    </Stack>
  );
};
