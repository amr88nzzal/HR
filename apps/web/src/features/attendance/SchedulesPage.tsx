import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
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
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { segmentsText, type ShiftRow } from './ShiftsPage';

type Day = { weekday: number; shiftId: string | null };
type ScheduleRow = {
  id: string;
  version: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
  days: Day[];
};
type Assignment = {
  id: string;
  scheduleId: string;
  scope: 'company' | 'branch' | 'department' | 'employee';
  scopeRef: string | null;
  validFrom: string;
  validTo: string | null;
};
type Named = { id: string; nameAr: string; nameEn: string | null };
type Resolved = {
  scheduleCode: string;
  scope: string;
  shift: ShiftRow | null;
} | null;
const SCOPES = ['company', 'branch', 'department', 'employee'] as const;
const WEEK = [0, 1, 2, 3, 4, 5, 6];

const useShifts = () =>
  useQuery({
    queryKey: ['/shifts', 'list'],
    queryFn: async () => (await api.get<ShiftRow[]>('/shifts')).data,
  });

const ScheduleModal = ({ row, onClose }: { row: ScheduleRow | null; onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const shifts = useShifts();
  const dayNames = (t('settingsPage.weekdays', { returnObjects: true }) as string[]) ?? [];
  const [code, setCode] = useState(row?.code ?? '');
  const [nameAr, setNameAr] = useState(row?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(row?.nameEn ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [days, setDays] = useState<Record<number, string | null>>(
    Object.fromEntries(
      WEEK.map((w) => [w, row?.days.find((d) => d.weekday === w)?.shiftId ?? null]),
    ),
  );
  const body = () => ({
    code: code.trim(),
    nameAr: nameAr.trim(),
    nameEn: nameEn.trim() || null,
    isActive,
    days: WEEK.map((weekday) => ({ weekday, shiftId: days[weekday] ?? null })),
  });
  const save = useMutation({
    mutationFn: async () =>
      row
        ? (await api.patch(`/work-schedules/${row.id}`, { ...body(), version: row.version })).data
        : (await api.post('/work-schedules', body())).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendance.saved') });
      await qc.invalidateQueries({ queryKey: ['/work-schedules'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const options = (shifts.data ?? [])
    .filter((s) => s.isActive || Object.values(days).includes(s.id))
    .map((s) => ({
      value: s.id,
      label: `${s.code} — ${localName(s, i18n.language)} (${segmentsText(s.segments)})`,
    }));
  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      centered
      title={row ? t('attendanceSchedules.edit') : t('attendanceSchedules.add')}
    >
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput
            label={t('attendanceSchedules.code')}
            required
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <TextInput
            label={t('attendanceSchedules.nameAr')}
            required
            value={nameAr}
            onChange={(e) => setNameAr(e.currentTarget.value)}
          />
          <TextInput
            label={t('attendanceSchedules.nameEn')}
            value={nameEn}
            onChange={(e) => setNameEn(e.currentTarget.value)}
          />
          <Switch
            mt={28}
            label={t('attendanceSchedules.isActive')}
            checked={isActive}
            onChange={(e) => setIsActive(e.currentTarget.checked)}
          />
        </SimpleGrid>
        <Text fw={600} size="sm">
          {t('attendanceSchedules.days')}
        </Text>
        {WEEK.map((w) => (
          <Group key={w} wrap="nowrap" align="center">
            <Text w={80} size="sm">
              {dayNames[w]}
            </Text>
            <Select
              flex={1}
              aria-label={dayNames[w]}
              clearable
              placeholder={t('attendanceSchedules.dayOff')}
              data={options}
              value={days[w] ?? null}
              onChange={(v) => setDays((d) => ({ ...d, [w]: v }))}
            />
          </Group>
        ))}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!code.trim() || !nameAr.trim()}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const SchedulesTab = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ScheduleRow | 'new' | null>(null);
  const shifts = useShifts();
  const dayNames = (t('settingsPage.weekdays', { returnObjects: true }) as string[]) ?? [];
  const q = useQuery({
    queryKey: ['/work-schedules', 'list'],
    queryFn: async () => (await api.get<ScheduleRow[]>('/work-schedules')).data,
  });
  const del = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/work-schedules/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/work-schedules'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirmDelete = (s: ScheduleRow) =>
    modals.openConfirmModal({
      title: s.code,
      children: <Text size="sm">{t('attendanceSchedules.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(s.id),
    });
  const shiftCode = (id: string | null) =>
    id ? (shifts.data?.find((s) => s.id === id)?.code ?? '…') : '—';
  return (
    <Stack>
      {can('attendance.schedule.create') && (
        <Group justify="flex-end">
          <Button onClick={() => setEditing('new')}>{t('attendanceSchedules.add')}</Button>
        </Group>
      )}
      <Table.ScrollContainer minWidth={760}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('attendanceSchedules.code')}</Table.Th>
              <Table.Th>{t('attendanceSchedules.nameAr')}</Table.Th>
              {WEEK.map((w) => (
                <Table.Th key={w} ta="center">
                  {(dayNames[w] ?? '').slice(0, 3)}
                </Table.Th>
              ))}
              <Table.Th />
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(q.data ?? []).map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td dir="ltr" ta="start">
                  {s.code}
                </Table.Td>
                <Table.Td>{localName(s, i18n.language)}</Table.Td>
                {WEEK.map((w) => {
                  const id = s.days.find((d) => d.weekday === w)?.shiftId ?? null;
                  return (
                    <Table.Td key={w} ta="center" dir="ltr">
                      <Badge variant={id ? 'light' : 'outline'} color={id ? 'blue' : 'gray'}>
                        {id ? shiftCode(id) : t('attendanceSchedules.dayOff')}
                      </Badge>
                    </Table.Td>
                  );
                })}
                <Table.Td>
                  {!s.isActive && (
                    <Badge color="gray" variant="light">
                      {t('table.inactive')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {can('attendance.schedule.update') && (
                      <Button size="compact-xs" variant="default" onClick={() => setEditing(s)}>
                        {t('table.edit')}
                      </Button>
                    )}
                    {can('attendance.schedule.delete') && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => confirmDelete(s)}
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
        <ScheduleModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
};

const AssignmentModal = ({
  schedules,
  onClose,
}: {
  schedules: ScheduleRow[];
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('company');
  const [ref, setRef] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const branches = useList<Named>('/branches', { pageSize: 200 }, scope === 'branch');
  const depts = useList<Named>('/departments', { pageSize: 200 }, scope === 'department');
  const refOptions = (scope === 'branch' ? branches : depts).data?.data ?? [];
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/schedule-assignments', {
          scheduleId,
          scope,
          scopeRef: scope === 'company' ? null : ref,
          validFrom: from,
          validTo: to || null,
        })
      ).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendance.saved') });
      await qc.invalidateQueries({ queryKey: ['/schedule-assignments'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('attendanceSchedules.addAssignment')} centered>
      <Stack>
        <Select
          label={t('attendanceSchedules.schedule')}
          required
          data={schedules
            .filter((s) => s.isActive)
            .map((s) => ({ value: s.id, label: `${s.code} — ${localName(s, i18n.language)}` }))}
          value={scheduleId}
          onChange={setScheduleId}
        />
        <Select
          label={t('leave.scope')}
          allowDeselect={false}
          data={SCOPES.map((s) => ({ value: s, label: t(`leave.scopes.${s}`) }))}
          value={scope}
          onChange={(v) => {
            setScope((v as (typeof SCOPES)[number]) ?? 'company');
            setRef(null);
          }}
        />
        {(scope === 'branch' || scope === 'department') && (
          <Select
            label={t('leave.scopeRef')}
            required
            data={refOptions.map((r) => ({ value: r.id, label: localName(r, i18n.language) }))}
            value={ref}
            onChange={setRef}
          />
        )}
        {scope === 'employee' && (
          <EmployeeSelect label={t('attendance.employee')} value={ref} onChange={setRef} />
        )}
        <Group grow>
          <TextInput
            type="date"
            dir="ltr"
            label={t('attendanceSchedules.validFrom')}
            required
            value={from}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
          <TextInput
            type="date"
            dir="ltr"
            label={t('attendanceSchedules.validTo')}
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
        </Group>
        <Text size="xs" c="dimmed">
          {t('attendanceSchedules.scopeHint')}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!scheduleId || !from || (scope !== 'company' && !ref)}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const AssignmentsTab = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const schedules = useQuery({
    queryKey: ['/work-schedules', 'list'],
    queryFn: async () => (await api.get<ScheduleRow[]>('/work-schedules')).data,
  });
  const branches = useList<Named>('/branches', { pageSize: 200 });
  const depts = useList<Named>('/departments', { pageSize: 200 });
  const list = useQuery({
    queryKey: ['/schedule-assignments', 'list'],
    queryFn: async () => (await api.get<Assignment[]>('/schedule-assignments')).data,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/schedule-assignments/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/schedule-assignments'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const find = (rows: Named[] | undefined, id: string | null) => {
    const r = rows?.find((x) => x.id === id);
    return r ? localName(r, i18n.language) : '—';
  };
  const refName = (a: Assignment) =>
    a.scope === 'company'
      ? t('leave.scopes.company')
      : a.scope === 'branch'
        ? find(branches.data?.data, a.scopeRef)
        : a.scope === 'department'
          ? find(depts.data?.data, a.scopeRef)
          : (a.scopeRef ?? '—').slice(0, 8);
  return (
    <Stack>
      {can('attendance.schedule.create') && (
        <Group justify="flex-end">
          <Button onClick={() => setAdding(true)}>{t('attendanceSchedules.addAssignment')}</Button>
        </Group>
      )}
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('attendanceSchedules.schedule')}</Table.Th>
            <Table.Th>{t('leave.scope')}</Table.Th>
            <Table.Th>{t('leave.scopeRef')}</Table.Th>
            <Table.Th>{t('attendanceSchedules.validFrom')}</Table.Th>
            <Table.Th>{t('attendanceSchedules.validTo')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((a) => {
            const s = schedules.data?.find((x) => x.id === a.scheduleId);
            return (
              <Table.Tr key={a.id}>
                <Table.Td>{s ? `${s.code} — ${localName(s, i18n.language)}` : '—'}</Table.Td>
                <Table.Td>{t(`leave.scopes.${a.scope}`)}</Table.Td>
                <Table.Td>{refName(a)}</Table.Td>
                <Table.Td>{fmt.date(a.validFrom)}</Table.Td>
                <Table.Td>{a.validTo ? fmt.date(a.validTo) : '—'}</Table.Td>
                <Table.Td>
                  {can('attendance.schedule.delete') && (
                    <Button
                      size="compact-xs"
                      color="red"
                      variant="light"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: t('table.delete'),
                          labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
                          confirmProps: { color: 'red' },
                          onConfirm: () => remove.mutate(a.id),
                        })
                      }
                    >
                      {t('table.delete')}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {adding && (
        <AssignmentModal schedules={schedules.data ?? []} onClose={() => setAdding(false)} />
      )}
    </Stack>
  );
};

const CheckTab = () => {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [result, setResult] = useState<{ value: Resolved } | null>(null);
  const run = useMutation({
    mutationFn: async () =>
      (
        await api.get<Resolved>('/schedule-assignments/resolve', {
          employeeId: employeeId as string,
          date,
        })
      ).data,
    onSuccess: (v) => setResult({ value: v }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const r = result?.value ?? null;
  return (
    <Stack maw={460}>
      <Text fw={600}>{t('attendanceSchedules.checkTitle')}</Text>
      <EmployeeSelect
        label={t('attendance.employee')}
        value={employeeId}
        onChange={(v) => {
          setEmployeeId(v);
          setResult(null);
        }}
      />
      <TextInput
        type="date"
        dir="ltr"
        label={t('attendance.date')}
        value={date}
        onChange={(e) => {
          setDate(e.currentTarget.value);
          setResult(null);
        }}
      />
      <Group>
        <Button
          disabled={!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)}
          loading={run.isPending}
          onClick={() => run.mutate()}
        >
          {t('attendanceSchedules.check')}
        </Button>
      </Group>
      {result && (
        <Card withBorder data-testid="check-result">
          {!r ? (
            <Text c="dimmed">{t('attendanceSchedules.noSchedule')}</Text>
          ) : (
            <Stack gap={4}>
              <Text size="sm">
                {t('attendanceSchedules.schedule')}: <b dir="ltr">{r.scheduleCode}</b> (
                {t(`leave.scopes.${r.scope}`)})
              </Text>
              <Text size="sm">
                {r.shift ? (
                  <>
                    {t('attendanceSchedules.shift')}: <b dir="ltr">{r.shift.code}</b> —{' '}
                    <span dir="ltr">{segmentsText(r.shift.segments)}</span>
                  </>
                ) : (
                  t('attendanceSchedules.dayOffResult')
                )}
              </Text>
            </Stack>
          )}
        </Card>
      )}
    </Stack>
  );
};

/** جداول الدوام الأسبوعية، وتعيينها على شركة/فرع/قسم/موظف، وفحص الجدول الساري. */
export const SchedulesPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('nav.attendanceSchedules')}</Title>
      <Tabs defaultValue="schedules">
        <Tabs.List>
          <Tabs.Tab value="schedules">{t('attendanceSchedules.tabs.schedules')}</Tabs.Tab>
          <Tabs.Tab value="assignments">{t('attendanceSchedules.tabs.assignments')}</Tabs.Tab>
          <Tabs.Tab value="check">{t('attendanceSchedules.tabs.check')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="schedules" pt="md">
          <SchedulesTab />
        </Tabs.Panel>
        <Tabs.Panel value="assignments" pt="md">
          <AssignmentsTab />
        </Tabs.Panel>
        <Tabs.Panel value="check" pt="md">
          <CheckTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
