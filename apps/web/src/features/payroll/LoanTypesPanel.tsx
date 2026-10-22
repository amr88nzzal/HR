import {
  Button,
  ColorInput,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  TextInput,
} from '@mantine/core';
import { loanTypeInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FormModal, firstIssue, useCrud } from './crud';
import type { LoanType } from './loan-types-api';

const EMPTY = {
  code: '',
  nameAr: '',
  nameEn: '',
  color: '#4c6ef5',
  disburses: true,
  maxInstallments: 12,
  monthlyLimitPercent: '' as number | '',
  glAccount: '',
  isActive: true,
  sortOrder: 0,
};

/** أنواع السلف: الاسم واللون وهل يُصرف نقداً (سلفة) أم شراء بالآجل (ذمم)، وسقف الأقساط والحساب المحاسبي. */
export const LoanTypesPanel = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const crud = useCrud<LoanType>('loan-types');
  const [editing, setEditing] = useState<LoanType | 'new' | null>(null);
  const [v, setV] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const open = (r: LoanType | 'new') => {
    setError(null);
    setEditing(r);
    setV(
      r === 'new'
        ? { ...EMPTY, sortOrder: crud.rows.length + 1 }
        : {
            code: r.code,
            nameAr: r.nameAr,
            nameEn: r.nameEn,
            color: r.color,
            disburses: r.disburses,
            maxInstallments: r.maxInstallments,
            monthlyLimitPercent: r.monthlyLimitPercent ? Number(r.monthlyLimitPercent) : '',
            glAccount: r.glAccount ?? '',
            isActive: r.isActive,
            sortOrder: r.sortOrder,
          },
    );
  };
  const submit = () => {
    const body = {
      ...v,
      monthlyLimitPercent: v.monthlyLimitPercent === '' ? null : v.monthlyLimitPercent,
      glAccount: v.glAccount || null,
    };
    const issue = firstIssue(loanTypeInput, body);
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
        {can('payroll.loan_type.create') && (
          <Button onClick={() => open('new')}>{t('payroll.add')}</Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.code')}</Table.Th>
            <Table.Th>{t('payroll.nameAr')}</Table.Th>
            <Table.Th>{t('loanTypes.color')}</Table.Th>
            <Table.Th>{t('loanTypes.disburses')}</Table.Th>
            <Table.Th>{t('loanTypes.maxInstallments')}</Table.Th>
            <Table.Th>{t('payroll.active')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crud.rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td dir="ltr">{r.code}</Table.Td>
              <Table.Td>{(i18n.language === 'en' && r.nameEn) || r.nameAr}</Table.Td>
              <Table.Td>
                <span
                  aria-label={r.color}
                  style={{
                    display: 'inline-block',
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    background: r.color,
                  }}
                />
              </Table.Td>
              <Table.Td>{r.disburses ? t('loanTypes.cash') : t('loanTypes.credit')}</Table.Td>
              <Table.Td>{r.maxInstallments}</Table.Td>
              <Table.Td>{r.isActive ? '✓' : '—'}</Table.Td>
              <Table.Td>
                {can('payroll.loan_type.update') && (
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
          <TextInput
            label={t('payroll.nameEn')}
            value={v.nameEn}
            onChange={(e) => setV({ ...v, nameEn: e.currentTarget.value })}
          />
        </Group>
        <Group grow align="flex-end">
          <ColorInput
            label={t('loanTypes.color')}
            format="hex"
            value={v.color}
            onChange={(c) => setV({ ...v, color: c })}
          />
          <NumberInput
            label={t('loanTypes.maxInstallments')}
            min={1}
            max={120}
            value={v.maxInstallments}
            onChange={(n) => setV({ ...v, maxInstallments: Number(n) || 1 })}
          />
          <NumberInput
            label={t('loanTypes.monthlyLimit')}
            description={t('loanTypes.monthlyLimitHint')}
            min={0}
            max={100}
            value={v.monthlyLimitPercent}
            onChange={(n) => setV({ ...v, monthlyLimitPercent: n === '' ? '' : Number(n) })}
          />
        </Group>
        <TextInput
          label={t('loanTypes.glAccount')}
          description={t('loanTypes.glHint')}
          dir="ltr"
          value={v.glAccount}
          onChange={(e) => setV({ ...v, glAccount: e.currentTarget.value })}
        />
        <Switch
          label={t('loanTypes.disbursesLabel')}
          checked={v.disburses}
          onChange={(e) => setV({ ...v, disburses: e.currentTarget.checked })}
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
