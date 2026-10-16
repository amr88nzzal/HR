import { Badge, Group, NumberInput, Switch, Table, Text } from '@mantine/core';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type CompareLine = {
  code: string;
  nameAr: string;
  kind: string;
  cur: string;
  prev: string;
  diff: string;
  pct: string | null;
};
export type CompareRow = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  net: string | null;
  prevNet: string | null;
  diff: string;
  pct: string | null;
  lines: CompareLine[];
  loans: string;
  prevLoans: string;
};

/** الزيادة في الاستحقاق خير، وفي الاستقطاع شر: اللون يتبع أثرها على الموظف لا إشارة الرقم */
export const lineColor = (kind: string, diff: string): string => {
  const d = Number(diff);
  if (d === 0) return 'dimmed';
  const good = kind === 'deduction' ? d < 0 : d > 0;
  return good ? 'teal' : 'red';
};

/** هل الفرق كبير؟ نسبة غير معرّفة (السابق صفر) تُعدّ كبيرة دائماً */
export const isBig = (pct: string | null, threshold: number): boolean =>
  pct === null || Math.abs(Number(pct)) >= threshold;

const pctText = (p: string | null) => (p === null ? '—' : `${Number(p).toFixed(1)}%`);

export const ComparePanel = ({ rows }: { rows: CompareRow[] }) => {
  const { t } = useTranslation();
  const [onlyBig, setOnlyBig] = useState(false);
  const [threshold, setThreshold] = useState<number>(10);
  const [open, setOpen] = useState<string | null>(null);
  const shown = onlyBig ? rows.filter((r) => isBig(r.pct, threshold)) : rows;
  return (
    <>
      <Group mb="sm">
        <Switch
          label={t('payslips.cmp.onlyBig')}
          checked={onlyBig}
          onChange={(e) => setOnlyBig(e.currentTarget.checked)}
        />
        {onlyBig && (
          <NumberInput
            w={180}
            min={0}
            max={1000}
            value={threshold}
            label={t('payslips.cmp.threshold')}
            onChange={(v) => setThreshold(Number(v) || 0)}
          />
        )}
      </Group>
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('payroll.run.employee')}</Table.Th>
            <Table.Th>{t('payroll.run.prevNet')}</Table.Th>
            <Table.Th>{t('payroll.run.net')}</Table.Th>
            <Table.Th>{t('payroll.run.diff')}</Table.Th>
            <Table.Th>{t('payslips.cmp.pct')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {shown.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text c="dimmed" ta="center">
                  {t('payslips.cmp.none')}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {shown.map((r) => {
            const isOpen = open === r.employeeId;
            const loansDiff = (Number(r.loans) - Number(r.prevLoans)).toFixed(4);
            return (
              <Fragment key={r.employeeId}>
                <Table.Tr
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpen(isOpen ? null : r.employeeId)}
                  aria-expanded={isOpen}
                >
                  <Table.Td>{`${r.employeeNo} · ${r.employeeName}`}</Table.Td>
                  <Table.Td dir="ltr">{r.prevNet ?? '—'}</Table.Td>
                  <Table.Td dir="ltr">{r.net ?? '—'}</Table.Td>
                  <Table.Td dir="ltr" c={lineColor('earning', r.diff)}>
                    {r.diff}
                  </Table.Td>
                  <Table.Td dir="ltr">
                    <Badge
                      variant="light"
                      color={isBig(r.pct, threshold) ? lineColor('earning', r.diff) : 'gray'}
                    >
                      {pctText(r.pct)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
                {isOpen &&
                  r.lines.map((l) => (
                    <Table.Tr
                      key={`${r.employeeId}-${l.kind}-${l.code}`}
                      bg="var(--mantine-color-gray-light)"
                    >
                      <Table.Td ps="xl">{l.nameAr}</Table.Td>
                      <Table.Td dir="ltr">{l.prev}</Table.Td>
                      <Table.Td dir="ltr">{l.cur}</Table.Td>
                      <Table.Td dir="ltr" c={lineColor(l.kind, l.diff)}>
                        {l.diff}
                      </Table.Td>
                      <Table.Td dir="ltr">{pctText(l.pct)}</Table.Td>
                    </Table.Tr>
                  ))}
                {isOpen && Number(loansDiff) !== 0 && (
                  <Table.Tr bg="var(--mantine-color-gray-light)">
                    <Table.Td ps="xl">{t('payslips.cmp.loansLine')}</Table.Td>
                    <Table.Td dir="ltr">{r.prevLoans}</Table.Td>
                    <Table.Td dir="ltr">{r.loans}</Table.Td>
                    <Table.Td dir="ltr" c={lineColor('deduction', loansDiff)}>
                      {loansDiff}
                    </Table.Td>
                    <Table.Td />
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </>
  );
};
