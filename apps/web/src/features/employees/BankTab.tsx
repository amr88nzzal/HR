import { Button, Code, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconEye } from '@tabler/icons-react';
import { bankAccountInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import type { Column } from '../../components/DataTable';
import type { FieldDef } from '../../components/DynamicForm';
import { EntityTable } from '../../components/EntityTable';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { str, useLookup } from './shared';

/** الحسابات البنكية: الآيبان مقنّع دائماً، والكشف بصلاحية مستقلة ومدقَّق. */
export const BankTab = ({ employeeId }: { employeeId: string }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const currencies = useLookup('/currencies', 'system.currency.read');
  const [revealed, setRevealed] = useState<string | null>(null);
  const manage = can('employees.bank_account.manage');
  const path = `/employees/${employeeId}/bank-accounts`;

  const reveal = async (row: Row) => {
    try {
      const res = await api.post<{ iban: string }>(`${path}/${row.id}/reveal`);
      setRevealed(res.data.iban);
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    }
  };

  const columns: Column<Row>[] = [
    { key: 'bank', header: t('fields.bankName'), render: (r) => str(r['bankName']) },
    {
      key: 'holder',
      header: t('fields.accountHolder'),
      render: (r) => str(r['accountHolder']) || '—',
    },
    {
      key: 'iban',
      header: t('hr.emp.bank.masked'),
      render: (r) => str(r['ibanMasked']),
      ltr: true,
    },
    { key: 'currency', header: t('fields.currency'), render: (r) => str(r['currency']), ltr: true },
    { key: 'validFrom', header: t('fields.validFrom'), render: (r) => fmt.date(r['validFrom']) },
    { key: 'validTo', header: t('fields.validTo'), render: (r) => fmt.date(r['validTo']) },
    {
      key: 'primary',
      header: t('fields.isPrimary'),
      render: (r) => (r['isPrimary'] === true ? '✓' : '—'),
    },
  ];
  const fields = (editing: Row | null): FieldDef[] => [
    { name: 'bankName', kind: 'text', required: true },
    { name: 'accountHolder', kind: 'text' },
    {
      name: 'iban',
      kind: 'text',
      required: !editing,
      ltr: true,
      description: editing ? str(editing['ibanMasked']) : undefined,
    },
    currencies.rows.length
      ? {
          name: 'currency',
          kind: 'select',
          required: true,
          options: currencies.rows.map((c) => ({
            value: str(c['code']),
            label: `${str(c['code'])} — ${currencies.name(c.id)}`,
          })),
        }
      : { name: 'currency', kind: 'text', required: true, ltr: true },
    { name: 'validFrom', kind: 'date' },
    { name: 'validTo', kind: 'date' },
    { name: 'isPrimary', kind: 'switch' },
  ];

  return (
    <>
      <EntityTable
        path={path}
        columns={columns}
        fields={fields}
        // عند التعديل الآيبان اختياري (يُترك فارغاً للإبقاء على المخزّن)
        schema={(editing) =>
          editing
            ? bankAccountInput.extend({ iban: bankAccountInput.shape.iban.nullish() })
            : bankAccountInput
        }
        defaults={{ isPrimary: false }}
        canCreate={manage}
        canUpdate={manage}
        canDelete={manage}
        toBody={(values) => {
          const { iban, ...rest } = values;
          return iban ? { ...rest, iban } : rest;
        }}
        extraActions={
          can('employees.bank_account.reveal')
            ? (row) => (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<IconEye size={14} />}
                  onClick={() => void reveal(row)}
                >
                  {t('hr.emp.bank.reveal')}
                </Button>
              )
            : undefined
        }
      />
      <Modal
        opened={revealed !== null}
        onClose={() => setRevealed(null)}
        title={t('hr.emp.bank.revealed')}
        centered
      >
        <Stack>
          <Code fz="lg" dir="ltr" data-testid="revealed-iban">
            {revealed}
          </Code>
          <Text size="xs" c="dimmed">
            {t('hr.emp.bank.revealed')}
          </Text>
          <Group justify="flex-end">
            <Button onClick={() => setRevealed(null)}>{t('hr.emp.bank.hide')}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
