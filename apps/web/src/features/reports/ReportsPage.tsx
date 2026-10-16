import {
  Badge,
  Button,
  Card,
  Group,
  MultiSelect,
  NavLink,
  Pagination,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../../api/client';
import { useList } from '../../api/hooks';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';
import { useFormat } from '../../lib/useFormat';
import {
  FORMATS,
  cellView,
  type Filter,
  type Format,
  type Layout,
  type Manifest,
  type RunRow,
} from './types';

const MODULES = ['employees', 'leave', 'attendance', 'payroll'] as const;
const REF_PATH: Record<NonNullable<Filter['ref']>, string> = {
  branches: '/branches',
  departments: '/departments',
  'leave-types': '/leave-types',
  'payroll-periods': '/payroll/periods',
};

type Named = { id: string; nameAr?: string; nameEn?: string | null; year?: number; month?: number };
const refLabel = (r: Named, lang: string): string =>
  r.year
    ? `${r.year}-${String(r.month).padStart(2, '0')}`
    : (lang === 'en' ? r.nameEn || r.nameAr : r.nameAr) || r.id;

const RefSelect = ({
  f,
  value,
  onChange,
}: {
  f: Filter;
  value: string;
  onChange: (v: string) => void;
}) => {
  const { i18n } = useTranslation();
  const list = useList<Named>(REF_PATH[f.ref!], { pageSize: 200 });
  const label = i18n.language === 'en' ? f.labelEn : f.labelAr;
  return (
    <Select
      label={label}
      clearable
      searchable
      value={value || null}
      onChange={(v) => onChange(v ?? '')}
      data={(list.data?.data ?? []).map((r) => ({
        value: r.id,
        label: refLabel(r, i18n.language),
      }))}
    />
  );
};

const FilterField = ({
  f,
  value,
  onChange,
}: {
  f: Filter;
  value: string;
  onChange: (v: string) => void;
}) => {
  const { t, i18n } = useTranslation();
  const label = i18n.language === 'en' ? f.labelEn : f.labelAr;
  if (f.type === 'uuid' && f.ref) return <RefSelect f={f} value={value} onChange={onChange} />;
  if (f.type === 'select')
    return (
      <Select
        label={label}
        clearable
        placeholder={t('reports.all')}
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        data={(f.options ?? []).map((o) => ({
          value: o.value,
          label: i18n.language === 'en' ? o.labelEn : o.labelAr,
        }))}
      />
    );
  return (
    <TextInput
      label={label}
      withAsterisk={f.required}
      type={f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'text'}
      inputMode={f.type === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
};

const ReportView = ({ code }: { code: string }) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const fmt = useFormat();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const detail = useQuery({
    queryKey: ['/reports', code],
    queryFn: async () =>
      (await api.get<{ manifest: Manifest; layouts: Layout[] }>(`/reports/${code}`)).data,
  });
  const manifest = detail.data?.manifest;
  const layouts = detail.data?.layouts ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState<{ v: Record<string, string>; c: string[] } | null>(null);
  const [layoutName, setLayoutName] = useState('');

  useEffect(() => {
    if (!manifest) return;
    setValues({});
    setApplied(null);
    setPage(1);
    const def = layouts.find((l) => l.isDefault);
    setCols(def ? def.columns : manifest.columns.filter((c) => !c.optional).map((c) => c.key));
    // يُعاد الضبط عند تغيّر التقرير فقط
  }, [manifest?.code]);

  const query = useMemo(
    () => ({
      ...Object.fromEntries(Object.entries(applied?.v ?? {}).filter(([, v]) => v)),
      columns: (applied?.c ?? []).join(',') || undefined,
    }),
    [applied],
  );
  const missing = (manifest?.filters ?? []).some((f) => f.required && !values[f.key]);
  const rows = useQuery({
    queryKey: ['/reports', code, 'run', query, page],
    queryFn: async () =>
      await api.get<Record<string, unknown>[]>(`/reports/${code}/run`, {
        ...query,
        page,
        pageSize: 50,
      }),
    enabled: applied !== null,
  });
  const shownCols = (
    (rows.data?.meta as { columns?: { key: string }[] } | undefined)?.columns ?? []
  ).flatMap((c) => manifest?.columns.filter((m) => m.key === c.key) ?? []);
  const total = Number((rows.data?.meta as { total?: number } | undefined)?.total ?? 0);

  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const doExport = useMutation({
    mutationFn: async (format: Format) => {
      const q = { ...query, format, lang };
      try {
        const blob = await api.blob(`/reports/${code}/export`, q);
        downloadBlob(blob, `${code}.${format}`);
      } catch (e) {
        // الكبير يتحول تلقائياً إلى مهمة خلفية (CSV/Excel)
        if (
          e instanceof ApiError &&
          e.code === 'EXPORT_TOO_LARGE_FOR_DIRECT' &&
          (format === 'csv' || format === 'xlsx')
        ) {
          await api.post(`/reports/${code}/export-jobs`, {
            format,
            filters: applied?.v ?? {},
            columns: applied?.c,
            lang,
          });
          notifications.show({ color: 'blue', message: t('reports.queued') });
          await qc.invalidateQueries({ queryKey: ['/reports', 'runs'] });
          return;
        }
        throw e;
      }
      await qc.invalidateQueries({ queryKey: ['/reports', 'runs'] });
    },
    onError: fail,
  });
  const saveLayout = useMutation({
    mutationFn: async (isDefault: boolean) =>
      api.post(`/reports/${code}/layouts`, { name: layoutName.trim(), columns: cols, isDefault }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('reports.layoutSaved') });
      setLayoutName('');
      await qc.invalidateQueries({ queryKey: ['/reports', code] });
    },
    onError: fail,
  });
  const delLayout = useMutation({
    mutationFn: async (id: string) => api.del(`/reports/layouts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/reports', code] }),
    onError: fail,
  });

  if (!manifest) return null;
  const colLabel = (c: { labelAr: string; labelEn: string }) =>
    lang === 'en' ? c.labelEn : c.labelAr;
  return (
    <Stack>
      <div>
        <Title order={3}>{lang === 'en' ? manifest.titleEn : manifest.titleAr}</Title>
        <Text c="dimmed" size="sm">
          {lang === 'en' ? manifest.descriptionEn : manifest.descriptionAr}
        </Text>
      </div>
      {manifest.filters.length > 0 && (
        <Card withBorder padding="sm">
          <Text fw={600} mb="xs">
            {t('reports.filters')}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {manifest.filters.map((f) => (
              <FilterField
                key={f.key}
                f={f}
                value={values[f.key] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              />
            ))}
          </SimpleGrid>
        </Card>
      )}
      <Card withBorder padding="sm">
        <Stack gap="xs">
          <MultiSelect
            label={t('reports.columns')}
            value={cols}
            onChange={setCols}
            data={manifest.columns.map((c) => ({ value: c.key, label: colLabel(c) }))}
          />
          <Group align="flex-end">
            {layouts.length > 0 && (
              <Select
                label={t('reports.layouts')}
                placeholder="—"
                clearable
                data={layouts.map((l) => ({
                  value: l.id,
                  label: l.name + (l.isDefault ? ' ★' : ''),
                }))}
                onChange={(id) => {
                  const l = layouts.find((x) => x.id === id);
                  if (l) setCols(l.columns);
                }}
              />
            )}
            <TextInput
              label={t('reports.layoutName')}
              value={layoutName}
              onChange={(e) => setLayoutName(e.currentTarget.value)}
            />
            <Button
              variant="default"
              disabled={!layoutName.trim() || cols.length === 0}
              loading={saveLayout.isPending}
              onClick={() => saveLayout.mutate(false)}
            >
              {t('reports.saveLayout')}
            </Button>
            <Button
              variant="subtle"
              disabled={!layoutName.trim() || cols.length === 0}
              onClick={() => saveLayout.mutate(true)}
            >
              {t('reports.saveLayout')} ({t('reports.saveDefault')})
            </Button>
            {layouts.map((l) => (
              <Button
                key={l.id}
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => delLayout.mutate(l.id)}
              >
                {t('reports.deleteLayout')} {l.name}
              </Button>
            ))}
          </Group>
        </Stack>
      </Card>
      <Group>
        <Button
          disabled={missing || cols.length === 0}
          onClick={() => {
            setPage(1);
            setApplied({ v: values, c: cols });
          }}
        >
          {t('reports.run')}
        </Button>
        {applied &&
          FORMATS.map((f) => (
            <Button
              key={f}
              variant="default"
              loading={doExport.isPending && doExport.variables === f}
              onClick={() => doExport.mutate(f)}
            >
              {t('reports.export')} {f.toUpperCase()}
            </Button>
          ))}
      </Group>
      {applied && rows.data && (
        <>
          <Text size="sm" c="dimmed">
            {t('reports.total', { n: total })}
          </Text>
          <ScrollArea>
            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  {shownCols.map((c) => (
                    <Table.Th key={c.key}>{colLabel(c)}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.data.data.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={Math.max(1, shownCols.length)}>
                      <Text c="dimmed" ta="center">
                        {t('reports.noRows')}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {rows.data.data.map((r, i) => (
                  <Table.Tr key={i}>
                    {shownCols.map((c) => (
                      <Table.Td
                        key={c.key}
                        dir={c.type === 'money' || c.type === 'number' ? 'ltr' : undefined}
                        ta={c.type === 'money' || c.type === 'number' ? 'end' : undefined}
                      >
                        {c.type === 'date' && r[c.key]
                          ? fmt.date(String(r[c.key]))
                          : cellView(c, r[c.key], lang)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {total > 50 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={Math.ceil(total / 50)} />
            </Group>
          )}
        </>
      )}
    </Stack>
  );
};

const RunsPanel = () => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const q = useQuery({
    queryKey: ['/reports', 'runs'],
    queryFn: async () => (await api.get<RunRow[]>('/reports/runs')).data,
    refetchInterval: (s) =>
      s.state.data?.some((r) => r.status === 'queued' || r.status === 'running') ? 4000 : false,
  });
  const download = async (r: RunRow) => {
    try {
      downloadBlob(await api.blob(`/reports/runs/${r.id}/download`), `${r.reportCode}.${r.format}`);
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  const rows = q.data ?? [];
  if (!rows.length) return <Text c="dimmed">{t('reports.runs.none')}</Text>;
  return (
    <ScrollArea>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('reports.runs.report')}</Table.Th>
            <Table.Th>{t('reports.runs.format')}</Table.Th>
            <Table.Th>{t('reports.runs.mode')}</Table.Th>
            <Table.Th>{t('reports.runs.status')}</Table.Th>
            <Table.Th>{t('reports.runs.rows')}</Table.Th>
            <Table.Th>{t('reports.runs.at')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td dir="ltr">{r.reportCode}</Table.Td>
              <Table.Td>{r.format.toUpperCase()}</Table.Td>
              <Table.Td>{t(`reports.runs.${r.mode}`)}</Table.Td>
              <Table.Td>
                <Badge
                  variant="light"
                  color={r.status === 'done' ? 'teal' : r.status === 'failed' ? 'red' : 'blue'}
                >
                  {t(`reports.runs.statuses.${r.status}`)}
                </Badge>
              </Table.Td>
              <Table.Td dir="ltr">{r.rowCount ?? '—'}</Table.Td>
              <Table.Td>{fmt.dateTime(r.createdAt)}</Table.Td>
              <Table.Td>
                {r.mode === 'job' && r.status === 'done' ? (
                  r.downloadable ? (
                    <Button size="xs" variant="light" onClick={() => void download(r)}>
                      {t('reports.runs.download')}
                    </Button>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {t('reports.runs.expired')}
                    </Text>
                  )
                ) : null}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
};

export const ReportsPage = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'ar';
  const initialTab = new URLSearchParams(window.location.search).get('runs') ? 'runs' : 'reports';
  const [tab, setTab] = useState<string | null>(initialTab);
  const [code, setCode] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['/reports'],
    queryFn: async () => (await api.get<Manifest[]>('/reports')).data,
  });
  const all = list.data ?? [];
  return (
    <Stack>
      <Title order={2}>{t('reports.title')}</Title>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="reports">{t('reports.tabs.reports')}</Tabs.Tab>
          <Tabs.Tab value="runs">{t('reports.tabs.runs')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="reports" pt="md">
          {list.isSuccess && all.length === 0 && <Text c="dimmed">{t('reports.empty')}</Text>}
          {all.length > 0 && (
            <SimpleGrid cols={{ base: 1, md: 4 }} spacing="lg">
              <Card withBorder padding="xs" style={{ alignSelf: 'start' }}>
                {MODULES.map((m) => {
                  const items = all.filter((r) => r.module === m);
                  if (!items.length) return null;
                  return (
                    <div key={m}>
                      <Text size="xs" c="dimmed" fw={600} p="xs">
                        {t(`reports.modules.${m}`)}
                      </Text>
                      {items.map((r) => (
                        <NavLink
                          key={r.code}
                          active={code === r.code}
                          label={lang === 'en' ? r.titleEn : r.titleAr}
                          onClick={() => setCode(r.code)}
                        />
                      ))}
                    </div>
                  );
                })}
              </Card>
              <div style={{ gridColumn: 'span 3' }}>
                {code ? (
                  <ReportView key={code} code={code} />
                ) : (
                  <Text c="dimmed">{t('reports.pick')}</Text>
                )}
              </div>
            </SimpleGrid>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="runs" pt="md">
          <RunsPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
