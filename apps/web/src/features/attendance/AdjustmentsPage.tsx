import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { hm } from './types';

const PAGE_SIZE = 20;
const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
type Status = (typeof STATUSES)[number];
const COLORS: Record<Status, string> = {
  pending: 'yellow',
  approved: 'teal',
  rejected: 'red',
  withdrawn: 'gray',
};

type Policy = { mode: 'both' | 'request' | 'direct'; windowDays: number };
type CorrectionRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  dayDate: string;
  inAt: string;
  outAt: string;
  reason: string;
  method: 'request' | 'direct';
  status: Status;
};
type OvertimeRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  dayDate: string;
  minutes: number;
  reason: string;
  kind: 'pre' | 'post';
  status: Status;
  surplusMinutes: number | null;
  overtimeMinutes: number | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const usePolicy = () =>
  useQuery({
    queryKey: ['/attendance-corrections', 'policy'],
    queryFn: async () => (await api.get<Policy>('/attendance-corrections/policy')).data,
    retry: false,
  });

const StatusBadge = ({ status }: { status: Status }) => {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={COLORS[status]}>
      {t(`adjust.statuses.${status}`)}
    </Badge>
  );
};

/** نموذج طلب تعديل حضور أو تعديل مباشر (الإدارة). */
const CorrectionModal = ({
  opened,
  onClose,
  direct,
  canPick,
}: {
  opened: boolean;
  onClose: () => void;
  direct: boolean;
  canPick: boolean;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [inTime, setInTime] = useState('08:00');
  const [outTime, setOutTime] = useState('16:00');
  const [nextDay, setNextDay] = useState(false);
  const [reason, setReason] = useState('');
  const needEmployee = direct || (canPick && employeeId !== null);
  const save = useMutation({
    mutationFn: async () =>
      api.post(direct ? '/attendance-corrections/direct' : '/attendance-corrections', {
        employeeId: employeeId ?? undefined,
        date,
        inTime,
        outTime,
        outNextDay: nextDay,
        reason,
      }),
    onSuccess: async () => {
      notifications.show({
        color: 'teal',
        message: t(direct ? 'adjust.savedDirect' : 'adjust.submitted'),
      });
      setReason('');
      onClose();
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
      await qc.invalidateQueries({ queryKey: ['/attendance-corrections'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const valid =
    !!date && !!reason.trim() && (!direct || !!employeeId) && (nextDay || outTime > inTime);
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t(direct ? 'adjust.directTitle' : 'adjust.correctionTitle')}
    >
      <Stack>
        {(direct || canPick) && (
          <EmployeeSelect
            label={t('attendance.employee')}
            value={employeeId}
            onChange={setEmployeeId}
          />
        )}
        <TextInput
          type="date"
          label={t('attendance.date')}
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <Group grow>
          <TextInput
            type="time"
            label={t('adjust.inTime')}
            value={inTime}
            onChange={(e) => setInTime(e.currentTarget.value)}
          />
          <TextInput
            type="time"
            label={t('adjust.outTime')}
            value={outTime}
            onChange={(e) => setOutTime(e.currentTarget.value)}
          />
        </Group>
        <Switch
          label={t('adjust.outNextDay')}
          checked={nextDay}
          onChange={(e) => setNextDay(e.currentTarget.checked)}
        />
        <Textarea
          label={t('adjust.reason')}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          minRows={2}
        />
        {needEmployee && !direct && (
          <Text size="xs" c="dimmed">
            {t('adjust.onBehalf')}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {t(direct ? 'adjust.saveDirect' : 'adjust.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const OvertimeModal = ({
  opened,
  onClose,
  canPick,
}: {
  opened: boolean;
  onClose: () => void;
  canPick: boolean;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [minutes, setMinutes] = useState<number | string>(60);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      api.post('/overtime-requests', {
        employeeId: employeeId ?? undefined,
        date,
        minutes: Number(minutes),
        reason,
      }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('adjust.submitted') });
      setReason('');
      onClose();
      await qc.invalidateQueries({ queryKey: ['/overtime-requests'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened={opened} onClose={onClose} title={t('adjust.overtimeTitle')}>
      <Stack>
        {canPick && (
          <EmployeeSelect
            label={t('attendance.employee')}
            value={employeeId}
            onChange={setEmployeeId}
          />
        )}
        <TextInput
          type="date"
          label={t('attendance.date')}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <Text size="xs" c="dimmed">
          {t(date >= todayIso() ? 'adjust.kindPreHint' : 'adjust.kindPostHint')}
        </Text>
        <NumberInput
          label={t('adjust.minutes')}
          min={1}
          max={1440}
          value={minutes}
          onChange={setMinutes}
        />
        <Textarea
          label={t('adjust.reason')}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          minRows={2}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!date || !reason.trim() || Number(minutes) < 1}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('adjust.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

type ListProps = { all: boolean };

const useAdjustList = <T,>(base: string, all: boolean, status: string | null, page: number) =>
  useQuery({
    queryKey: [base, all ? 'all' : 'me', status, page],
    queryFn: async () => {
      const r = await api.get<T[]>(all ? base : `${base}/me`, {
        page,
        pageSize: PAGE_SIZE,
        status: status ?? undefined,
      });
      return { rows: r.data, total: (r.meta as { total?: number } | undefined)?.total ?? 0 };
    },
    retry: false,
  });

const StatusFilter = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Select
      aria-label={t('attendance.status')}
      placeholder={t('attendance.allStatuses')}
      clearable
      w={180}
      data={STATUSES.map((s) => ({ value: s, label: t(`adjust.statuses.${s}`) }))}
      value={value}
      onChange={onChange}
    />
  );
};

const useWithdraw = (base: string) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.post(`${base}/${id}/withdraw`, {}),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('adjust.withdrawn') });
      await qc.invalidateQueries({ queryKey: [base] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
};

const CorrectionsTab = ({ all }: ListProps) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = (s: string) =>
    new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const policy = usePolicy();
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<'request' | 'direct' | null>(null);
  const q = useAdjustList<CorrectionRow>('/attendance-corrections', all, status, page);
  const withdraw = useWithdraw('/attendance-corrections');
  const mode = policy.data?.mode ?? 'both';
  const canManage = can('attendance.correction.manage');
  const columns: Column<CorrectionRow>[] = [
    ...(all
      ? [
          {
            key: 'emp',
            header: t('attendance.employee'),
            render: (r: CorrectionRow) => r.employeeName,
          },
        ]
      : []),
    { key: 'date', header: t('attendance.date'), render: (r) => r.dayDate, ltr: true },
    {
      key: 'times',
      header: t('adjust.times'),
      render: (r) => `${fmt(r.inAt)} – ${fmt(r.outAt)}`,
      ltr: true,
    },
    { key: 'reason', header: t('adjust.reason'), render: (r) => r.reason },
    { key: 'method', header: t('adjust.method'), render: (r) => t(`adjust.methods.${r.method}`) },
    {
      key: 'status',
      header: t('attendance.status'),
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];
  return (
    <Stack>
      <Group justify="space-between">
        <StatusFilter
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Group>
          {canManage && mode !== 'request' && (
            <Button variant="light" onClick={() => setOpen('direct')}>
              {t('adjust.directTitle')}
            </Button>
          )}
          {can('attendance.correction.submit') && mode !== 'direct' && (
            <Button onClick={() => setOpen('request')}>{t('adjust.newCorrection')}</Button>
          )}
        </Group>
      </Group>
      {mode === 'direct' && !canManage && (
        <Alert color="blue">{t('adjust.directOnlyNotice')}</Alert>
      )}
      {!all && policy.data && (
        <Text size="xs" c="dimmed">
          {t('adjust.windowNote', { days: policy.data.windowDays })}
        </Text>
      )}
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <DataTable
        columns={columns}
        rows={q.data?.rows ?? []}
        loading={q.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={q.data?.total ?? 0}
        onPage={setPage}
        actions={(r) =>
          r.status === 'pending' ? (
            <Button size="xs" variant="subtle" color="red" onClick={() => withdraw.mutate(r.id)}>
              {t('adjust.withdraw')}
            </Button>
          ) : null
        }
      />
      {open && (
        <CorrectionModal
          opened
          direct={open === 'direct'}
          canPick={canManage}
          onClose={() => setOpen(null)}
        />
      )}
    </Stack>
  );
};

const OvertimeTab = ({ all }: ListProps) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const q = useAdjustList<OvertimeRow>('/overtime-requests', all, status, page);
  const withdraw = useWithdraw('/overtime-requests');
  const columns: Column<OvertimeRow>[] = [
    ...(all
      ? [
          {
            key: 'emp',
            header: t('attendance.employee'),
            render: (r: OvertimeRow) => r.employeeName,
          },
        ]
      : []),
    { key: 'date', header: t('attendance.date'), render: (r) => r.dayDate, ltr: true },
    { key: 'kind', header: t('adjust.kind'), render: (r) => t(`adjust.kinds.${r.kind}`) },
    { key: 'minutes', header: t('adjust.requested'), render: (r) => hm(r.minutes), ltr: true },
    {
      key: 'surplus',
      header: t('attendance.surplus'),
      render: (r) => hm(r.surplusMinutes),
      ltr: true,
    },
    {
      key: 'counted',
      header: t('adjust.counted'),
      render: (r) => (r.status === 'approved' ? hm(r.overtimeMinutes) : '—'),
      ltr: true,
    },
    { key: 'reason', header: t('adjust.reason'), render: (r) => r.reason },
    {
      key: 'status',
      header: t('attendance.status'),
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];
  return (
    <Stack>
      <Group justify="space-between">
        <StatusFilter
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        {can('attendance.overtime.submit') && (
          <Button onClick={() => setOpen(true)}>{t('adjust.newOvertime')}</Button>
        )}
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <DataTable
        columns={columns}
        rows={q.data?.rows ?? []}
        loading={q.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={q.data?.total ?? 0}
        onPage={setPage}
        actions={(r) =>
          r.status === 'pending' ? (
            <Button size="xs" variant="subtle" color="red" onClick={() => withdraw.mutate(r.id)}>
              {t('adjust.withdraw')}
            </Button>
          ) : null
        }
      />
      {open && (
        <OvertimeModal
          opened
          canPick={can('attendance.overtime.manage')}
          onClose={() => setOpen(false)}
        />
      )}
    </Stack>
  );
};

/** إعداد طريقة التعديل ومهلة الموظف (لمن يملك صلاحية الإعدادات). */
const PolicyCard = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const policy = usePolicy();
  const save = useMutation({
    mutationFn: async (p: { key: string; value: unknown }) =>
      api.put(`/settings/company/${p.key}`, { value: p.value }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('adjust.policySaved') });
      await qc.invalidateQueries({ queryKey: ['/attendance-corrections', 'policy'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  if (!policy.data) return null;
  return (
    <Group align="flex-end">
      <Select
        label={t('adjust.modeLabel')}
        w={320}
        allowDeselect={false}
        data={(['both', 'request', 'direct'] as const).map((m) => ({
          value: m,
          label: t(`adjust.modes.${m}`),
        }))}
        value={policy.data.mode}
        onChange={(v) => v && save.mutate({ key: 'attendanceCorrectionMode', value: v })}
      />
      <NumberInput
        label={t('adjust.windowLabel')}
        w={200}
        min={0}
        max={365}
        value={policy.data.windowDays}
        onBlur={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isInteger(n) && n >= 0 && n <= 365 && n !== policy.data?.windowDays)
            save.mutate({ key: 'attendanceCorrectionWindowDays', value: n });
        }}
      />
    </Group>
  );
};

/** طلبات تعديل الحضور والعمل الإضافي: «طلباتي» للموظف و«الإدارة» لكل الموظفين. */
export const AdjustmentsPage = ({ all }: { all: boolean }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <Stack>
      <Title order={2}>{t(all ? 'nav.attendanceAdjustments' : 'nav.attendanceRequests')}</Title>
      {all && can('system.setting.update') && <PolicyCard />}
      <Tabs defaultValue="corrections" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="corrections">{t('adjust.tabs.corrections')}</Tabs.Tab>
          <Tabs.Tab value="overtime">{t('adjust.tabs.overtime')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="corrections" pt="md">
          <CorrectionsTab all={all} />
        </Tabs.Panel>
        <Tabs.Panel value="overtime" pt="md">
          <OvertimeTab all={all} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
