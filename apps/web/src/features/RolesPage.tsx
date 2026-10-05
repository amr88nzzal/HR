import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useList, useRemove, type Row } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { DataTable, type Column } from '../components/DataTable';
import { errorMessage } from '../lib/errors';
import { localName } from '../lib/names';

type Perm = { code: string; module: string; resource: string; action: string };

/** مصفوفة الصلاحيات: صفوف = المورد، أعمدة = الإجراء، مجمَّعة حسب الوحدة. */
export const PermissionMatrix = ({
  catalog,
  value,
  onChange,
  readOnly,
}: {
  catalog: Perm[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}) => {
  const { t } = useTranslation();
  const actions = useMemo(() => [...new Set(catalog.map((p) => p.action))], [catalog]);
  const modulesOf = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, string>>>();
    for (const p of catalog) {
      if (!map.has(p.module)) map.set(p.module, new Map());
      const res = map.get(p.module) as Map<string, Map<string, string>>;
      if (!res.has(p.resource)) res.set(p.resource, new Map());
      res.get(p.resource)?.set(p.action, p.code);
    }
    return map;
  }, [catalog]);

  const toggle = (codes: string[], on: boolean) => {
    const next = new Set(value);
    codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
    onChange(next);
  };

  return (
    <ScrollArea>
      <Table withTableBorder withColumnBorders miw={640}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            {actions.map((a) => (
              <Table.Th key={a} ta="center">
                {t(`rolesPage.actions.${a}`, { defaultValue: a })}
              </Table.Th>
            ))}
            <Table.Th ta="center" w={1}>
              {t('rolesPage.selectAll')}
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...modulesOf].map(([module, resources]) => (
            <>
              <Table.Tr key={module} bg="var(--mantine-color-gray-light)">
                <Table.Td colSpan={actions.length + 2} fw={600}>
                  {t(`rolesPage.modules.${module}`, { defaultValue: module })}
                </Table.Td>
              </Table.Tr>
              {[...resources].map(([resource, acts]) => {
                const codes = [...acts.values()];
                return (
                  <Table.Tr key={`${module}.${resource}`}>
                    <Table.Td>
                      {t(`rolesPage.resources.${resource}`, { defaultValue: resource })}
                    </Table.Td>
                    {actions.map((a) => {
                      const code = acts.get(a);
                      return (
                        <Table.Td key={a} ta="center">
                          {code && (
                            <Checkbox
                              checked={value.has(code)}
                              disabled={readOnly}
                              onChange={(e) => toggle([code], e.currentTarget.checked)}
                              aria-label={code}
                              style={{ display: 'inline-flex' }}
                            />
                          )}
                        </Table.Td>
                      );
                    })}
                    <Table.Td ta="center">
                      <Checkbox
                        checked={codes.every((c) => value.has(c))}
                        indeterminate={
                          codes.some((c) => value.has(c)) && !codes.every((c) => value.has(c))
                        }
                        disabled={readOnly}
                        onChange={(e) => toggle(codes, e.currentTarget.checked)}
                        aria-label={`${module}.${resource}`}
                        style={{ display: 'inline-flex' }}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
};

type RoleDetail = Row & {
  code: string;
  nameAr: string;
  nameEn: string | null;
  isSystem: boolean;
  permissions: string[];
};

const RoleEditor = ({
  roleId,
  catalog,
  onClose,
}: {
  roleId: string | null;
  catalog: Perm[];
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['/roles', 'one', roleId],
    enabled: !!roleId,
    queryFn: async () => (await api.get<RoleDetail>(`/roles/${roleId}`)).data,
  });
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState<string | null>(null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  const role = detail.data;
  const fixed = role?.code === 'admin';
  const currentPerms = perms ?? new Set(role?.permissions ?? []);
  const ar = nameAr ?? role?.nameAr ?? '';
  const en = nameEn ?? role?.nameEn ?? '';

  const save = async () => {
    setSaving(true);
    try {
      if (roleId) {
        await api.patch(`/roles/${roleId}`, {
          nameAr: ar,
          nameEn: en || null,
          ...(fixed ? {} : { permissions: [...currentPerms] }),
          version: role?.version,
        });
      } else {
        await api.post('/roles', {
          code,
          nameAr: ar,
          nameEn: en || null,
          permissions: [...currentPerms],
        });
      }
      await qc.invalidateQueries({ queryKey: ['/roles'] });
      notifications.show({ color: 'teal', message: t('table.saved') });
      onClose();
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={roleId ? t('rolesPage.editRole') : t('rolesPage.newRole')}
      size="xl"
      centered
    >
      <Stack>
        <Group grow align="flex-start">
          {!roleId && (
            <TextInput
              label={t('fields.code')}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              dir="ltr"
              required
            />
          )}
          <TextInput
            label={t('fields.nameAr')}
            value={ar}
            onChange={(e) => setNameAr(e.currentTarget.value)}
            required
          />
          <TextInput
            label={t('fields.nameEn')}
            value={en}
            onChange={(e) => setNameEn(e.currentTarget.value)}
          />
        </Group>
        {fixed && (
          <Text size="sm" c="dimmed">
            {t('rolesPage.adminFixed')}
          </Text>
        )}
        <PermissionMatrix
          catalog={catalog}
          value={fixed ? new Set(catalog.map((p) => p.code)) : currentPerms}
          onChange={setPerms}
          readOnly={fixed}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!ar || (!roleId && !code) || (!!roleId && !role)}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export const RolesPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const list = useList('/roles', {});
  const catalog = useQuery({
    queryKey: ['/permissions'],
    queryFn: async () => (await api.get<Perm[]>('/permissions')).data,
    staleTime: 300_000,
  });
  const remove = useRemove('/roles');
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const manage = can('identity.role.manage');

  const columns: Column<Row>[] = [
    { key: 'name', header: t('fields.nameAr'), render: (r) => localName(r, i18n.language) },
    { key: 'code', header: t('fields.code'), render: (r) => String(r['code']), ltr: true },
    {
      key: 'system',
      header: '',
      render: (r) =>
        r['isSystem'] === true ? <Badge variant="light">{t('rolesPage.system')}</Badge> : null,
    },
    {
      key: 'permissionCount',
      header: t('rolesPage.permissions'),
      render: (r) => String(r['permissionCount']),
    },
    { key: 'userCount', header: t('rolesPage.users'), render: (r) => String(r['userCount']) },
  ];

  const confirmDelete = (r: Row) =>
    modals.openConfirmModal({
      title: t('table.deleteTitle'),
      children: <Text size="sm">{t('table.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        remove.mutate(r.id, {
          onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
        }),
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('rolesPage.title')}</Title>
        {manage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            {t('rolesPage.newRole')}
          </Button>
        )}
      </Group>
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        loading={list.isLoading}
        page={1}
        pageSize={1000}
        total={list.data?.data.length ?? 0}
        onPage={() => undefined}
        onRowClick={(r) => setEditing(r.id)}
        actions={(r) =>
          manage && (
            <>
              <ActionIcon
                variant="subtle"
                aria-label={t('table.edit')}
                onClick={() => setEditing(r.id)}
              >
                <IconEdit size={16} />
              </ActionIcon>
              {r['isSystem'] !== true && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={t('table.delete')}
                  onClick={() => confirmDelete(r)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </>
          )
        }
      />
      {editing && catalog.data && (
        <RoleEditor
          roleId={editing === 'new' ? null : editing}
          catalog={catalog.data}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
};
