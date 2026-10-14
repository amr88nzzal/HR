import {
  Badge,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { useQuery } from '@tanstack/react-query';
import { payComponentInput } from '@hrms/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FormModal, firstIssue, useCrud } from './crud';
import type { Base, Component, RateTable, Variable } from './types';

const KINDS = ['earning', 'deduction', 'employer'] as const;
const CALCS = ['fixed', 'percent', 'formula', 'rate_table'] as const;

const blank = (): Record<string, unknown> => ({
  code: '',
  nameAr: '',
  nameEn: '',
  kind: 'earning',
  calcType: 'fixed',
  fixedAmount: '',
  percent: '',
  baseId: null,
  formula: '',
  rateTableId: null,
  roundingDecimals: 2,
  displayOrder: 100,
  isActive: true,
});

const toBody = (v: Record<string, unknown>) => {
  const s = (k: string) => (typeof v[k] === 'string' && v[k] !== '' ? v[k] : null);
  return {
    code: v['code'],
    nameAr: v['nameAr'],
    nameEn: s('nameEn'),
    kind: v['kind'],
    calcType: v['calcType'],
    fixedAmount: s('fixedAmount'),
    percent: s('percent'),
    baseId: s('baseId'),
    formula: s('formula'),
    rateTableId: s('rateTableId'),
    roundingDecimals: v['roundingDecimals'],
    displayOrder: v['displayOrder'],
    isActive: v['isActive'],
  };
};

/** مكونات الرواتب: استحقاقات واستقطاعات بمبلغ ثابت أو نسبة أو صيغة أو جدول نسب. */
export const ComponentsPanel = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const crud = useCrud<Component>('components');
  const bases = useCrud<Base>('bases', can('payroll.base.read'));
  const tables = useCrud<RateTable>('rate-tables', can('payroll.rate_table.read'));
  const vars = useQuery({
    queryKey: ['/payroll', 'variables'],
    queryFn: async () => (await api.get<Variable[]>('/payroll/variables')).data,
  });
  const area = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<Component | 'new' | null>(null);
  const [v, setV] = useState<Record<string, unknown>>(blank());
  const [error, setError] = useState<string | null>(null);
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const name = (r: { nameAr: string; nameEn: string | null }) =>
    (lang === 'en' && r.nameEn) || r.nameAr;
  const set = (k: string, val: unknown) => setV((p) => ({ ...p, [k]: val }));
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');

  const open = (c: Component | 'new') => {
    setError(null);
    setEditing(c);
    setV(
      c === 'new'
        ? blank()
        : {
            ...c,
            nameEn: c.nameEn ?? '',
            fixedAmount: c.fixedAmount ?? '',
            percent: c.percent ?? '',
            formula: c.formula ?? '',
          },
    );
  };
  const submit = () => {
    const body = toBody(v);
    const issue = firstIssue(payComponentInput, body);
    if (issue) return setError(issue);
    setError(null);
    const id = editing && editing !== 'new' ? editing.id : undefined;
    crud.save.mutate(
      { id, body: id ? { ...body, version: (editing as Component).version } : body },
      { onSuccess: () => setEditing(null) },
    );
  };
  const insert = (token: string) => {
    const el = area.current;
    const cur = str('formula');
    if (!el) return set('formula', cur + token);
    set('formula', cur.slice(0, el.selectionStart) + token + cur.slice(el.selectionEnd));
  };
  const calc = str('calcType');
  const baseOpts = bases.rows.map((b) => ({ value: b.id, label: name(b) }));
  const codes = crud.rows.filter((c) => editing === 'new' || (editing && c.id !== editing.id));

  return (
    <Stack>
      <Group justify="flex-end">
        {can('payroll.component.create') && (
          <Button onClick={() => open('new')}>{t('payroll.add')}</Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.code')}</Table.Th>
            <Table.Th>{t('payroll.nameAr')}</Table.Th>
            <Table.Th>{t('payroll.kind')}</Table.Th>
            <Table.Th>{t('payroll.calcType')}</Table.Th>
            <Table.Th>{t('payroll.active')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crud.rows.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td dir="ltr">{c.code}</Table.Td>
              <Table.Td>{name(c)}</Table.Td>
              <Table.Td>
                <Badge
                  variant="light"
                  color={c.kind === 'earning' ? 'teal' : c.kind === 'deduction' ? 'red' : 'gray'}
                >
                  {t(`payroll.kinds.${c.kind}`)}
                </Badge>
              </Table.Td>
              <Table.Td>{t(`payroll.calcTypes.${c.calcType}`)}</Table.Td>
              <Table.Td>{c.isActive ? '✓' : '—'}</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  {can('payroll.component.update') && (
                    <Button size="xs" variant="subtle" onClick={() => open(c)}>
                      {t('payroll.edit')}
                    </Button>
                  )}
                  {can('payroll.component.delete') && (
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
                          onConfirm: () => crud.remove.mutate(c.id),
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
            value={str('code')}
            onChange={(e) => set('code', e.currentTarget.value)}
          />
          <TextInput
            label={t('payroll.nameAr')}
            value={str('nameAr')}
            onChange={(e) => set('nameAr', e.currentTarget.value)}
          />
          <TextInput
            label={t('payroll.nameEn')}
            value={str('nameEn')}
            onChange={(e) => set('nameEn', e.currentTarget.value)}
          />
        </Group>
        <Group grow>
          <Select
            label={t('payroll.kind')}
            allowDeselect={false}
            data={KINDS.map((k) => ({ value: k, label: t(`payroll.kinds.${k}`) }))}
            value={str('kind')}
            onChange={(x) => set('kind', x)}
          />
          <Select
            label={t('payroll.calcType')}
            allowDeselect={false}
            data={CALCS.map((k) => ({ value: k, label: t(`payroll.calcTypes.${k}`) }))}
            value={calc}
            onChange={(x) => set('calcType', x)}
          />
        </Group>
        {calc === 'fixed' && (
          <TextInput
            label={t('payroll.fixedAmount')}
            dir="ltr"
            value={str('fixedAmount')}
            onChange={(e) => set('fixedAmount', e.currentTarget.value)}
          />
        )}
        {(calc === 'percent' || calc === 'rate_table') && (
          <Group grow>
            {calc === 'percent' && (
              <TextInput
                label={t('payroll.percent')}
                dir="ltr"
                value={str('percent')}
                onChange={(e) => set('percent', e.currentTarget.value)}
              />
            )}
            {calc === 'rate_table' && (
              <Select
                label={t('payroll.rateTable')}
                data={tables.rows.map((r) => ({ value: r.id, label: name(r) }))}
                value={(v['rateTableId'] as string | null) ?? null}
                onChange={(x) => set('rateTableId', x)}
              />
            )}
            <Select
              label={t('payroll.base')}
              data={baseOpts}
              value={(v['baseId'] as string | null) ?? null}
              onChange={(x) => set('baseId', x)}
            />
          </Group>
        )}
        {calc === 'formula' && (
          <Stack gap="xs">
            <Textarea
              ref={area}
              label={t('payroll.formula')}
              description={t('payroll.formulaHint')}
              dir="ltr"
              rows={3}
              styles={{ input: { fontFamily: 'monospace' } }}
              value={str('formula')}
              onChange={(e) => set('formula', e.currentTarget.value)}
            />
            <Group gap={4}>
              {(vars.data ?? []).map((x) => (
                <Badge
                  key={x.key}
                  variant="light"
                  style={{ cursor: 'pointer', textTransform: 'none' }}
                  title={x.key}
                  onClick={() => insert(x.key)}
                >
                  {lang === 'en' ? x.labelEn : x.labelAr}
                </Badge>
              ))}
              {codes.map((c) => (
                <Badge
                  key={c.id}
                  variant="outline"
                  style={{ cursor: 'pointer', textTransform: 'none' }}
                  title={c.code}
                  onClick={() => insert(c.code)}
                >
                  {name(c)}
                </Badge>
              ))}
            </Group>
          </Stack>
        )}
        <Group grow>
          <NumberInput
            label={t('payroll.rounding')}
            min={0}
            max={4}
            value={v['roundingDecimals'] as number}
            onChange={(x) => set('roundingDecimals', Number(x))}
          />
          <NumberInput
            label={t('payroll.order')}
            min={0}
            max={9999}
            value={v['displayOrder'] as number}
            onChange={(x) => set('displayOrder', Number(x))}
          />
        </Group>
        <Switch
          label={t('payroll.active')}
          checked={v['isActive'] === true}
          onChange={(e) => set('isActive', e.currentTarget.checked)}
        />
      </FormModal>
    </Stack>
  );
};
