import { Badge, Button, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPrinter } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { downloadSlip, printSlip } from './payslipPrint';

interface Row {
  id: string;
  year: number;
  month: number;
  period_status: string;
  currency: string;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
}

const ym = (r: { year: number; month: number }): string =>
  `${r.year}-${String(r.month).padStart(2, '0')}`;

/** تبويب «قسائم الراتب» في بطاقة الموظف: قائمة الأشهر مع عرض/طباعة/تحميل، وفلتر شهر. */
export const EmployeePayslipsTab = ({ employeeId }: { employeeId: string }) => {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState('');
  const q = useQuery({
    queryKey: ['/payroll', 'employee-payslips', employeeId],
    queryFn: async () => (await api.get<Row[]>(`/payroll/employees/${employeeId}/payslips`)).data,
  });
  const rows = (q.data ?? []).filter((r) => !month || ym(r) === month);
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  if (q.isLoading) return <Loader size="sm" />;
  return (
    <Stack>
      <Group>
        <TextInput
          type="month"
          label={t('hr.emp.payslips.month')}
          value={month}
          onChange={(e) => setMonth(e.currentTarget.value)}
        />
        {month && (
          <Button variant="subtle" mt={24} onClick={() => setMonth('')}>
            {t('hr.emp.payslips.all')}
          </Button>
        )}
      </Group>
      {rows.length === 0 ? (
        <Text c="dimmed">{t('hr.emp.payslips.empty')}</Text>
      ) : (
        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('hr.emp.payslips.period')}</Table.Th>
              <Table.Th>{t('hr.emp.payslips.gross')}</Table.Th>
              <Table.Th>{t('hr.emp.payslips.deductions')}</Table.Th>
              <Table.Th>{t('hr.emp.payslips.net')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  {ym(r)}{' '}
                  <Badge size="xs" variant="light">
                    {r.period_status}
                  </Badge>
                </Table.Td>
                <Table.Td dir="ltr">{r.gross}</Table.Td>
                <Table.Td dir="ltr">{r.deductions}</Table.Td>
                <Table.Td dir="ltr" fw={600}>
                  {r.payable} {r.currency}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap" justify="flex-end">
                    <Button
                      size="compact-sm"
                      leftSection={<IconPrinter size={14} />}
                      onClick={() => run(() => printSlip(r.id, i18n.language))}
                    >
                      {t('hr.emp.payslips.print')}
                    </Button>
                    <Button
                      size="compact-sm"
                      variant="default"
                      leftSection={<IconDownload size={14} />}
                      onClick={() =>
                        run(() => downloadSlip(r.id, i18n.language, `payslip-${ym(r)}.pdf`))
                      }
                    >
                      PDF
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
};
