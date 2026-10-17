import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  Pagination,
  Popover,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconColumns3,
  IconDownload,
  IconGripVertical,
  IconPrinter,
  IconSelector,
} from '@tabler/icons-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { exportCsv, exportXlsx, type ExportColumn } from '../lib/export';
import {
  applyPrefs,
  compareValues,
  moveKey,
  nodeText,
  printHtml,
  type ColPref,
} from '../lib/tableTools';
import { useTablePrefs } from '../lib/useTablePrefs';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** قيمة التصدير والطباعة والفرز (افتراضياً نص العرض) */
  exportValue?: (row: T) => string | number | boolean | null;
  align?: 'start' | 'end';
  ltr?: boolean;
  /** فرز من الخادم: اسم حقل الفرز في الـ API (يتفعّل مع `onSort`) */
  sortKey?: string;
  /** إيقاف الفرز لعمود في الجداول الكاملة (مثل أعمدة الإجراءات النصية) */
  sortable?: boolean;
};

type Props<T extends { id: string }> = {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  actions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  /** يفعّل شريط الأدوات (الأعمدة والطباعة والتصدير) ويحفظ تفضيلات الأعمدة بهذا المعرّف */
  tableId?: string;
  /** عنوان الطباعة واسم ملف التصدير */
  title?: string;
  /** فرز الخادم: القيمة الحالية (`-net`) ودالة التغيير */
  sort?: string;
  onSort?: (sort: string | undefined) => void;
  /** يجلب كل الصفوف (بنفس المرشحات والفرز) للتصدير الكامل؛ بدونها يُصدَّر المعروض */
  fetchAll?: () => Promise<T[]>;
  /** الصفحة لديها زر تصدير خاص */
  hideExport?: boolean;
};

export const ActiveBadge = ({ active }: { active: boolean }) => {
  const { t } = useTranslation();
  return (
    <Badge color={active ? 'teal' : 'gray'} variant="light">
      {active ? t('table.active') : t('table.inactive')}
    </Badge>
  );
};

export const DataTable = <T extends { id: string }>({
  columns,
  rows,
  loading,
  page,
  pageSize,
  total,
  onPage,
  actions,
  onRowClick,
  tableId,
  title,
  sort,
  onSort,
  fetchAll,
  hideExport,
}: Props<T>) => {
  const { t, i18n } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const prefs = useTablePrefs(tableId);
  const [local, setLocal] = useState<{ key: string; desc: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const mode: 'server' | 'client' | 'none' = onSort
    ? 'server'
    : rows.length >= total
      ? 'client'
      : 'none';

  const visible = useMemo(
    () => (tableId ? applyPrefs(columns, prefs.pref) : columns),
    [columns, prefs.pref, tableId],
  );
  const cell = (c: Column<T>, row: T): string | number | boolean | null =>
    c.exportValue ? c.exportValue(row) : nodeText(c.render(row));

  const sorted = useMemo(() => {
    if (mode !== 'client' || !local) return rows;
    const col = columns.find((c) => c.key === local.key);
    if (!col) return rows;
    const dir = local.desc ? -1 : 1;
    return [...rows].sort((a, b) => dir * compareValues(cell(col, a), cell(col, b), i18n.language));
  }, [rows, local, mode, columns, i18n.language]);

  const sortable = (c: Column<T>) =>
    mode === 'server' ? !!c.sortKey : mode === 'client' ? c.sortable !== false : false;
  const current = (c: Column<T>): 'asc' | 'desc' | null => {
    if (mode === 'server') {
      if (!sort || !c.sortKey) return null;
      const desc = sort.startsWith('-');
      return (desc ? sort.slice(1) : sort) === c.sortKey ? (desc ? 'desc' : 'asc') : null;
    }
    return local?.key === c.key ? (local.desc ? 'desc' : 'asc') : null;
  };
  /** تبديل: تصاعدي ← تنازلي ← بلا فرز */
  const toggle = (c: Column<T>) => {
    const cur = current(c);
    if (mode === 'server') {
      onSort?.(cur === null ? c.sortKey : cur === 'asc' ? `-${c.sortKey}` : undefined);
      onPage(1);
    } else
      setLocal(
        cur === null
          ? { key: c.key, desc: false }
          : cur === 'asc'
            ? { key: c.key, desc: true }
            : null,
      );
  };

  const exportCols = (): ExportColumn<T>[] =>
    visible.map((c) => ({ header: c.header, value: (r: T) => cell(c, r) }));
  const fileName =
    title ?? document.querySelector('h2, h1')?.textContent?.trim() ?? tableId ?? 'table';
  const dataset = async (): Promise<T[]> => (fetchAll ? fetchAll() : sorted);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const doPrint = () =>
    run(async () => {
      const data = await dataset();
      const cols = exportCols();
      const html = printHtml(
        title ?? fileName,
        cols.map((c) => c.header),
        data.map((r) => cols.map((c) => String(c.value(r) ?? ''))),
        { rtl: i18n.language === 'ar', date: new Date().toLocaleString(i18n.language) },
      );
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    });

  const allKeys = useMemo(() => {
    const keys = columns.map((c) => c.key);
    return [
      ...prefs.pref.order.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !prefs.pref.order.includes(k)),
    ];
  }, [columns, prefs.pref.order]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const savePref = (p: ColPref) => prefs.save(p);
  const reorder = (from: number, to: number) =>
    savePref({ order: moveKey(allKeys, from, to), hidden: prefs.pref.hidden });
  const toggleHidden = (key: string) => {
    const hidden = prefs.pref.hidden.includes(key)
      ? prefs.pref.hidden.filter((k) => k !== key)
      : [...prefs.pref.hidden, key];
    if (hidden.length >= columns.length) return;
    savePref({ order: allKeys, hidden });
  };
  const header = (c: Column<T>) => {
    const dir = current(c);
    if (!sortable(c)) return c.header;
    const Icon = dir === 'asc' ? IconArrowUp : dir === 'desc' ? IconArrowDown : IconSelector;
    return (
      <Group
        gap={4}
        wrap="nowrap"
        onClick={() => toggle(c)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        role="button"
        aria-label={`${t('table.sortBy')} ${c.header}`}
      >
        <span>{c.header}</span>
        <Icon size={14} opacity={dir ? 1 : 0.4} />
      </Group>
    );
  };

  return (
    <>
      {tableId && (
        <Group justify="flex-end" gap="xs" mb="xs">
          <Popover position="bottom-end" shadow="md" width={260} withArrow>
            <Popover.Target>
              <Button
                variant="default"
                size="xs"
                leftSection={<IconColumns3 size={14} />}
                aria-label={t('table.columns')}
              >
                {t('table.columns')}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap={4}>
                {allKeys.map((key, i) => {
                  const c = columns.find((x) => x.key === key)!;
                  return (
                    <Group
                      key={key}
                      gap={6}
                      wrap="nowrap"
                      draggable
                      onDragStart={() => setDragFrom(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragFrom !== null) reorder(dragFrom, i);
                        setDragFrom(null);
                      }}
                      style={{ cursor: 'grab' }}
                    >
                      <IconGripVertical size={14} opacity={0.5} />
                      <Checkbox
                        size="xs"
                        style={{ flex: 1 }}
                        label={c.header}
                        checked={!prefs.pref.hidden.includes(key)}
                        onChange={() => toggleHidden(key)}
                      />
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        disabled={i === 0}
                        aria-label={t('table.moveUp')}
                        onClick={() => reorder(i, i - 1)}
                      >
                        <IconArrowUp size={12} />
                      </ActionIcon>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        disabled={i === allKeys.length - 1}
                        aria-label={t('table.moveDown')}
                        onClick={() => reorder(i, i + 1)}
                      >
                        <IconArrowDown size={12} />
                      </ActionIcon>
                    </Group>
                  );
                })}
                <Button size="xs" variant="subtle" onClick={prefs.reset}>
                  {t('table.resetColumns')}
                </Button>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          {!hideExport && (
            <Menu position="bottom-end">
              <Menu.Target>
                <Button
                  variant="default"
                  size="xs"
                  loading={busy}
                  leftSection={<IconDownload size={14} />}
                >
                  {t('table.export')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={() =>
                    void run(async () => exportCsv(fileName, exportCols(), await dataset()))
                  }
                >
                  {t('table.exportCsv')}
                </Menu.Item>
                <Menu.Item
                  onClick={() =>
                    void run(async () =>
                      exportXlsx(fileName, exportCols(), await dataset(), i18n.language === 'ar'),
                    )
                  }
                >
                  {t('table.exportXlsx')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
          <Tooltip label={t('table.print')}>
            <Button
              variant="default"
              size="xs"
              loading={busy}
              leftSection={<IconPrinter size={14} />}
              onClick={() => void doPrint()}
            >
              {t('table.print')}
            </Button>
          </Tooltip>
        </Group>
      )}
      <Table.ScrollContainer minWidth={600}>
        <Table striped highlightOnHover={!!onRowClick} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              {visible.map((c) => (
                <Table.Th key={c.key} ta={c.align}>
                  {header(c)}
                </Table.Th>
              ))}
              {actions && <Table.Th w={1}>{t('table.actions')}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sorted.map((row) => (
              <Table.Tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {visible.map((c) => (
                  <Table.Td
                    key={c.key}
                    ta={c.align}
                    dir={c.ltr ? 'ltr' : undefined}
                    style={c.ltr ? { textAlign: 'start' } : undefined}
                  >
                    {c.render(row)}
                  </Table.Td>
                ))}
                {actions && (
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Group gap={4} wrap="nowrap">
                      {actions(row)}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {loading && rows.length === 0 && (
        <Center p="md">
          <Loader size="sm" />
        </Center>
      )}
      {!loading && rows.length === 0 && (
        <Text c="dimmed" ta="center" p="md">
          {t('table.empty')}
        </Text>
      )}
      <Group justify="space-between" mt="sm">
        <Text size="sm" c="dimmed">
          {t('table.total', { count: total })}
        </Text>
        {pages > 1 && <Pagination value={page} onChange={onPage} total={pages} size="sm" />}
      </Group>
    </>
  );
};
