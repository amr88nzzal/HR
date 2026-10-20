import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  NativeSelect,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Modal,
  Switch,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ACTION_CATEGORIES, ACTION_STATUSES } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { csv, MultiFilter } from '../../components/MultiFilter';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { localName } from '../../lib/names';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { useLookup } from '../employees/shared';
import { categoryColor, statusColor, type ActionRow, type ActionType } from './types';

const PAGE = 25;
const today = () => new Date().toISOString().slice(0, 10);

type Suggestion = {
  count: number;
  threshold: number | null;
  windowDays: number | null;
  suggested: { id: string; nameAr: string } | null;
};

// ───────────── إضافة إجراء / New action ─────────────

export const NewActionModal = ({
  types,
  employeeId,
  typeCode,
  onClose,
}: {
  types: ActionType[];
  employeeId?: string;
  typeCode?: string;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const currencies = useLookup('/currencies', 'system.currency.read');
  const active = types.filter((x) => x.isActive);
  const [v, setV] = useState({
    employeeId: employeeId ?? '',
    typeId: active.find((x) => x.code === typeCode)?.id ?? '',
    title: '',
    description: '',
    actionDate: today(),
    effectiveDate: today(),
    amount: '',
    currency: '',
    submit: true,
  });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const type = types.find((x) => x.id === v.typeId);
  const needsAmount = !!type && type.payrollEffect !== 'none';
  const isPromotion = type?.category === 'promotion';
  const codes = currencies.rows.map((r) => String(r['code']));
  const currency = v.currency || codes[0] || '';
  const amountOk = /^\d{1,14}(\.\d{1,4})?$/.test(v.amount) && Number(v.amount) > 0;
  const valid =
    !!v.employeeId &&
    !!v.typeId &&
    v.title.trim().length > 0 &&
    (!needsAmount || (amountOk && !!currency)) &&
    !isPromotion;
  // اقتراح التصعيد عند اختيار الموظف والنوع / escalation hint once employee and type are chosen
  useQuery({
    queryKey: ['/admin-actions', 'suggest', v.employeeId, v.typeId],
    enabled: !!v.employeeId && !!v.typeId,
    queryFn: async () => {
      const r = (
        await api.get<Suggestion>('/admin-actions/suggest', {
          employeeId: v.employeeId,
          typeId: v.typeId,
        })
      ).data;
      setSuggestion(r);
      return r;
    },
  });
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ id: string; status: string }>('/admin-actions', {
          employeeId: v.employeeId,
          typeId: v.typeId,
          title: v.title.trim(),
          description: v.description.trim() || null,
          actionDate: v.actionDate,
          effectiveDate: v.effectiveDate,
          ...(needsAmount ? { amount: v.amount, currency } : {}),
          submit: v.submit,
        })
      ).data,
    onSuccess: async (r) => {
      notifications.show({
        color: 'teal',
        message: t('adminActions.created', { status: t(`adminActions.statuses.${r.status}`) }),
      });
      await qc.invalidateQueries({ queryKey: ['/admin-actions'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} size="lg" title={t('adminActions.new')}>
      <Stack>
        <EmployeeSelect
          label={t('adminActions.cols.employee')}
          value={v.employeeId || null}
          onChange={(id) => setV({ ...v, employeeId: id ?? '' })}
          disabled={!!employeeId}
        />
        <NativeSelect
          label={t('adminActions.cols.type')}
          value={v.typeId}
          onChange={(e) => setV({ ...v, typeId: e.currentTarget.value })}
          data={[
            { value: '', label: '—' },
            ...active.map((x) => ({
              value: x.id,
              label: `${localName(x, i18n.language)} (${t(`adminActions.categories.${x.category}`)})`,
            })),
          ]}
        />
        {isPromotion && <Alert color="orange">{t('adminActions.promotionNote')}</Alert>}
        {suggestion?.suggested && (
          <Alert color="orange" title={t('adminActions.escalationTitle')}>
            {t('adminActions.escalationBody', {
              count: suggestion.count,
              days: suggestion.windowDays ?? '—',
              next: suggestion.suggested.nameAr,
            })}
          </Alert>
        )}
        <TextInput
          label={t('adminActions.cols.title')}
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.currentTarget.value })}
        />
        <Textarea
          label={t('adminActions.description')}
          value={v.description}
          minRows={3}
          onChange={(e) => setV({ ...v, description: e.currentTarget.value })}
        />
        <Group grow>
          <TextInput
            type="date"
            dir="ltr"
            label={t('adminActions.cols.actionDate')}
            value={v.actionDate}
            onChange={(e) => setV({ ...v, actionDate: e.currentTarget.value })}
          />
          <TextInput
            type="date"
            dir="ltr"
            label={t('adminActions.cols.effectiveDate')}
            description={t('adminActions.effectiveHint')}
            value={v.effectiveDate}
            onChange={(e) => setV({ ...v, effectiveDate: e.currentTarget.value })}
          />
        </Group>
        {needsAmount && (
          <Group grow align="flex-start">
            <TextInput
              label={t('adminActions.cols.amount')}
              description={
                type?.payrollEffect === 'deduction'
                  ? t('adminActions.deductionHint')
                  : t('adminActions.bonusHint')
              }
              dir="ltr"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.currentTarget.value })}
              error={v.amount && !amountOk ? t('adminActions.amountInvalid') : undefined}
            />
            <NativeSelect
              label={t('payroll.run.currency')}
              value={currency}
              onChange={(e) => setV({ ...v, currency: e.currentTarget.value })}
              data={codes.length ? codes : ['']}
            />
          </Group>
        )}
        <Switch
          label={t('adminActions.submitNow')}
          description={
            type && !type.requiresApproval ? t('adminActions.noApprovalNote') : undefined
          }
          checked={v.submit}
          onChange={(e) => setV({ ...v, submit: e.currentTarget.checked })}
        />
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

// ───────────── تفاصيل الإجراء / Detail drawer ─────────────

export const DetailDrawer = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({
    queryKey: ['/admin-actions', id],
    queryFn: async () => (await api.get<ActionRow>(`/admin-actions/${id}`)).data,
  });
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['/admin-actions'] });
    await qc.invalidateQueries({ queryKey: ['/approvals'] });
  };
  const submit = useMutation({
    mutationFn: async () => api.post(`/admin-actions/${id}/submit`, {}),
    onSuccess: done,
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const cancel = useMutation({
    mutationFn: async () => api.post(`/admin-actions/${id}/cancel`, { reason: reason.trim() }),
    onSuccess: async () => {
      await done();
      setCancelling(false);
      setReason('');
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const issue = useMutation({
    mutationFn: async () =>
      api.post('/issued-documents', { employeeId: q.data?.employeeId, adminActionId: id }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('adminActions.letterIssued') });
      await qc.invalidateQueries({ queryKey: ['/admin-actions'] });
      await qc.invalidateQueries({ queryKey: ['/issued-documents'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  // تنزيل الخطاب الصادر / download the issued letter
  const download = async (docId: string) => {
    try {
      const blob = await api.blob(`/issued-documents/${docId}/content`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${q.data?.title ?? 'letter'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e, t) });
    }
  };
  const a = q.data;
  const canWrite = can('admin_actions.action.create') || can('admin_actions.action.propose');
  const canCancel =
    !!a &&
    a.status !== 'cancelled' &&
    (can('admin_actions.action.cancel') || a.status !== 'approved');
  const line = (label: string, value: string | null | undefined) => (
    <Group key={label} gap="xs" align="flex-start" wrap="nowrap">
      <Text size="sm" c="dimmed" w={140}>
        {label}
      </Text>
      <Text size="sm">{value || '—'}</Text>
    </Group>
  );
  return (
    <Drawer opened onClose={onClose} position="right" size="md" title={a?.title ?? ''}>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      {a && (
        <Stack>
          <Group gap="xs">
            <Badge color={categoryColor[a.category]} variant="light">
              {t(`adminActions.categories.${a.category}`)}
            </Badge>
            <Badge color={statusColor[a.status]}>{t(`adminActions.statuses.${a.status}`)}</Badge>
            {a.status === 'approved' && a.requiresAcknowledgment && (
              <Badge color={a.acknowledgedAt ? 'teal' : 'orange'} variant="light">
                {a.acknowledgedAt
                  ? t('adminActions.acknowledged')
                  : t('adminActions.notAcknowledged')}
              </Badge>
            )}
          </Group>
          {line(t('adminActions.cols.employee'), `${a.employeeNo} — ${a.employeeName}`)}
          {line(t('adminActions.cols.type'), a.typeName)}
          {line(t('adminActions.cols.actionDate'), fmt.date(a.actionDate))}
          {line(t('adminActions.cols.effectiveDate'), fmt.date(a.effectiveDate))}
          {a.amount && line(t('adminActions.cols.amount'), `${a.amount} ${a.currency ?? ''}`)}
          {a.payrollYear &&
            line(
              t('adminActions.payrollMonth'),
              `${a.payrollYear}-${String(a.payrollMonth).padStart(2, '0')}${a.appliedPeriodId ? ` (${t('adminActions.applied')})` : ''}`,
            )}
          {a.description && line(t('adminActions.description'), a.description)}
          {a.cancelReason && line(t('adminActions.cancelReason'), a.cancelReason)}
          {a.approvalRequestId && (
            <Button
              component={Link}
              to={'/approvals/$approvalId' as never}
              params={{ approvalId: a.approvalRequestId } as never}
              variant="light"
              size="xs"
              w="fit-content"
            >
              {t('adminActions.openApproval')}
            </Button>
          )}
          {a.status === 'approved' && (
            <Group>
              {!a.issuedDocumentId && a.letterTemplateCode && can('letters.document.issue') && (
                <Button variant="light" loading={issue.isPending} onClick={() => issue.mutate()}>
                  {t('adminActions.issueLetter')}
                </Button>
              )}
              {a.issuedDocumentId && can('letters.document.read') && (
                <Button variant="light" onClick={() => void download(a.issuedDocumentId as string)}>
                  {t('adminActions.downloadLetter')}
                </Button>
              )}
            </Group>
          )}
          <Group>
            {a.status === 'draft' && canWrite && (
              <Button loading={submit.isPending} onClick={() => submit.mutate()}>
                {t('adminActions.submit')}
              </Button>
            )}
            {canCancel && !cancelling && (
              <Button color="red" variant="light" onClick={() => setCancelling(true)}>
                {t('adminActions.cancel')}
              </Button>
            )}
          </Group>
          {cancelling && (
            <Stack>
              <Textarea
                label={t('adminActions.cancelReason')}
                value={reason}
                minRows={2}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
              <Group>
                <Button
                  color="red"
                  loading={cancel.isPending}
                  disabled={reason.trim().length < 3}
                  onClick={() => cancel.mutate()}
                >
                  {t('adminActions.confirmCancel')}
                </Button>
                <Button variant="default" onClick={() => setCancelling(false)}>
                  {t('common.cancel')}
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
};

// ───────────── القائمة / List ─────────────

export const AdminActionsPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const types = useQuery({
    queryKey: ['/admin-action-types'],
    enabled: can('admin_actions.type.read'),
    queryFn: async () => (await api.get<ActionType[]>('/admin-action-types')).data,
  });
  const params = (p: number, size: number) => ({
    page: p,
    pageSize: size,
    q: text.trim() || undefined,
    status: csv(status),
    category: csv(category),
    typeId: csv(typeIds),
    sort,
  });
  const q = useQuery({
    queryKey: ['/admin-actions', 'list', page, text, status, category, typeIds, sort],
    queryFn: async () => {
      const r = await api.get<ActionRow[]>('/admin-actions', params(page, PAGE));
      return {
        rows: r.data,
        total: Number((r.meta as { total?: number } | undefined)?.total ?? 0),
      };
    },
  });
  const reset = () => setPage(1);
  const columns: Column<ActionRow>[] = [
    {
      key: 'employee',
      header: t('adminActions.cols.employee'),
      sortKey: 'employee',
      render: (r) => `${r.employeeNo} — ${r.employeeName}`,
    },
    {
      key: 'type',
      header: t('adminActions.cols.type'),
      sortKey: 'type',
      render: (r) => (
        <Badge color={categoryColor[r.category]} variant="light">
          {r.typeName}
        </Badge>
      ),
      exportValue: (r) => r.typeName,
    },
    { key: 'title', header: t('adminActions.cols.title'), render: (r) => r.title },
    {
      key: 'actionDate',
      header: t('adminActions.cols.actionDate'),
      sortKey: 'actionDate',
      render: (r) => fmt.date(r.actionDate),
      exportValue: (r) => r.actionDate,
    },
    {
      key: 'effectiveDate',
      header: t('adminActions.cols.effectiveDate'),
      render: (r) => fmt.date(r.effectiveDate),
      exportValue: (r) => r.effectiveDate,
    },
    {
      key: 'amount',
      header: t('adminActions.cols.amount'),
      sortKey: 'amount',
      align: 'end',
      render: (r) => (r.amount ? `${r.amount} ${r.currency ?? ''}` : '—'),
    },
    {
      key: 'status',
      header: t('adminActions.cols.status'),
      sortKey: 'status',
      render: (r) => (
        <Group gap={4} wrap="nowrap">
          <Badge color={statusColor[r.status]}>{t(`adminActions.statuses.${r.status}`)}</Badge>
          {r.status === 'approved' && r.requiresAcknowledgment && !r.acknowledgedAt && (
            <Badge color="orange" variant="light">
              {t('adminActions.notAcknowledged')}
            </Badge>
          )}
        </Group>
      ),
      exportValue: (r) => t(`adminActions.statuses.${r.status}`),
    },
  ];
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.adminActions')}</Title>
        {(can('admin_actions.action.create') || can('admin_actions.action.propose')) && (
          <Button onClick={() => setCreating(true)}>{t('adminActions.new')}</Button>
        )}
      </Group>
      <Group align="flex-end">
        <TextInput
          label={t('adminActions.search')}
          value={text}
          w={220}
          onChange={(e) => {
            setText(e.currentTarget.value);
            reset();
          }}
        />
        <MultiFilter
          label={t('adminActions.cols.status')}
          data={ACTION_STATUSES.map((s) => ({ value: s, label: t(`adminActions.statuses.${s}`) }))}
          value={status}
          onChange={(v) => {
            setStatus(v);
            reset();
          }}
        />
        <MultiFilter
          label={t('adminActions.category')}
          data={ACTION_CATEGORIES.map((c) => ({
            value: c,
            label: t(`adminActions.categories.${c}`),
          }))}
          value={category}
          onChange={(v) => {
            setCategory(v);
            reset();
          }}
        />
        <MultiFilter
          label={t('adminActions.cols.type')}
          data={(types.data ?? []).map((x) => ({
            value: x.id,
            label: localName(x, i18n.language),
          }))}
          value={typeIds}
          onChange={(v) => {
            setTypeIds(v);
            reset();
          }}
        />
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <DataTable
        tableId="admin-actions"
        title={t('nav.adminActions')}
        columns={columns}
        rows={q.data?.rows ?? []}
        loading={q.isLoading}
        page={page}
        pageSize={PAGE}
        total={q.data?.total ?? 0}
        onPage={setPage}
        sort={sort}
        onSort={setSort}
        onRowClick={(r) => setOpen(r.id)}
        fetchAll={async () => (await api.get<ActionRow[]>('/admin-actions', params(1, 200))).data}
      />
      {creating && <NewActionModal types={types.data ?? []} onClose={() => setCreating(false)} />}
      {open && <DetailDrawer id={open} onClose={() => setOpen(null)} />}
    </Stack>
  );
};
