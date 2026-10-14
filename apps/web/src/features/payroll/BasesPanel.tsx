import { Button, Group, MultiSelect, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { payrollBaseInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FormModal, firstIssue, useCrud } from './crud';
import type { Base, Component } from './types';

const blank = (): Base =>
  ({
    id: '',
    code: '',
    nameAr: '',
    nameEn: '',
    includesBasic: false,
    componentIds: [],
    isActive: true,
    version: 0,
  }) as Base;

/** أسس الاحتساب: مجموعات مسماة (أساسي + مكونات) تُحتسب عليها النسب وجداول النسب. */
export const BasesPanel = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const crud = useCrud<Base>('bases');
  const comps = useCrud<Component>('components', can('payroll.component.read'));
  const [editing, setEditing] = useState<Base | 'new' | null>(null);
  const [v, setV] = useState<Base>(blank());
  const [error, setError] = useState<string | null>(null);
  const name = (r: { nameAr: string; nameEn: string | null }) =>
    (i18n.language === 'en' && r.nameEn) || r.nameAr;
  const set = <K extends keyof Base>(k: K, val: Base[K]) => setV((p) => ({ ...p, [k]: val }));

  const open = (b: Base | 'new') => {
    setError(null);
    setEditing(b);
    setV(b === 'new' ? blank() : { ...b, nameEn: b.nameEn ?? '' });
  };
  const submit = () => {
    const body = {
      code: v.code,
      nameAr: v.nameAr,
      nameEn: v.nameEn || null,
      includesBasic: v.includesBasic,
      componentIds: v.componentIds,
      isActive: v.isActive,
    };
    const issue = firstIssue(payrollBaseInput, body);
    if (issue) return setError(issue);
    const id = editing && editing !== 'new' ? editing.id : undefined;
    crud.save.mutate(
      { id, body: id ? { ...body, version: v.version } : body },
      { onSuccess: () => setEditing(null) },
    );
  };
  const nameOf = (id: string) => {
    const c = comps.rows.find((x) => x.id === id);
    return c ? name(c) : id;
  };

  return (
    <Stack>
      <Group justify="flex-end">
        {can('payroll.base.create') && (
          <Button onClick={() => open('new')}>{t('payroll.add')}</Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.code')}</Table.Th>
            <Table.Th>{t('payroll.nameAr')}</Table.Th>
            <Table.Th>{t('payroll.members')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crud.rows.map((b) => (
            <Table.Tr key={b.id}>
              <Table.Td dir="ltr">{b.code}</Table.Td>
              <Table.Td>{name(b)}</Table.Td>
              <Table.Td>
                {[
                  ...(b.includesBasic ? [t('payroll.includesBasic')] : []),
                  ...b.componentIds.map(nameOf),
                ].join('، ') || '—'}
              </Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  {can('payroll.base.update') && (
                    <Button size="xs" variant="subtle" onClick={() => open(b)}>
                      {t('payroll.edit')}
                    </Button>
                  )}
                  {can('payroll.base.delete') && (
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
                          onConfirm: () => crud.remove.mutate(b.id),
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
        <Switch
          label={t('payroll.includesBasic')}
          checked={v.includesBasic}
          onChange={(e) => set('includesBasic', e.currentTarget.checked)}
        />
        <MultiSelect
          label={t('payroll.members')}
          searchable
          data={comps.rows.map((c) => ({ value: c.id, label: name(c) }))}
          value={v.componentIds}
          onChange={(x) => set('componentIds', x)}
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
