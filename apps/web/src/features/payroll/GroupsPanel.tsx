import { Button, Group, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { overrideReasonInput, payGroupInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FormModal, firstIssue, useCrud } from './crud';
import type { Group as PayGroup, Reason } from './runs-types';

type Item = PayGroup | Reason;

/** قائمة بسيطة (رمز + اسم): مجموعات الدفع، وأسباب التجاوز اليدوي. */
export const SimpleListPanel = ({
  base,
  perm,
  kind,
}: {
  base: 'groups' | 'override-reasons';
  perm: string;
  kind: 'group' | 'reason';
}) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const crud = useCrud<Item>(base);
  const schema = kind === 'group' ? payGroupInput : overrideReasonInput;
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [v, setV] = useState({ code: '', nameAr: '', nameEn: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  const open = (r: Item | 'new') => {
    setError(null);
    setEditing(r);
    setV(
      r === 'new'
        ? { code: '', nameAr: '', nameEn: '', isActive: true }
        : { code: r.code, nameAr: r.nameAr, nameEn: r.nameEn ?? '', isActive: r.isActive },
    );
  };
  const submit = () => {
    const body = { ...v, nameEn: v.nameEn || null };
    const issue = firstIssue(schema, body);
    if (issue) return setError(issue);
    const cur = editing && editing !== 'new' ? editing : null;
    crud.save.mutate(
      { id: cur?.id, body: cur ? { ...body, version: cur.version } : body },
      { onSuccess: () => setEditing(null) },
    );
  };
  return (
    <Stack>
      <Group justify="flex-end">
        {can(`${perm}.create`) && <Button onClick={() => open('new')}>{t('payroll.add')}</Button>}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.code')}</Table.Th>
            <Table.Th>{t('payroll.nameAr')}</Table.Th>
            <Table.Th>{t('payroll.active')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crud.rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td dir="ltr">{r.code}</Table.Td>
              <Table.Td>
                {(i18n.language === 'en' && r.nameEn) || r.nameAr}
                {'isDefault' in r && r.isDefault && (
                  <Text span size="xs" c="dimmed">{` (${t('payroll.run.default')})`}</Text>
                )}
              </Table.Td>
              <Table.Td>{r.isActive ? '✓' : '—'}</Table.Td>
              <Table.Td>
                {can(`${perm}.update`) && (
                  <Button size="xs" variant="subtle" onClick={() => open(r)}>
                    {t('payroll.edit')}
                  </Button>
                )}
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
            onChange={(e) => setV({ ...v, code: e.currentTarget.value })}
          />
          <TextInput
            label={t('payroll.nameAr')}
            value={v.nameAr}
            onChange={(e) => setV({ ...v, nameAr: e.currentTarget.value })}
          />
        </Group>
        <TextInput
          label={t('payroll.nameEn')}
          value={v.nameEn}
          onChange={(e) => setV({ ...v, nameEn: e.currentTarget.value })}
        />
        <Switch
          label={t('payroll.active')}
          checked={v.isActive}
          onChange={(e) => setV({ ...v, isActive: e.currentTarget.checked })}
        />
      </FormModal>
    </Stack>
  );
};
