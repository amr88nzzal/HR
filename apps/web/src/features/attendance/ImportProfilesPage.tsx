import {
  Badge,
  Button,
  Fieldset,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type ColKey = 'employee' | 'datetime' | 'type' | 'branch' | 'department';
const COL_KEYS: ColKey[] = ['employee', 'datetime', 'type', 'branch', 'department'];

export type ProfileRow = {
  id: string;
  version: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  delimiter: string;
  encoding: string;
  hasHeader: string;
  columns: Record<string, number | string | null>;
  dateOrder: string;
  directionMode: string;
  inValues: string[];
  outValues: string[];
  systemKey: string;
  isDefault: boolean;
  isActive: boolean;
};

type Form = {
  code: string;
  nameAr: string;
  nameEn: string;
  delimiter: string;
  encoding: string;
  hasHeader: string;
  cols: Record<ColKey, string>;
  dateOrder: string;
  directionMode: string;
  inValues: string[];
  outValues: string[];
  systemKey: string;
  isDefault: boolean;
  isActive: boolean;
};

const EMPTY: Form = {
  code: '',
  nameAr: '',
  nameEn: '',
  delimiter: ';',
  encoding: 'auto',
  hasHeader: 'auto',
  cols: { branch: '0', department: '1', employee: '2', datetime: '3', type: '4' },
  dateOrder: 'auto',
  directionMode: 'type',
  inValues: ['0', 'in', 'i'],
  outValues: ['1', 'out', 'o'],
  systemKey: 'attendance_device',
  isDefault: false,
  isActive: true,
};

const toForm = (p: ProfileRow): Form => ({
  code: p.code,
  nameAr: p.nameAr,
  nameEn: p.nameEn ?? '',
  delimiter: p.delimiter,
  encoding: p.encoding,
  hasHeader: p.hasHeader,
  cols: Object.fromEntries(COL_KEYS.map((k) => [k, String(p.columns[k] ?? '')])) as Record<
    ColKey,
    string
  >,
  dateOrder: p.dateOrder,
  directionMode: p.directionMode,
  inValues: p.inValues,
  outValues: p.outValues,
  systemKey: p.systemKey,
  isDefault: p.isDefault,
  isActive: p.isActive,
});

/** رقم العمود إن كان رقماً، وإلا اسمه، وفارغ = غير موجود. */
export const colRef = (v: string): number | string | null => {
  const s = v.trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : s;
};

const toBody = (f: Form) => ({
  code: f.code.trim(),
  nameAr: f.nameAr.trim(),
  nameEn: f.nameEn.trim() || null,
  delimiter: f.delimiter,
  encoding: f.encoding,
  hasHeader: f.hasHeader,
  columns: Object.fromEntries(COL_KEYS.map((k) => [k, colRef(f.cols[k])])),
  dateOrder: f.dateOrder,
  directionMode: f.directionMode,
  inValues: f.inValues,
  outValues: f.outValues,
  systemKey: f.systemKey.trim(),
  isDefault: f.isDefault,
  isActive: f.isActive,
});

const ProfileModal = ({ row, onClose }: { row: ProfileRow | null; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(row ? toForm(row) : EMPTY);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: async () =>
      row
        ? (
            await api.patch(`/attendance-import/profiles/${row.id}`, {
              ...toBody(f),
              version: row.version,
            })
          ).data
        : (await api.post('/attendance-import/profiles', toBody(f))).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendance.saved') });
      await qc.invalidateQueries({ queryKey: ['/attendance-import', 'profiles'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const pick = (ns: string, keys: string[]) =>
    keys.map((k) => ({ value: k, label: t(`importProfiles.${ns}.${k}`) }));
  const valid =
    !!f.code.trim() &&
    !!f.nameAr.trim() &&
    colRef(f.cols.employee) !== null &&
    colRef(f.cols.datetime) !== null;

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      centered
      title={row ? t('importProfiles.edit') : t('importProfiles.add')}
    >
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput
            label={t('importProfiles.code')}
            required
            dir="ltr"
            value={f.code}
            onChange={(e) => set('code', e.currentTarget.value)}
          />
          <TextInput
            label={t('importProfiles.nameAr')}
            required
            value={f.nameAr}
            onChange={(e) => set('nameAr', e.currentTarget.value)}
          />
          <Select
            label={t('importProfiles.delimiter')}
            allowDeselect={false}
            data={pick('delimiters', [';', ',', '\t', '|'])}
            value={f.delimiter}
            onChange={(v) => set('delimiter', v ?? ';')}
          />
          <Select
            label={t('importProfiles.encoding')}
            allowDeselect={false}
            data={pick('encodings', ['auto', 'utf-8', 'windows-1256'])}
            value={f.encoding}
            onChange={(v) => set('encoding', v ?? 'auto')}
          />
          <Select
            label={t('importProfiles.hasHeader')}
            allowDeselect={false}
            data={pick('headerOptions', ['auto', 'yes', 'no'])}
            value={f.hasHeader}
            onChange={(v) => set('hasHeader', v ?? 'auto')}
          />
          <Select
            label={t('importProfiles.dateOrder')}
            allowDeselect={false}
            data={pick('dateOrders', ['auto', 'ymd', 'dmy', 'mdy'])}
            value={f.dateOrder}
            onChange={(v) => set('dateOrder', v ?? 'auto')}
          />
        </SimpleGrid>
        <Fieldset legend={t('importProfiles.columns')}>
          <Text size="xs" c="dimmed" mb="xs">
            {t('importProfiles.columnsHint')}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {COL_KEYS.map((k) => (
              <TextInput
                key={k}
                label={t(`importProfiles.col.${k}`)}
                dir="ltr"
                value={f.cols[k]}
                onChange={(e) => set('cols', { ...f.cols, [k]: e.currentTarget.value })}
              />
            ))}
          </SimpleGrid>
        </Fieldset>
        <SimpleGrid cols={2}>
          <Select
            label={t('importProfiles.directionMode')}
            allowDeselect={false}
            data={pick('directionModes', ['type', 'ignore'])}
            value={f.directionMode}
            onChange={(v) => set('directionMode', v ?? 'type')}
          />
          <TextInput
            label={t('importProfiles.systemKey')}
            dir="ltr"
            value={f.systemKey}
            onChange={(e) => set('systemKey', e.currentTarget.value)}
          />
          <TagsInput
            label={t('importProfiles.inValues')}
            value={f.inValues}
            onChange={(v) => set('inValues', v)}
            disabled={f.directionMode === 'ignore'}
          />
          <TagsInput
            label={t('importProfiles.outValues')}
            value={f.outValues}
            onChange={(v) => set('outValues', v)}
            disabled={f.directionMode === 'ignore'}
          />
        </SimpleGrid>
        <Group>
          <Switch
            label={t('importProfiles.isDefault')}
            checked={f.isDefault}
            onChange={(e) => set('isDefault', e.currentTarget.checked)}
          />
          <Switch
            label={t('importProfiles.isActive')}
            checked={f.isActive}
            onChange={(e) => set('isActive', e.currentTarget.checked)}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

/** ملفات استيراد البصمات: الفاصل والترميز وربط الأعمدة وتعامل النوع، لكل جهاز أو صيغة. */
export const ImportProfilesPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProfileRow | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['/attendance-import', 'profiles'],
    queryFn: async () => (await api.get<ProfileRow[]>('/attendance-import/profiles')).data,
  });
  const del = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/attendance-import/profiles/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/attendance-import', 'profiles'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirmDelete = (p: ProfileRow) =>
    modals.openConfirmModal({
      title: p.code,
      children: <Text size="sm">{t('importProfiles.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(p.id),
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.importProfiles')}</Title>
        {can('attendance.import_profile.create') && (
          <Button onClick={() => setEditing('new')}>{t('importProfiles.add')}</Button>
        )}
      </Group>
      <Table.ScrollContainer minWidth={640}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('importProfiles.code')}</Table.Th>
              <Table.Th>{t('importProfiles.nameAr')}</Table.Th>
              <Table.Th>{t('importProfiles.delimiter')}</Table.Th>
              <Table.Th>{t('importProfiles.encoding')}</Table.Th>
              <Table.Th />
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(q.data ?? []).map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td dir="ltr" ta="start">
                  {p.code}
                </Table.Td>
                <Table.Td>{p.nameAr}</Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {p.delimiter === '\t' ? 'Tab' : p.delimiter}
                </Table.Td>
                <Table.Td>{t(`importProfiles.encodings.${p.encoding}`)}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {p.isDefault && <Badge variant="light">{t('importProfiles.isDefault')}</Badge>}
                    {!p.isActive && (
                      <Badge color="gray" variant="light">
                        {t('table.inactive')}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {can('attendance.import_profile.update') && (
                      <Button size="compact-xs" variant="default" onClick={() => setEditing(p)}>
                        {t('table.edit')}
                      </Button>
                    )}
                    {can('attendance.import_profile.delete') && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => confirmDelete(p)}
                      >
                        {t('table.delete')}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {editing && (
        <ProfileModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
};
