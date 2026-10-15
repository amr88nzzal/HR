import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import type { PaymentRow } from './loans-types';
import { MarkPaidModal } from './MarkPaidModal';

/** دفعات رواتب دورة معتمدة: الحالة والطريقة والمرجع، تعليم بالجملة، وتصدير CSV. */
export const PaymentsPanel = ({ periodId }: { periodId: string }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('payroll.payment.manage');
  const [marking, setMarking] = useState<string[] | null>(null);
  const list = useQuery({
    queryKey: ['/payroll', 'payments', periodId],
    queryFn: async () =>
      (await api.get<PaymentRow[]>('/payroll/payments', { periodId, pageSize: 200 })).data,
  });
  const unmark = useMutation({
    mutationFn: async (id: string) => api.post(`/payroll/payments/${id}/unmark`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/payroll'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const exportCsv = async () => {
    try {
      const blob = await api.blob(`/payroll/periods/${periodId}/payments.csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'payments.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  const rows = list.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  return (
    <Stack>
      <Group>
        <Button variant="default" onClick={() => void exportCsv()}>
          {t('loans.exportCsv')}
        </Button>
        {manage && pending.length > 0 && (
          <Button onClick={() => setMarking(pending)}>
            {t('loans.markAllPaid', { n: pending.length })}
          </Button>
        )}
      </Group>
      {rows.length === 0 && <Text c="dimmed">{t('loans.noPayments')}</Text>}
      {rows.length > 0 && (
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('payroll.run.employee')}</Table.Th>
              <Table.Th>{t('loans.payableAmount')}</Table.Th>
              <Table.Th>{t('payroll.run.status')}</Table.Th>
              <Table.Th>{t('loans.method')}</Table.Th>
              <Table.Th>{t('loans.reference')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{`${r.employeeNo ?? ''} · ${r.employeeName}`}</Table.Td>
                <Table.Td dir="ltr">{`${r.amount} ${r.currency}`}</Table.Td>
                <Table.Td>
                  <Badge color={r.status === 'paid' ? 'teal' : 'gray'}>
                    {t(`loans.paymentStatus.${r.status}`)}
                  </Badge>
                </Table.Td>
                <Table.Td>{r.method ? t(`loans.methods.${r.method}`) : ''}</Table.Td>
                <Table.Td dir="ltr">{r.reference ?? ''}</Table.Td>
                <Table.Td>
                  {manage &&
                    (r.status === 'pending' ? (
                      <Button size="compact-xs" onClick={() => setMarking([r.id])}>
                        {t('loans.markPaid')}
                      </Button>
                    ) : (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => unmark.mutate(r.id)}
                      >
                        {t('loans.unmark')}
                      </Button>
                    ))}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {marking && <MarkPaidModal ids={marking} onClose={() => setMarking(null)} />}
    </Stack>
  );
};
