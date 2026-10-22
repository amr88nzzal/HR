import {
  Badge,
  Button,
  Group,
  NativeSelect,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { useLookup } from '../employees/shared';
import { useLoanTypes } from './loan-types-api';

type Cell = { amount: string; refs: string[] };
type GridRow = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  typeId: string;
  typeNameAr: string;
  typeNameEn: string;
  color: string;
  currency: string;
  cells: Record<string, Cell>;
  taken: string;
  due: string;
  closing: string;
};
type Grid = {
  days: { day: number; kind: 'work' | 'weekend' | 'holiday' }[];
  types: { id: string; nameAr: string; nameEn: string; color: string }[];
  rows: GridRow[];
  totals: Record<
    string,
    { perDay: Record<string, string>; taken: string; due: string; closing: string }
  >;
};

const SHADE = {
  work: undefined,
  weekend: 'var(--mantine-color-gray-2)',
  holiday: 'var(--mantine-color-red-1)',
} as const;
const fmt = (v: string) => {
  const n = Number(v);
  return n === 0 ? '' : n.toLocaleString('en', { maximumFractionDigits: 2 });
};
/** لون النوع خفيفاً ليبقى الرقم مقروءاً في الوضعين الفاتح والداكن. / The type colour, lightened so numbers stay readable. */
const tint = (hex: string) => `${hex}40`;

/**
 * جدول السلف والقروض والذمم بحسب أيام الشهر: صف لكل (موظف، نوع) واسم الموظف مدموج على صفوف أنواعه.
 * Loans/advances/receivables by day of month: a row per (employee, type) with the name merged across them.
 */
export const LoansGridPage = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [status, setStatus] = useState('');
  const types = useLoanTypes();
  const departments = useLookup('/departments', 'org.department.read');
  const branches = useLookup('/branches', 'system.branch.read');
  const [year, mon] = month.split('-').map(Number);
  const query = {
    year,
    month: mon,
    employeeId: employeeId ?? undefined,
    departmentId: departmentId || undefined,
    branchId: branchId || undefined,
    typeId: typeId || undefined,
    status: status || undefined,
  };
  const grid = useQuery({
    queryKey: ['/payroll', 'loans-grid', query],
    enabled: Boolean(year && mon),
    queryFn: async () => (await api.get<Grid>('/payroll/loans-grid', query)).data,
  });
  const download = async (format: 'xlsx' | 'pdf') => {
    try {
      downloadBlob(
        await api.blob('/payroll/loans-grid', { ...query, format, lang }),
        `loans-grid-${month}.${format}`,
      );
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  const g = grid.data;
  const byEmp = new Map<string, GridRow[]>();
  for (const r of g?.rows ?? []) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
  const name = (r: { typeNameAr: string; typeNameEn: string }) =>
    (lang === 'en' && r.typeNameEn) || r.typeNameAr;
  const legendName = (r: { nameAr: string; nameEn: string }) =>
    (lang === 'en' && r.nameEn) || r.nameAr;
  const th = { textAlign: 'center', padding: '4px 6px', whiteSpace: 'nowrap' } as const;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.payrollLoansGrid')}</Title>
        <Group>
          <Button
            variant="default"
            onClick={() => void download('xlsx')}
            disabled={!g?.rows.length}
          >
            Excel
          </Button>
          <Button variant="default" onClick={() => void download('pdf')} disabled={!g?.rows.length}>
            PDF
          </Button>
        </Group>
      </Group>
      <Group align="flex-end">
        <TextInput
          type="month"
          label={t('loansGrid.month')}
          value={month}
          onChange={(e) => setMonth(e.currentTarget.value)}
        />
        <EmployeeSelect
          label={t('payroll.run.employee')}
          value={employeeId}
          onChange={setEmployeeId}
        />
        <NativeSelect
          label={t('loansGrid.department')}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.currentTarget.value)}
          data={[{ value: '', label: t('loansGrid.all') }, ...departments.options]}
        />
        <NativeSelect
          label={t('loansGrid.branch')}
          value={branchId}
          onChange={(e) => setBranchId(e.currentTarget.value)}
          data={[{ value: '', label: t('loansGrid.all') }, ...branches.options]}
        />
        <NativeSelect
          label={t('loans.kind')}
          value={typeId}
          onChange={(e) => setTypeId(e.currentTarget.value)}
          data={[
            { value: '', label: t('loansGrid.all') },
            ...(types.data ?? []).map((x) => ({
              value: x.id,
              label: (lang === 'en' && x.nameEn) || x.nameAr,
            })),
          ]}
        />
        <NativeSelect
          label={t('payroll.run.status')}
          value={status}
          onChange={(e) => setStatus(e.currentTarget.value)}
          data={[
            { value: '', label: t('loansGrid.all') },
            ...(['active', 'settled', 'cancelled'] as const).map((s) => ({
              value: s,
              label: t(`loans.statuses.${s}`),
            })),
          ]}
        />
      </Group>
      {g && g.types.length > 0 && (
        <Group gap="xs" aria-label={t('loansGrid.legend')}>
          {g.types.map((ty) => (
            <Badge
              key={ty.id}
              variant="outline"
              style={{ backgroundColor: tint(ty.color), borderColor: ty.color, color: 'inherit' }}
            >
              {legendName(ty)}
            </Badge>
          ))}
        </Group>
      )}
      <ScrollArea>
        <Table withTableBorder withColumnBorders style={{ fontSize: 12 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={th}>{t('payroll.run.employee')}</Table.Th>
              <Table.Th style={th}>{t('loans.kind')}</Table.Th>
              {g?.days.map((d) => (
                <Table.Th key={d.day} style={{ ...th, background: SHADE[d.kind] }}>
                  {d.day}
                </Table.Th>
              ))}
              <Table.Th style={th}>{t('loansGrid.taken')}</Table.Th>
              <Table.Th style={th}>{t('loansGrid.due')}</Table.Th>
              <Table.Th style={th}>{t('loansGrid.closing')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...byEmp.values()].flatMap((list) =>
              list.map((r, i) => (
                <Table.Tr key={`${r.employeeId}-${r.typeId}-${r.currency}`}>
                  {i === 0 && (
                    <Table.Td
                      rowSpan={list.length}
                      style={{ verticalAlign: 'middle', fontWeight: 600 }}
                    >
                      {r.employeeName}
                      <Text size="xs" c="dimmed">
                        {r.employeeNo}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td style={{ background: tint(r.color), whiteSpace: 'nowrap' }}>
                    {name(r)}
                  </Table.Td>
                  {g?.days.map((d) => {
                    const c = r.cells[String(d.day)];
                    return (
                      <Table.Td
                        key={d.day}
                        dir="ltr"
                        style={{
                          textAlign: 'center',
                          background: c ? tint(r.color) : SHADE[d.kind],
                        }}
                      >
                        {c ? (
                          <Tooltip label={c.refs.join(', ')} disabled={!c.refs.length}>
                            <span>{fmt(c.amount)}</span>
                          </Tooltip>
                        ) : null}
                      </Table.Td>
                    );
                  })}
                  <Table.Td dir="ltr">{fmt(r.taken)}</Table.Td>
                  <Table.Td dir="ltr">{fmt(r.due)}</Table.Td>
                  <Table.Td dir="ltr">{fmt(r.closing)}</Table.Td>
                </Table.Tr>
              )),
            )}
          </Table.Tbody>
          {g && g.rows.length > 0 && (
            <Table.Tfoot>
              {Object.entries(g.totals).map(([cur, tt]) => (
                <Table.Tr key={cur} style={{ fontWeight: 700 }}>
                  <Table.Td colSpan={2}>{`${t('loansGrid.total')} ${cur}`}</Table.Td>
                  {g.days.map((d) => (
                    <Table.Td key={d.day} dir="ltr" style={{ textAlign: 'center' }}>
                      {fmt(tt.perDay[String(d.day)] ?? '0')}
                    </Table.Td>
                  ))}
                  <Table.Td dir="ltr">{fmt(tt.taken)}</Table.Td>
                  <Table.Td dir="ltr">{fmt(tt.due)}</Table.Td>
                  <Table.Td dir="ltr">{fmt(tt.closing)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tfoot>
          )}
        </Table>
      </ScrollArea>
      {g && g.rows.length === 0 && <Text c="dimmed">{t('loansGrid.empty')}</Text>}
    </Stack>
  );
};
