import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACTION_CATEGORIES, PAYROLL_EFFECTS, typeRulesError } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ActiveBadge, DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';
import { categoryColor, type ActionType } from './types';

const empty = {
  code: '',
  nameAr: '',
  nameEn: '',
  category: 'notice' as ActionType['category'],
  payrollEffect: 'none' as ActionType['payrollEffect'],
  requiresApproval: true,
  requiresAcknowledgment: true,
  letterTemplateCode: '',
  escalationTypeId: '',
  escalationCount: null as number | null,
  escalationWindowDays: null as number | null,
  isActive: true,
};

// ───────────── نموذج النوع / Type form ─────────────

const TypeModal = ({
  type,
  all,
  onClose,
}: {
  type: ActionType | null;
  all: ActionType[];
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = useState(
    type
      ? {
          ...empty,
          ...type,
          nameEn: type.nameEn ?? '',
          letterTemplateCode: type.letterTemplateCode ?? '',
          escalationTypeId: type.escalationTypeId ?? '',
        }
      : empty,
  );
  const set = (p: Partial<typeof empty>) => setV({ ...v, ...p });
  const canPay = v.category === 'penalty' || v.category === 'reward_cash';
  // نفس قواعد الخادم قبل الإرسال / same rules as the server before submitting
  const rulesMsg = typeRulesError({
    category: v.category,
    payrollEffect: canPay ? v.payrollEffect : 'none',
    escalationTypeId: v.escalationTypeId || null,
    escalationCount: v.escalationTypeId ? v.escalationCount : null,
  });
  const valid = /^[a-z][a-z0-9_]{1,39}$/.test(v.code) && v.nameAr.trim().length > 0 && !rulesMsg;
  const body = () => ({
    code: v.code,
    nameAr: v.nameAr.trim(),
    nameEn: v.nameEn.trim() || null,
    category: v.category,
    payrollEffect: canPay ? v.payrollEffect : 'none',
    requiresApproval: v.requiresApproval,
    requiresAcknowledgment: v.requiresAcknowledgment,
    letterTemplateCode: v.letterTemplateCode.trim() || null,
    escalationTypeId: v.escalationTypeId || null,
    escalationCount: v.escalationTypeId ? v.escalationCount : null,
    escalationWindowDays: v.escalationTypeId ? v.escalationWindowDays : null,
    isActive: v.isActive,
  });
  const save = useMutation({
    mutationFn: async () =>
      type
        ? api.patch(`/admin-action-types/${type.id}`, {
            ...body(),
            code: undefined,
            version: type.version,
          })
        : api.post('/admin-action-types', body()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['/admin-action-types'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={type ? t('adminActions.types.edit') : t('adminActions.types.new')}
    >
      <Stack>
        <Group grow align="flex-start">
          <TextInput
            label={t('adminActions.types.code')}
            description={t('adminActions.types.codeHint')}
            dir="ltr"
            value={v.code}
            disabled={!!type}
            onChange={(e) => set({ code: e.currentTarget.value })}
          />
          <NativeSelect
            label={t('adminActions.category')}
            value={v.category}
            onChange={(e) => set({ category: e.currentTarget.value as ActionType['category'] })}
            data={ACTION_CATEGORIES.map((c) => ({
              value: c,
              label: t(`adminActions.categories.${c}`),
            }))}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t('fields.nameAr')}
            value={v.nameAr}
            onChange={(e) => set({ nameAr: e.currentTarget.value })}
          />
          <TextInput
            label={t('fields.nameEn')}
            dir="ltr"
            value={v.nameEn}
            onChange={(e) => set({ nameEn: e.currentTarget.value })}
          />
        </Group>
        {canPay && (
          <NativeSelect
            label={t('adminActions.types.payrollEffect')}
            description={t('adminActions.types.payrollEffectHint')}
            value={v.payrollEffect}
            onChange={(e) =>
              set({ payrollEffect: e.currentTarget.value as ActionType['payrollEffect'] })
            }
            data={PAYROLL_EFFECTS.map((p) => ({
              value: p,
              label: t(`adminActions.effects.${p}`),
            }))}
          />
        )}
        <Switch
          label={t('adminActions.types.requiresApproval')}
          checked={v.requiresApproval}
          onChange={(e) => set({ requiresApproval: e.currentTarget.checked })}
        />
        <Switch
          label={t('adminActions.types.requiresAcknowledgment')}
          checked={v.requiresAcknowledgment}
          onChange={(e) => set({ requiresAcknowledgment: e.currentTarget.checked })}
        />
        <TextInput
          label={t('adminActions.types.letterTemplate')}
          description={t('adminActions.types.letterTemplateHint')}
          dir="ltr"
          value={v.letterTemplateCode}
          onChange={(e) => set({ letterTemplateCode: e.currentTarget.value })}
        />
        <Text fw={500} size="sm">
          {t('adminActions.types.escalation')}
        </Text>
        <Text size="xs" c="dimmed">
          {t('adminActions.types.escalationHint')}
        </Text>
        <NativeSelect
          label={t('adminActions.types.escalationNext')}
          value={v.escalationTypeId}
          onChange={(e) => set({ escalationTypeId: e.currentTarget.value })}
          data={[
            { value: '', label: '—' },
            ...all
              .filter((x) => x.id !== type?.id)
              .map((x) => ({ value: x.id, label: localName(x, i18n.language) })),
          ]}
        />
        {v.escalationTypeId && (
          <Group grow>
            <NumberInput
              label={t('adminActions.types.escalationCount')}
              min={2}
              max={20}
              allowDecimal={false}
              value={v.escalationCount ?? ''}
              onChange={(n) => set({ escalationCount: n === '' ? null : Number(n) })}
            />
            <NumberInput
              label={t('adminActions.types.escalationDays')}
              min={1}
              max={3650}
              allowDecimal={false}
              value={v.escalationWindowDays ?? ''}
              onChange={(n) => set({ escalationWindowDays: n === '' ? null : Number(n) })}
            />
          </Group>
        )}
        <Switch
          label={t('table.active')}
          checked={v.isActive}
          onChange={(e) => set({ isActive: e.currentTarget.checked })}
        />
        {rulesMsg && v.code && <Alert color="orange">{rulesMsg}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

// ───────────── الصفحة / Page ─────────────

export const AdminActionTypesPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ActionType | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['/admin-action-types'],
    queryFn: async () => (await api.get<ActionType[]>('/admin-action-types')).data,
  });
  const rows = q.data ?? [];
  const defaults = useMutation({
    mutationFn: async () =>
      (await api.post<{ created: number }>('/admin-action-types/defaults')).data,
    onSuccess: async (r) => {
      notifications.show({
        color: 'teal',
        message: t('adminActions.types.defaultsDone', { n: r.created }),
      });
      await qc.invalidateQueries({ queryKey: ['/admin-action-types'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`/admin-action-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/admin-action-types'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirmDelete = (r: ActionType) =>
    modals.openConfirmModal({
      title: t('adminActions.types.delete'),
      children: (
        <Text size="sm">
          {t('adminActions.types.deleteConfirm', { name: localName(r, i18n.language) })}
        </Text>
      ),
      labels: { confirm: t('adminActions.types.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(r.id),
    });

  const columns: Column<ActionType>[] = [
    { key: 'code', header: t('adminActions.types.code'), render: (r) => r.code, ltr: true },
    { key: 'name', header: t('fields.nameAr'), render: (r) => localName(r, i18n.language) },
    {
      key: 'category',
      header: t('adminActions.category'),
      render: (r) => (
        <Badge color={categoryColor[r.category]} variant="light">
          {t(`adminActions.categories.${r.category}`)}
        </Badge>
      ),
      exportValue: (r) => t(`adminActions.categories.${r.category}`),
    },
    {
      key: 'effect',
      header: t('adminActions.types.payrollEffect'),
      render: (r) => t(`adminActions.effects.${r.payrollEffect}`),
    },
    {
      key: 'approval',
      header: t('adminActions.types.requiresApproval'),
      render: (r) => (r.requiresApproval ? '✓' : ''),
      exportValue: (r) => r.requiresApproval,
    },
    {
      key: 'ack',
      header: t('adminActions.types.requiresAcknowledgment'),
      render: (r) => (r.requiresAcknowledgment ? '✓' : ''),
      exportValue: (r) => r.requiresAcknowledgment,
    },
    {
      key: 'escalation',
      header: t('adminActions.types.escalation'),
      render: (r) => {
        const next = rows.find((x) => x.id === r.escalationTypeId);
        return next
          ? `${r.escalationCount}× / ${r.escalationWindowDays} ${t('adminActions.types.days')} → ${localName(next, i18n.language)}`
          : '—';
      },
    },
    {
      key: 'isActive',
      header: t('table.active'),
      render: (r) => <ActiveBadge active={r.isActive} />,
      exportValue: (r) => r.isActive,
    },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.adminActionTypes')}</Title>
        <Group>
          {can('admin_actions.type.create') && (
            <Button
              variant="default"
              loading={defaults.isPending}
              onClick={() => defaults.mutate()}
            >
              {t('adminActions.types.createDefaults')}
            </Button>
          )}
          {can('admin_actions.type.create') && (
            <Button onClick={() => setEditing('new')}>{t('adminActions.types.new')}</Button>
          )}
        </Group>
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <DataTable
        tableId="admin-action-types"
        title={t('nav.adminActionTypes')}
        columns={columns}
        rows={rows}
        loading={q.isLoading}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        total={rows.length}
        onPage={() => undefined}
        actions={(r) => (
          <Group gap={4} wrap="nowrap">
            {can('admin_actions.type.update') && (
              <Button size="xs" variant="light" onClick={() => setEditing(r)}>
                {t('table.edit')}
              </Button>
            )}
            {can('admin_actions.type.delete') && (
              <Button size="xs" variant="subtle" color="red" onClick={() => confirmDelete(r)}>
                {t('adminActions.types.delete')}
              </Button>
            )}
          </Group>
        )}
      />
      {editing && (
        <TypeModal
          type={editing === 'new' ? null : editing}
          all={rows}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
};
