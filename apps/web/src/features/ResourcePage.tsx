import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, useRemove, useSave, type Row } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { DataTable } from '../components/DataTable';
import { DynamicForm, type FieldDef, type Option } from '../components/DynamicForm';
import { exportCsv, exportXlsx, fetchAllRows, type ExportColumn } from '../lib/export';
import { errorMessage } from '../lib/errors';
import { localName } from '../lib/names';
import { RESOURCES, staticOptions } from './resourceDefs';

const PAGE_SIZE = 25;

/** يحمّل خيارات (المعرّف ← الاسم) من مورد آخر */
const useOptions = (path: string | undefined, lang: string) => {
  const q = useList(path ?? '/branches', { pageSize: 200 }, !!path);
  const rows = path ? (q.data?.data ?? []) : [];
  return { rows, options: rows.map((r): Option => ({ value: r.id, label: localName(r, lang) })) };
};

/** صفحة CRUD عامة مبنية من تعريف المورد: جدول + بحث + نموذج + حذف + تصدير. */
export const ResourcePage = ({ resourceKey }: { resourceKey: string }) => {
  const def = RESOURCES[resourceKey];
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [exporting, setExporting] = useState(false);

  const list = useList(
    def?.path ?? '/branches',
    {
      page,
      pageSize: PAGE_SIZE,
      q: debounced || undefined,
      isActive: active ? active === 'true' : undefined,
    },
    !!def,
  );
  const save = useSave(def?.path ?? '/branches');
  const remove = useRemove(def?.path ?? '/branches');

  // جداول المراجع لعرض الأسماء بدل المعرّفات وملء قوائم الاختيار
  const remotePaths = useMemo(() => [...new Set(Object.values(def?.remote ?? {}))], [def]);
  const r0 = useOptions(remotePaths[0], i18n.language);
  const selfList = useOptions(def?.selfRef ? def.path : undefined, i18n.language);
  const remoteRows: Record<string, Row[]> = {};
  if (remotePaths[0]) remoteRows[remotePaths[0]] = r0.rows;
  if (def?.selfRef) remoteRows[def.path] = selfList.rows;

  if (!def) return null;

  const lookup = (path: string, id: unknown): string => {
    if (typeof id !== 'string') return '—';
    const hit = remoteRows[path]?.find((r) => r.id === id);
    return hit ? localName(hit, i18n.language) : '—';
  };
  const columns = def.columns(t, i18n.language, lookup);
  const stat = staticOptions(t);

  const fields: FieldDef[] = def.fields.map((f) => {
    if (stat[f.name]) return { ...f, options: stat[f.name] };
    const remotePath = def.remote?.[f.name];
    if (remotePath) return { ...f, options: r0.options };
    if (def.selfRef === f.name)
      return { ...f, options: selfList.options.filter((o) => o.value !== editing?.id) };
    return f;
  });

  const startCreate = () => {
    setEditing(null);
    open();
  };
  const startEdit = (row: Row) => {
    setEditing(row);
    open();
  };
  const initial = editing
    ? Object.fromEntries(
        def.fields.map((f) => [
          f.name,
          editing[f.name] ??
            (f.kind === 'multiselect'
              ? []
              : f.kind === 'switch'
                ? false
                : f.kind === 'number'
                  ? 0
                  : ''),
        ]),
      )
    : {
        ...def.defaults,
        ...Object.fromEntries(
          def.fields
            .filter((f) => !(f.name in def.defaults))
            .map((f) => [f.name, f.kind === 'multiselect' ? [] : f.kind === 'switch' ? false : '']),
        ),
      };

  const submit = (values: Record<string, unknown>) =>
    save.mutate(
      { id: editing?.id, body: editing ? { ...values, version: editing.version } : values },
      {
        onSuccess: () => {
          notifications.show({ color: 'teal', message: t('table.saved') });
          close();
        },
        onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
      },
    );

  const confirmDelete = (row: Row) =>
    modals.openConfirmModal({
      title: t('table.deleteTitle'),
      children: <Text size="sm">{t('table.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        remove.mutate(row.id, {
          onSuccess: () => notifications.show({ color: 'teal', message: t('table.deleted') }),
          onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
        }),
    });

  const doExport = async (kind: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      // كل الصفحات بنفس المرشحات الحالية (بحد أقصى 20 ألف صف)
      const all = await fetchAllRows<Row>(def.path, {
        q: debounced || undefined,
        isActive: active ? active === 'true' : undefined,
      });
      const cols: ExportColumn<Row>[] = columns.map((c) => ({
        header: c.header,
        value: (r) => c.exportValue?.(r as never) ?? '',
      }));
      const name = t(`nav.${def.navKey}`);
      if (kind === 'csv') exportCsv(name, cols, all);
      else await exportXlsx(name, cols, all, i18n.language === 'ar');
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t(`nav.${def.navKey}`)}</Title>
        <Group>
          <Menu withinPortal>
            <Menu.Target>
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                loading={exporting}
              >
                {t('table.export')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => void doExport('csv')}>{t('table.exportCsv')}</Menu.Item>
              <Menu.Item onClick={() => void doExport('xlsx')}>{t('table.exportXlsx')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          {can(`${def.perm}.create`) && (
            <Button leftSection={<IconPlus size={16} />} onClick={startCreate}>
              {t('table.add')}
            </Button>
          )}
        </Group>
      </Group>
      <Group>
        <TextInput
          placeholder={t('table.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          w={260}
        />
        <Select
          value={active}
          onChange={(v) => {
            setActive(v);
            setPage(1);
          }}
          placeholder={t('table.all')}
          clearable
          data={[
            { value: 'true', label: t('table.active') },
            { value: 'false', label: t('table.inactive') },
          ]}
          w={160}
        />
      </Group>
      <DataTable
        columns={columns}
        rows={(list.data?.data ?? []) as never}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        actions={(row) => (
          <>
            {can(`${def.perm}.update`) && (
              <ActionIcon
                variant="subtle"
                aria-label={t('table.edit')}
                onClick={() => startEdit(row as Row)}
              >
                <IconEdit size={16} />
              </ActionIcon>
            )}
            {can(`${def.perm}.delete`) && (
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={t('table.delete')}
                onClick={() => confirmDelete(row as Row)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </>
        )}
      />
      <Modal opened={opened} onClose={close} title={t(`nav.${def.navKey}`)} centered>
        {opened && (
          <DynamicForm
            key={editing?.id ?? 'new'}
            fields={fields}
            schema={def.schema}
            initial={initial}
            editing={!!editing}
            submitting={save.isPending}
            onSubmit={submit}
            onCancel={close}
          />
        )}
      </Modal>
    </Stack>
  );
};
