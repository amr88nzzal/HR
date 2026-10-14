import {
  ActionIcon,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconTrash } from '@tabler/icons-react';
import { rateTableInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FormModal, firstIssue, useCrud } from './crud';
import type { Bracket, RateTable } from './types';

const blank = (): RateTable =>
  ({
    id: '',
    code: '',
    nameAr: '',
    nameEn: '',
    mode: 'progressive',
    brackets: [{ from: '0', to: null, rate: '0', fixed: '0' }],
    isActive: true,
    version: 0,
  }) as RateTable;

/** جداول النسب القانونية (تأمينات/ضريبة) كشرائح قابلة للضبط بلا ترميز ثابت. */
export const RatesPanel = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const crud = useCrud<RateTable>('rate-tables');
  const [editing, setEditing] = useState<RateTable | 'new' | null>(null);
  const [v, setV] = useState<RateTable>(blank());
  const [error, setError] = useState<string | null>(null);
  const name = (r: { nameAr: string; nameEn: string | null }) =>
    (i18n.language === 'en' && r.nameEn) || r.nameAr;
  const set = <K extends keyof RateTable>(k: K, val: RateTable[K]) =>
    setV((p) => ({ ...p, [k]: val }));
  const setB = (i: number, patch: Partial<Bracket>) =>
    set(
      'brackets',
      v.brackets.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    );

  const open = (r: RateTable | 'new') => {
    setError(null);
    setEditing(r);
    setV(r === 'new' ? blank() : { ...r, nameEn: r.nameEn ?? '' });
  };
  const submit = () => {
    const body = {
      code: v.code,
      nameAr: v.nameAr,
      nameEn: v.nameEn || null,
      mode: v.mode,
      brackets: v.brackets.map((b) => ({ ...b, to: b.to || null, fixed: b.fixed || '0' })),
      isActive: v.isActive,
    };
    const issue = firstIssue(rateTableInput, body);
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
        {can('payroll.rate_table.create') && (
          <Button onClick={() => open('new')}>{t('payroll.add')}</Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.code')}</Table.Th>
            <Table.Th>{t('payroll.nameAr')}</Table.Th>
            <Table.Th>{t('payroll.mode')}</Table.Th>
            <Table.Th>{t('payroll.brackets')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crud.rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td dir="ltr">{r.code}</Table.Td>
              <Table.Td>{name(r)}</Table.Td>
              <Table.Td>{t(`payroll.modes.${r.mode}`)}</Table.Td>
              <Table.Td dir="ltr">{r.brackets.length}</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  {can('payroll.rate_table.update') && (
                    <Button size="xs" variant="subtle" onClick={() => open(r)}>
                      {t('payroll.edit')}
                    </Button>
                  )}
                  {can('payroll.rate_table.delete') && (
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
                          onConfirm: () => crud.remove.mutate(r.id),
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
          label={t('payroll.mode')}
          allowDeselect={false}
          data={(['progressive', 'slab'] as const).map((m) => ({
            value: m,
            label: t(`payroll.modes.${m}`),
          }))}
          value={v.mode}
          onChange={(x) => set('mode', (x ?? 'progressive') as RateTable['mode'])}
        />
        <Stack gap="xs">
          <Text fw={600} size="sm">
            {t('payroll.brackets')}
          </Text>
          {v.brackets.map((b, i) => (
            <Group key={i} align="flex-end" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                dir="ltr"
                label={i === 0 ? t('payroll.from') : undefined}
                aria-label={t('payroll.from')}
                value={b.from}
                onChange={(e) => setB(i, { from: e.currentTarget.value })}
              />
              <TextInput
                style={{ flex: 1 }}
                dir="ltr"
                label={i === 0 ? t('payroll.to') : undefined}
                aria-label={t('payroll.to')}
                value={b.to ?? ''}
                onChange={(e) => setB(i, { to: e.currentTarget.value || null })}
              />
              <TextInput
                style={{ flex: 1 }}
                dir="ltr"
                label={i === 0 ? t('payroll.rate') : undefined}
                aria-label={t('payroll.rate')}
                value={b.rate}
                onChange={(e) => setB(i, { rate: e.currentTarget.value })}
              />
              <TextInput
                style={{ flex: 1 }}
                dir="ltr"
                label={i === 0 ? t('payroll.fixed') : undefined}
                aria-label={t('payroll.fixed')}
                value={b.fixed}
                onChange={(e) => setB(i, { fixed: e.currentTarget.value })}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={t('payroll.remove')}
                disabled={v.brackets.length < 2}
                onClick={() =>
                  set(
                    'brackets',
                    v.brackets.filter((_, j) => j !== i),
                  )
                }
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            variant="light"
            size="xs"
            w="fit-content"
            onClick={() =>
              set('brackets', [
                ...v.brackets,
                { from: v.brackets.at(-1)?.to ?? '', to: null, rate: '0', fixed: '0' },
              ])
            }
          >
            {t('payroll.addBracket')}
          </Button>
        </Stack>
        <Switch
          label={t('payroll.active')}
          checked={v.isActive}
          onChange={(e) => set('isActive', e.currentTarget.checked)}
        />
      </FormModal>
    </Stack>
  );
};
