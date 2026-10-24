import {
  ActionIcon,
  Button,
  FileInput,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { useLookup } from '../employees/shared';
import { LOAN_ACCEPT, uploadLoanFile } from './LoanAttachments';
import { useLoanTypes } from './loan-types-api';

type Item = { eventDate: string; reference: string; amount: string; file: File | null };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * إدخال عدة فواتير/سلف لموظف واحد دفعة واحدة (كل بند سجل مستقل بقسط واحد).
 * Enter several invoices/advances for one employee at once (each is its own single-installment record).
 */
export const BulkInvoiceModal = ({
  employeeId,
  onClose,
}: {
  employeeId?: string | undefined;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const types = useLoanTypes();
  const currencies = useLookup('/currencies', 'system.currency.read');
  const [emp, setEmp] = useState(employeeId ?? '');
  const [typeId, setTypeId] = useState('');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<Item[]>([
    { eventDate: today(), reference: '', amount: '', file: null },
  ]);
  const codes = currencies.rows.map((r) => String(r['code']));
  const cur = currency || codes[0] || '';
  const type =
    (types.data ?? []).find((x) => x.id === typeId) ??
    types.data?.find((x) => !x.disburses) ??
    types.data?.[0];
  const valid = items.every(
    (i) => /^\d{1,14}(\.\d{1,4})?$/.test(i.amount) && Number(i.amount) > 0 && i.eventDate,
  );
  const set = (n: number, patch: Partial<Item>) =>
    setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const save = useMutation({
    mutationFn: () =>
      api.post('/payroll/loans/bulk', {
        employeeId: emp,
        typeId: type?.id,
        currency: cur,
        items: items.map((i) => ({
          eventDate: i.eventDate,
          reference: i.reference || null,
          amount: i.amount,
        })),
      }),
    onSuccess: async (res) => {
      if ((res.meta?.['warnings'] as string[] | undefined)?.includes('MONTHLY_LIMIT_EXCEEDED'))
        notifications.show({ color: 'orange', message: t('loans.limitWarning') });
      // المرفقات اختيارية: تُرفع بترتيب البنود بعد الإنشاء، وفشل أحدها لا يُلغي الفواتير
      // Attachments are optional: uploaded in item order after creation; a failure never undoes the invoices
      const ids = (res.data as { ids?: string[] } | undefined)?.ids ?? [];
      for (const [i, it] of items.entries()) {
        const id = ids[i];
        if (it.file && id)
          await uploadLoanFile(id, it.file).catch((e) =>
            notifications.show({ color: 'red', message: errorMessage(e, t) }),
          );
      }
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('loans.bulkNew')} centered size="lg">
      <Stack>
        {!employeeId && (
          <EmployeeSelect
            label={t('payroll.run.employee')}
            value={emp || null}
            onChange={(id) => setEmp(id ?? '')}
          />
        )}
        <Group grow>
          <NativeSelect
            label={t('loans.kind')}
            value={type?.id ?? ''}
            onChange={(e) => setTypeId(e.currentTarget.value)}
            data={(types.data ?? []).map((x) => ({
              value: x.id,
              label: (i18n.language === 'en' && x.nameEn) || x.nameAr,
            }))}
          />
          <NativeSelect
            label={t('payroll.run.currency')}
            value={cur}
            onChange={(e) => setCurrency(e.currentTarget.value)}
            data={codes}
          />
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('loans.invoiceDate')}</Table.Th>
              <Table.Th>{t('loans.reference')}</Table.Th>
              <Table.Th>{t('loans.principal')}</Table.Th>
              <Table.Th>{t('loans.attachments.column')}</Table.Th>
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((it, n) => (
              <Table.Tr key={n}>
                <Table.Td>
                  <TextInput
                    type="date"
                    value={it.eventDate}
                    onChange={(e) => set(n, { eventDate: e.currentTarget.value })}
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    value={it.reference}
                    onChange={(e) => set(n, { reference: e.currentTarget.value })}
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    dir="ltr"
                    value={it.amount}
                    onChange={(e) => set(n, { amount: e.currentTarget.value })}
                  />
                </Table.Td>
                <Table.Td>
                  <FileInput
                    aria-label={t('loans.attachments.file')}
                    accept={LOAN_ACCEPT}
                    value={it.file}
                    onChange={(f) => set(n, { file: f })}
                    clearable
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={t('common.delete')}
                    disabled={items.length === 1}
                    onClick={() => setItems(items.filter((_, i) => i !== n))}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="space-between">
          <Button
            variant="subtle"
            leftSection={<IconPlus size={16} />}
            disabled={items.length >= 100}
            onClick={() =>
              setItems([...items, { eventDate: today(), reference: '', amount: '', file: null }])
            }
          >
            {t('loans.addRow')}
          </Button>
          <Text size="sm" dir="ltr">{`${t('loans.total')}: ${total.toFixed(2)} ${cur}`}</Text>
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!valid || !emp || !cur || !type}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
