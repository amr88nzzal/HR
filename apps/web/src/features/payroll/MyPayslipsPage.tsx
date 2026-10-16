import { ActionIcon, Button, Card, Drawer, Group, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { downloadBlob } from '../../lib/export';
import { errorMessage } from '../../lib/errors';

type Slip = {
  id: string;
  year: number;
  month: number;
  currency: string;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
};
type Line = { code: string; nameAr: string; nameEn: string | null; amount: string };
type Detail = {
  id: string;
  year: number;
  month: number;
  currency: string;
  gross: string;
  deductions: string;
  net: string;
  loans: string;
  payable: string;
  earnings: Line[];
  deductionLines: Line[];
  loanItems: { amount: string; overCap: boolean; no: number; count: number }[];
};

const HIDDEN = '••••••';
const period = (s: { year: number; month: number }) =>
  `${s.year}-${String(s.month).padStart(2, '0')}`;
const fmt = (v: string) => {
  const [i = '0', d = ''] = Number(v).toFixed(4).replace(/0+$/, '').split('.');
  return `${i}.${d.padEnd(2, '0')}`;
};

/** رقم مخفي افتراضياً حتى يضغط الموظف «إظهار» (حماية من النظر العابر) */
const Money = ({ value, show }: { value: string; show: boolean }) => (
  <Text span dir="ltr" ff="monospace">
    {show ? fmt(value) : HIDDEN}
  </Text>
);

export const MyPayslipsPage = () => {
  const { t, i18n } = useTranslation();
  const [show, setShow] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['/me/payslips'],
    queryFn: async () => (await api.get<Slip[]>('/me/payslips')).data,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['/me/payslips', openId],
    queryFn: async () => (await api.get<Detail>(`/me/payslips/${openId}`)).data,
    enabled: openId !== null,
  });
  const download = async (s: { id: string; year: number; month: number }) => {
    try {
      const blob = await api.blob(`/me/payslips/${s.id}/pdf`, { lang: i18n.language });
      downloadBlob(blob, `payslip-${period(s)}.pdf`);
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  const label = (l: Line) => (i18n.language === 'en' ? l.nameEn || l.nameAr : l.nameAr);
  const d = detail.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{t('payslips.title')}</Title>
        <Button
          variant="default"
          leftSection={show ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          onClick={() => setShow((v) => !v)}
        >
          {show ? t('payslips.hide') : t('payslips.reveal')}
        </Button>
      </Group>
      {list.isError && <Text c="dimmed">{errorMessage(list.error, t)}</Text>}
      {list.data?.length === 0 && <Text c="dimmed">{t('payslips.empty')}</Text>}
      {!!list.data?.length && (
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('payslips.period')}</Table.Th>
              <Table.Th>{t('payslips.net')}</Table.Th>
              <Table.Th>{t('payslips.payable')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.data.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td dir="ltr">{period(s)}</Table.Td>
                <Table.Td>
                  <Money value={s.net} show={show} /> {s.currency}
                </Table.Td>
                <Table.Td>
                  <Money value={s.payable} show={show} /> {s.currency}
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="light" onClick={() => setOpenId(s.id)}>
                      {t('payslips.view')}
                    </Button>
                    <Button size="xs" variant="default" onClick={() => void download(s)}>
                      PDF
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Drawer
        opened={openId !== null}
        onClose={() => setOpenId(null)}
        position={i18n.dir() === 'rtl' ? 'left' : 'right'}
        size="md"
        title={d ? `${t('payslips.title')} ${period(d)}` : t('payslips.title')}
      >
        {d && (
          <Stack>
            <Group justify="space-between">
              <ActionIcon
                variant="subtle"
                aria-label={show ? t('payslips.hide') : t('payslips.reveal')}
                onClick={() => setShow((v) => !v)}
              >
                {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </ActionIcon>
              <Button size="xs" variant="default" onClick={() => void download(d)}>
                PDF
              </Button>
            </Group>
            {(
              [
                ['earnings', d.earnings],
                ['deductions', d.deductionLines],
              ] as const
            ).map(([k, lines]) =>
              lines.length ? (
                <Card key={k} withBorder padding="sm">
                  <Text fw={600} mb="xs">
                    {t(`payslips.${k}`)}
                  </Text>
                  {lines.map((l) => (
                    <Group key={l.code} justify="space-between">
                      <Text size="sm">{label(l)}</Text>
                      <Money value={l.amount} show={show} />
                    </Group>
                  ))}
                </Card>
              ) : null,
            )}
            <Card withBorder padding="sm">
              {(
                [
                  ['gross', d.gross],
                  ['totalDeductions', d.deductions],
                  ['net', d.net],
                  ...(d.loanItems.length
                    ? ([
                        ['loans', d.loans],
                        ['payable', d.payable],
                      ] as const)
                    : []),
                ] as const
              ).map(([k, v]) => (
                <Group key={k} justify="space-between">
                  <Text size="sm" fw={k === 'net' || k === 'payable' ? 700 : 400}>
                    {t(`payslips.${k}`)}
                  </Text>
                  <Money value={v} show={show} />
                </Group>
              ))}
            </Card>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
};
