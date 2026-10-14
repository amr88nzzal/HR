import { Button, Group, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { salaryStructureInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { useLookup } from '../employees/shared';
import { FormModal, firstIssue, useCrud } from './crud';
import { ItemsEditor, itemsBody } from './ItemsEditor';
import type { Component, Structure } from './types';

const blank = (): Structure =>
  ({
    id: '',
    code: '',
    nameAr: '',
    nameEn: '',
    currency: null,
    items: [],
    isActive: true,
    version: 0,
  }) as Structure;

/** هياكل الرواتب: مجموعات مكونات جاهزة تُسند للموظف مع إمكان تخصيص قيمها. */
export const StructuresPanel = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const crud = useCrud<Structure>('structures');
  const comps = useCrud<Component>('components', can('payroll.component.read'));
  const currencies = useLookup('/currencies', 'system.currency.read');
  const [editing, setEditing] = useState<Structure | 'new' | null>(null);
  const [v, setV] = useState<Structure>(blank());
  const [error, setError] = useState<string | null>(null);
  const name = (r: { nameAr: string; nameEn: string | null }) =>
    (i18n.language === 'en' && r.nameEn) || r.nameAr;
  const set = <K extends keyof Structure>(k: K, val: Structure[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const open = (s: Structure | 'new') => {
    setError(null);
    setEditing(s);
    setV(s === 'new' ? blank() : { ...s, nameEn: s.nameEn ?? '' });
  };
  const submit = () => {
    const body = {
      code: v.code,
      nameAr: v.nameAr,
      nameEn: v.nameEn || null,
      currency: v.currency || null,
      items: itemsBody(v.items),
      isActive: v.isActive,
    };
    const issue = firstIssue(salaryStructureInput, body);
    if (issue) return setError(issue);
    const id = editing && editing !== 'new' ? editing.id : undefined;
    crud.save.mutate(
      { id, body: id ? { ...body, version: v.version } : body },
      { onSuccess: () => setEditing(null) },
    );
  };

  return (
    <Stack>
      <Group justify="flex-end">
        {can('payroll.structure.create') && (
          <Button onClick={() => open('new')}>{t('payroll.add')}</Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.code')}</Table.Th>
            <Table.Th>{t('payroll.nameAr')}</Table.Th>
            <Table.Th>{t('payroll.currency')}</Table.Th>
            <Table.Th>{t('payroll.items')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crud.rows.map((s) => (
            <Table.Tr key={s.id}>
              <Table.Td dir="ltr">{s.code}</Table.Td>
              <Table.Td>{name(s)}</Table.Td>
              <Table.Td dir="ltr">{s.currency ?? t('payroll.anyCurrency')}</Table.Td>
              <Table.Td dir="ltr">{s.items.length}</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  {can('payroll.structure.update') && (
                    <Button size="xs" variant="subtle" onClick={() => open(s)}>
                      {t('payroll.edit')}
                    </Button>
                  )}
                  {can('payroll.structure.delete') && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: t('payroll.remove'),
                          children: <Text size="sm">{t('payroll.confirmDelete')}</Text>,
                          labels: { confirm: t('payroll.remove'), cancel: t('common.cancel') },
                          confirmProps: { color: 'red' },
                          onConfirm: () => crud.remove.mutate(s.id),
                        })
                      }
                    >
                      {t('payroll.remove')}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <FormModal
        opened={editing !== null}
        title={editing === 'new' ? t('payroll.add') : t('payroll.edit')}
        onClose={() => setEditing(null)}
        onSubmit={submit}
        submitting={crud.save.isPending}
        error={error}
      >
        <Group grow>
          <TextInput
            label={t('payroll.code')}
            dir="ltr"
            disabled={editing !== 'new'}
            value={v.code}
            onChange={(e) => set('code', e.currentTarget.value)}
          />
          <TextInput
            label={t('payroll.nameAr')}
            value={v.nameAr}
            onChange={(e) => set('nameAr', e.currentTarget.value)}
          />
          <TextInput
            label={t('payroll.nameEn')}
            value={v.nameEn ?? ''}
            onChange={(e) => set('nameEn', e.currentTarget.value)}
          />
        </Group>
        <Select
          label={t('payroll.currency')}
          clearable
          placeholder={t('payroll.anyCurrency')}
          data={currencies.rows.map((c) => ({
            value: String(c['code']),
            label: String(c['code']),
          }))}
          value={v.currency}
          onChange={(x) => set('currency', x)}
        />
        <Text fw={600} size="sm">
          {t('payroll.items')}
        </Text>
        <ItemsEditor
          items={v.items}
          onChange={(items) => set('items', items)}
          options={comps.rows.map((c) => ({ value: c.id, label: name(c) }))}
        />
        <Switch
          label={t('payroll.active')}
          checked={v.isActive}
          onChange={(e) => set('isActive', e.currentTarget.checked)}
        />
      </FormModal>
    </Stack>
  );
};
