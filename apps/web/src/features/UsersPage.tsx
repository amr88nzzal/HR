import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconEdit,
  IconKey,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconShieldCog,
  IconTrash,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { roleAssignmentInput, userCreateInput, userUpdateInput } from '@hrms/shared';
import { api } from '../api/client';
import { useList, useOne, useSave, type Row } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { DataTable, type Column } from '../components/DataTable';
import { DynamicForm, type FieldDef } from '../components/DynamicForm';
import { errorMessage } from '../lib/errors';
import { localName } from '../lib/names';

const PAGE_SIZE = 25;
type Assignment = {
  roleId: string;
  scopeType: 'company' | 'branch' | 'department' | 'self';
  scopeId: string | null;
};

const RoleAssignmentsModal = ({ userId, onClose }: { userId: string; onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const user = useOne<Row & { roles: Assignment[]; displayName: string }>('/users', userId);
  const roles = useList('/roles', {});
  const branches = useList('/branches', { pageSize: 200 });
  const departments = useList('/departments', { pageSize: 200 });
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const current = items ?? user.data?.roles ?? [];

  const update = (i: number, patch: Partial<Assignment>) =>
    setItems(current.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const scopeOptions = (type: Assignment['scopeType']) =>
    ((type === 'branch' ? branches.data?.data : departments.data?.data) ?? []).map((r) => ({
      value: r.id,
      label: localName(r, i18n.language),
    }));

  const save = async () => {
    const body = current.map(({ roleId, scopeType, scopeId }) => ({
      roleId,
      scopeType,
      scopeId: scopeType === 'company' || scopeType === 'self' ? null : scopeId,
    }));
    const parsed = roleAssignmentInput.array().safeParse(body);
    if (!parsed.success)
      return notifications.show({ color: 'red', message: t('apiErrors.VALIDATION_ERROR') });
    setSaving(true);
    try {
      await api.request(`/users/${userId}/role-assignments`, { method: 'PUT', body });
      await qc.invalidateQueries({ queryKey: ['/users'] });
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
      title={`${t('users.roles')} — ${user.data?.displayName ?? ''}`}
      size="lg"
      centered
    >
      <Stack>
        {current.map((it, i) => (
          <Group key={i} align="flex-end" wrap="nowrap">
            <Select
              label={i === 0 ? t('users.role') : undefined}
              data={(roles.data?.data ?? []).map((r) => ({
                value: r.id,
                label: localName(r, i18n.language),
              }))}
              value={it.roleId}
              onChange={(v) => v && update(i, { roleId: v })}
              style={{ flex: 1 }}
            />
            <Select
              label={i === 0 ? t('users.scope') : undefined}
              data={(['company', 'branch', 'department', 'self'] as const).map((s) => ({
                value: s,
                label: t(`users.scopeTypes.${s}`),
              }))}
              value={it.scopeType}
              onChange={(v) =>
                v && update(i, { scopeType: v as Assignment['scopeType'], scopeId: null })
              }
              style={{ flex: 1 }}
            />
            {(it.scopeType === 'branch' || it.scopeType === 'department') && (
              <Select
                label={i === 0 ? t('users.scopeTarget') : undefined}
                data={scopeOptions(it.scopeType)}
                value={it.scopeId}
                onChange={(v) => update(i, { scopeId: v })}
                searchable
                style={{ flex: 1 }}
              />
            )}
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={t('table.delete')}
              onClick={() => setItems(current.filter((_, idx) => idx !== i))}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        <Group justify="space-between">
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() =>
              setItems([
                ...current,
                {
                  roleId: (roles.data?.data[0]?.id as string) ?? '',
                  scopeType: 'company',
                  scopeId: null,
                },
              ])
            }
          >
            {t('users.addRole')}
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};

const ResetPasswordModal = ({ user, onClose }: { user: Row; onClose: () => void }) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/users/${user.id}/reset-password`, { password });
      notifications.show({ color: 'teal', message: t('users.resetDone') });
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      opened
      onClose={onClose}
      title={`${t('users.resetPassword')} — ${String(user['displayName'])}`}
      centered
    >
      <Stack>
        <PasswordInput
          label={t('users.newPassword')}
          description={t('users.initialPasswordHint')}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          dir="ltr"
          autoComplete="new-password"
          error={error}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!password}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export const UsersPage = () => {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, form] = useDisclosure(false);
  const [rolesFor, setRolesFor] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<Row | null>(null);

  const list = useList('/users', {
    page,
    pageSize: PAGE_SIZE,
    q: debounced || undefined,
    status: status ?? undefined,
  });
  const save = useSave('/users');

  const fields: FieldDef[] = editing
    ? [
        {
          name: 'displayName',
          labelKey: 'displayName',
          label: t('users.displayName'),
          kind: 'text',
          required: true,
        },
        { name: 'email', label: t('users.email'), kind: 'text', required: true, ltr: true },
        { name: 'username', label: t('users.username'), kind: 'text', ltr: true },
      ]
    : [
        { name: 'displayName', label: t('users.displayName'), kind: 'text', required: true },
        { name: 'email', label: t('users.email'), kind: 'text', required: true, ltr: true },
        { name: 'username', label: t('users.username'), kind: 'text', ltr: true },
        {
          name: 'password',
          label: t('users.initialPassword'),
          description: t('users.initialPasswordHint'),
          kind: 'password',
          required: true,
        },
      ];

  const submit = (values: Record<string, unknown>) =>
    save.mutate(
      { id: editing?.id, body: editing ? { ...values, version: editing.version } : values },
      {
        onSuccess: (saved) => {
          notifications.show({ color: 'teal', message: t('table.saved') });
          form.close();
          if (!editing && can('identity.user.update')) setRolesFor(saved.id); // المستخدم الجديد بلا أدوار: انتقل لإسنادها
        },
        onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
      },
    );

  const toggle = (u: Row) => {
    const disabling = u['status'] === 'active';
    const run = () =>
      save.mutate(
        { id: u.id, body: { status: disabling ? 'disabled' : 'active', version: u.version } },
        { onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }) },
      );
    if (!disabling) return run();
    modals.openConfirmModal({
      title: t('users.disable'),
      children: <Text size="sm">{t('users.disableConfirm')}</Text>,
      labels: { confirm: t('users.disable'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: run,
    });
  };

  const columns: Column<Row>[] = [
    { key: 'displayName', header: t('users.displayName'), render: (u) => String(u['displayName']) },
    { key: 'email', header: t('users.email'), render: (u) => String(u['email']), ltr: true },
    {
      key: 'username',
      header: t('users.username'),
      render: (u) => String(u['username'] ?? '—'),
      ltr: true,
    },
    {
      key: 'status',
      header: t('users.status'),
      render: (u) => (
        <Group gap={4}>
          <Badge color={u['status'] === 'active' ? 'teal' : 'gray'} variant="light">
            {u['status'] === 'active' ? t('table.active') : t('table.inactive')}
          </Badge>
          {u['lockedUntil'] && new Date(String(u['lockedUntil'])) > new Date() ? (
            <Badge color="red" variant="light">
              {t('users.locked')}
            </Badge>
          ) : null}
          {u['mustChangePassword'] === true && (
            <Badge color="yellow" variant="light">
              {t('users.mustChange')}
            </Badge>
          )}
        </Group>
      ),
    },
    {
      key: 'lastLoginAt',
      header: t('users.lastLogin'),
      render: (u) =>
        u['lastLoginAt'] ? new Date(String(u['lastLoginAt'])).toLocaleString(i18n.language) : '—',
    },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('users.title')}</Title>
        {can('identity.user.create') && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              form.open();
            }}
          >
            {t('users.newUser')}
          </Button>
        )}
      </Group>
      <Group>
        <TextInput
          placeholder={t('table.search')}
          value={search}
          onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))}
          w={260}
        />
        <Select
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          placeholder={t('table.all')}
          clearable
          data={[
            { value: 'active', label: t('table.active') },
            { value: 'disabled', label: t('table.inactive') },
          ]}
          w={160}
        />
      </Group>
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        actions={(u) => (
          <>
            {can('identity.user.update') && (
              <Tooltip label={t('table.edit')}>
                <ActionIcon
                  variant="subtle"
                  aria-label={t('table.edit')}
                  onClick={() => (setEditing(u), form.open())}
                >
                  <IconEdit size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {can('identity.user.update') && (
              <Tooltip label={t('users.manageRoles')}>
                <ActionIcon
                  variant="subtle"
                  aria-label={t('users.manageRoles')}
                  onClick={() => setRolesFor(u.id)}
                >
                  <IconShieldCog size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {can('identity.user.reset_password') && (
              <Tooltip label={t('users.resetPassword')}>
                <ActionIcon
                  variant="subtle"
                  aria-label={t('users.resetPassword')}
                  onClick={() => setResetFor(u)}
                >
                  <IconKey size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {can('identity.user.update') && u.id !== me?.id && (
              <Tooltip label={u['status'] === 'active' ? t('users.disable') : t('users.enable')}>
                <ActionIcon
                  variant="subtle"
                  color={u['status'] === 'active' ? 'orange' : 'teal'}
                  aria-label={u['status'] === 'active' ? t('users.disable') : t('users.enable')}
                  onClick={() => toggle(u)}
                >
                  {u['status'] === 'active' ? (
                    <IconPlayerPause size={16} />
                  ) : (
                    <IconPlayerPlay size={16} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}
          </>
        )}
      />
      <Modal
        opened={formOpen}
        onClose={form.close}
        title={editing ? t('users.editUser') : t('users.newUser')}
        centered
      >
        {formOpen && (
          <DynamicForm
            key={editing?.id ?? 'new'}
            fields={fields}
            schema={
              editing
                ? userUpdateInput.omit({ version: true, status: true })
                : userCreateInput.omit({ roles: true })
            }
            initial={
              editing
                ? {
                    displayName: editing['displayName'],
                    email: editing['email'],
                    username: editing['username'] ?? '',
                  }
                : { displayName: '', email: '', username: '', password: '' }
            }
            editing={!!editing}
            submitting={save.isPending}
            onSubmit={submit}
            onCancel={form.close}
          />
        )}
      </Modal>
      {rolesFor && <RoleAssignmentsModal userId={rolesFor} onClose={() => setRolesFor(null)} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </Stack>
  );
};
