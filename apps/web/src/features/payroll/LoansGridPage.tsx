import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  NativeSelect,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronLeft, IconChevronRight, IconFilter, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
  weekend: 'light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))',
  holiday: 'light-dark(var(--mantine-color-red-1), var(--mantine-color-red-9))',
} as const;
const fmt = (v: string | number) => {
  const n = Number(v);
  return n === 0 ? '' : n.toLocaleString('en', { maximumFractionDigits: 2 });
};
/** لون النوع خفيفاً ليبقى الرقم مقروءاً في الوضعين الفاتح والداكن. / The type colour, lightened so numbers stay readable. */
const tint = (hex: string) => `${hex}59`;
const pad = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (ym: string, by: number): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** خلية اليوم: مجموع كل الأنواع وتفصيلها / One day cell: the total across types and its breakdown. */
type DayPart = {
  typeNameAr: string;
  typeNameEn: string;
  color: string;
  amount: number;
  refs: string[];
};
type EmpRow = {
  key: string;
  employeeNo: string;
  employeeName: string;
  currency: string;
  days: Record<string, DayPart[]>;
  parts: {
    typeNameAr: string;
    typeNameEn: string;
    color: string;
    taken: number;
    due: number;
    closing: number;
  }[];
  taken: number;
  due: number;
  closing: number;
};

/** دمج صفوف (موظف، نوع) في صف واحد لكل (موظف، عملة) / Merge (employee, type) rows into one per (employee, currency). */
const mergeRows = (rows: GridRow[]): EmpRow[] => {
  const out = new Map<string, EmpRow>();
  for (const r of rows) {
    const key = `${r.employeeId}-${r.currency}`;
    const e: EmpRow = out.get(key) ?? {
      key,
      employeeNo: r.employeeNo,
      employeeName: r.employeeName,
      currency: r.currency,
      days: {},
      parts: [],
      taken: 0,
      due: 0,
      closing: 0,
    };
    for (const [d, c] of Object.entries(r.cells))
      (e.days[d] ??= []).push({
        typeNameAr: r.typeNameAr,
        typeNameEn: r.typeNameEn,
        color: r.color,
        amount: Number(c.amount),
        refs: c.refs,
      });
    e.parts.push({
      typeNameAr: r.typeNameAr,
      typeNameEn: r.typeNameEn,
      color: r.color,
      taken: Number(r.taken),
      due: Number(r.due),
      closing: Number(r.closing),
    });
    e.taken += Number(r.taken);
    e.due += Number(r.due);
    e.closing += Number(r.closing);
    out.set(key, e);
  }
  return [...out.values()];
};

/** خلفية مقسَّمة بألوان الأنواع بنسبة مبالغها / Background split by type colours in proportion to amounts. */
const splitBg = (parts: DayPart[]): string => {
  const total = parts.reduce((a, p) => a + p.amount, 0) || 1;
  let acc = 0;
  const stops = parts.map((p) => {
    const from = acc;
    acc += (p.amount / total) * 100;
    return `${tint(p.color)} ${from}% ${acc}%`;
  });
  return stops.length === 1
    ? tint(parts[0]!.color)
    : `linear-gradient(to right, ${stops.join(', ')})`;
};

const stickyCol = {
  position: 'sticky',
  insetInlineStart: 0,
  zIndex: 2,
  background: 'var(--mantine-color-body)',
} as const;

/**
 * جدول السلف والقروض والذمم بحسب أيام الشهر: صف لكل موظف، وخلية اليوم تجمع كل الأنواع بألوان مقسَّمة وتفصيل عند المرور.
 * Loans/advances/receivables by day: a row per employee; each day cell sums all types with split colours and a hover breakdown.
 */
export const LoansGridPage = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [month, setMonth] = useState(thisMonth);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [status, setStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);
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
  const rows = useMemo(() => mergeRows(g?.rows ?? []), [g]);
  const typeName = (r: { typeNameAr: string; typeNameEn: string }) =>
    (lang === 'en' && r.typeNameEn) || r.typeNameAr;
  const legendName = (r: { nameAr: string; nameEn: string }) =>
    (lang === 'en' && r.nameEn) || r.nameAr;
  const today = month === thisMonth ? now.getDate() : 0;
  const multi = Object.keys(g?.totals ?? {}).length > 1;
  const chips: { label: string; clear: () => void }[] = [
    ...(departmentId
      ? [
          {
            label: departments.options.find((o) => o.value === departmentId)?.label ?? '',
            clear: () => setDepartmentId(''),
          },
        ]
      : []),
    ...(branchId
      ? [
          {
            label: branches.options.find((o) => o.value === branchId)?.label ?? '',
            clear: () => setBranchId(''),
          },
        ]
      : []),
    ...(typeId
      ? [
          {
            label: legendName(g?.types.find((x) => x.id === typeId) ?? { nameAr: '', nameEn: '' }),
            clear: () => setTypeId(''),
          },
        ]
      : []),
    ...(status ? [{ label: t(`loans.statuses.${status}`), clear: () => setStatus('') }] : []),
    ...(employeeId ? [{ label: t('payroll.run.employee'), clear: () => setEmployeeId(null) }] : []),
  ];
  const reset = () => {
    setDepartmentId('');
    setBranchId('');
    setTypeId('');
    setStatus('');
    setEmployeeId(null);
  };
  const th = {
    textAlign: 'center',
    padding: '6px 6px',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 3,
    background: 'var(--mantine-color-body)',
  } as const;
  const empCount = new Set((g?.rows ?? []).map((r) => r.employeeId)).size;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.payrollLoansGrid')}</Title>
        <Group>
          <Button variant="default" onClick={() => void download('xlsx')} disabled={!rows.length}>
            Excel
          </Button>
          <Button variant="default" onClick={() => void download('pdf')} disabled={!rows.length}>
            PDF
          </Button>
        </Group>
      </Group>
      <Group align="flex-end" gap="xs">
        <ActionIcon
          variant="default"
          size="lg"
          aria-label={t('loansGrid.prev')}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          {lang === 'ar' ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
        </ActionIcon>
        <TextInput
          type="month"
          label={t('loansGrid.month')}
          value={month}
          onChange={(e) => e.currentTarget.value && setMonth(e.currentTarget.value)}
        />
        <ActionIcon
          variant="default"
          size="lg"
          aria-label={t('loansGrid.next')}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          {lang === 'ar' ? <IconChevronLeft size={18} /> : <IconChevronRight size={18} />}
        </ActionIcon>
        <Button variant="subtle" disabled={month === thisMonth} onClick={() => setMonth(thisMonth)}>
          {t('loansGrid.thisMonth')}
        </Button>
        <Button
          variant={chips.length ? 'light' : 'default'}
          leftSection={<IconFilter size={16} />}
          rightSection={
            chips.length ? (
              <Badge size="xs" circle>
                {chips.length}
              </Badge>
            ) : null
          }
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          {t('loansGrid.filters')}
        </Button>
      </Group>
      <Collapse expanded={showFilters}>
        <Group align="flex-end">
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
      </Collapse>
      {chips.length > 0 && (
        <Group gap="xs">
          {chips.map((c) => (
            <Badge
              key={c.label}
              variant="light"
              rightSection={
                <ActionIcon size="xs" variant="transparent" onClick={c.clear} aria-label="×">
                  <IconX size={10} />
                </ActionIcon>
              }
            >
              {c.label}
            </Badge>
          ))}
          <Button size="compact-xs" variant="subtle" onClick={reset}>
            {t('loansGrid.reset')}
          </Button>
        </Group>
      )}
      {g && rows.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          {(
            [
              ['employees', String(empCount), ''],
              ...(['taken', 'due', 'closing'] as const).map((k) => [
                k,
                Object.entries(g.totals)
                  .map(([cur, tt]) => `${fmt(tt[k]) || '0'}${multi ? ` ${cur}` : ''}`)
                  .join(' · '),
                Object.keys(g.totals)[0] ?? '',
              ]),
            ] as [string, string, string][]
          ).map(([k, v, cur]) => (
            <Card key={k} withBorder padding="sm">
              <Text size="xs" c="dimmed">
                {t(`loansGrid.${k}`)}
              </Text>
              <Text fw={700} size="lg" dir="ltr" ta="start">
                {v}
                {!multi && cur && k !== 'employees' ? ` ${cur}` : ''}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      )}
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
      <div
        style={{
          overflow: 'auto',
          maxHeight: 'calc(100vh - 340px)',
          minHeight: 200,
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-sm)',
        }}
      >
        <Table withColumnBorders style={{ fontSize: 12 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                style={{ ...th, ...stickyCol, zIndex: 4, minWidth: 150, textAlign: 'start' }}
              >
                {t('payroll.run.employee')}
              </Table.Th>
              {g?.days.map((d) => (
                <Table.Th
                  key={d.day}
                  style={{
                    ...th,
                    background: SHADE[d.kind] ?? th.background,
                    ...(d.day === today
                      ? { background: 'var(--mantine-primary-color-filled)', color: 'white' }
                      : {}),
                  }}
                >
                  {d.day}
                </Table.Th>
              ))}
              <Table.Th style={th}>{t('loansGrid.taken')}</Table.Th>
              <Table.Th style={th}>{t('loansGrid.due')}</Table.Th>
              <Table.Th style={th}>{t('loansGrid.closing')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r, idx) => (
              <Table.Tr key={r.key}>
                <Table.Td
                  style={{
                    ...stickyCol,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    boxShadow: 'inset -1px 0 0 var(--mantine-color-default-border)',
                  }}
                >
                  {r.employeeName}
                  <Text size="xs" c="dimmed">
                    {r.employeeNo}
                    {multi ? ` · ${r.currency}` : ''}
                  </Text>
                </Table.Td>
                {g?.days.map((d) => {
                  const parts = r.days[String(d.day)];
                  const total = parts?.reduce((a, p) => a + p.amount, 0) ?? 0;
                  return (
                    <Table.Td
                      key={d.day}
                      dir="ltr"
                      style={{
                        textAlign: 'center',
                        padding: '4px 6px',
                        background: parts
                          ? splitBg(parts)
                          : (SHADE[d.kind] ??
                            (idx % 2
                              ? 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))'
                              : undefined)),
                        outline:
                          d.day === today
                            ? '2px solid var(--mantine-primary-color-filled)'
                            : undefined,
                        outlineOffset: -2,
                        fontWeight: parts ? 600 : undefined,
                      }}
                    >
                      {parts ? (
                        <Tooltip
                          multiline
                          withArrow
                          label={
                            <Stack gap={2}>
                              {parts.map((p, i) => (
                                <Text key={i} size="xs" c="white">
                                  {`${typeName(p)}: ${fmt(p.amount)}${p.refs.length ? ` (${p.refs.join(', ')})` : ''}`}
                                </Text>
                              ))}
                              {parts.length > 1 && (
                                <Text size="xs" c="white" fw={700}>
                                  {`${t('loansGrid.total')}: ${fmt(total)}`}
                                </Text>
                              )}
                            </Stack>
                          }
                        >
                          <span style={{ cursor: 'default' }}>{fmt(total)}</span>
                        </Tooltip>
                      ) : null}
                    </Table.Td>
                  );
                })}
                {(['taken', 'due', 'closing'] as const).map((k) => (
                  <Table.Td key={k} dir="ltr" style={{ textAlign: 'center', fontWeight: 600 }}>
                    <Tooltip
                      multiline
                      withArrow
                      disabled={r.parts.length < 2}
                      label={
                        <Stack gap={2}>
                          {r.parts.map((p, i) => (
                            <Text key={i} size="xs" c="white">
                              {`${typeName(p)}: ${fmt(p[k]) || '0'}`}
                            </Text>
                          ))}
                        </Stack>
                      }
                    >
                      <span>{fmt(r[k])}</span>
                    </Tooltip>
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
          {g && rows.length > 0 && (
            <Table.Tfoot>
              {Object.entries(g.totals).map(([cur, tt]) => (
                <Table.Tr key={cur} style={{ fontWeight: 700 }}>
                  <Table.Td style={{ ...stickyCol, bottom: 0, position: 'sticky' }}>
                    {`${t('loansGrid.total')} ${cur}`}
                  </Table.Td>
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
      </div>
      {g && rows.length === 0 && <Text c="dimmed">{t('loansGrid.empty')}</Text>}
    </Stack>
  );
};
