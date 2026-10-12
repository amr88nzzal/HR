import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
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
import {
  ATTENDANCE_STATUSES,
  STATUS_COLORS,
  hm,
  type AttendanceStatus,
  type DailyData,
  type DailyRow,
} from './types';

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const OverrideModal = ({
  row,
  date,
  onClose,
}: {
  row: DailyRow;
  date: string;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>(row.status ?? null);
  const [note, setNote] = useState(row.overrideNote ?? '');
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/attendance/days/override', {
          employeeId: row.employeeId,
          date,
          status,
          note,
        })
      ).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendance.saved') });
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal
      opened
      onClose={onClose}
      title={`${t('attendance.override')} — ${row.employeeName}`}
      centered
    >
      <Stack>
        {row.computedStatus && (
          <Text size="sm" c="dimmed">
            {t('attendance.computed')}: {t(`attendance.statuses.${row.computedStatus}`)}
          </Text>
        )}
        <Select
          label={t('attendance.overrideStatus')}
          data={ATTENDANCE_STATUSES.filter((s) => s !== 'pending').map((s) => ({
            value: s,
            label: t(`attendance.statuses.${s}`),
          }))}
          value={status}
          onChange={setStatus}
          allowDeselect={false}
        />
        <Textarea
          label={t('attendance.overrideNote')}
          required
          rows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          maxLength={300}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!status || !note.trim()}
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

/** اللوحة اليومية: حالة كل موظف في يوم واحد مع عدّاد الحالات، وتجاوز يدوي وإعادة احتساب. */
export const DailyBoardPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [deptId, setDeptId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<DailyRow | null>(null);
  const depts = useList<{ id: string; nameAr: string; nameEn: string | null }>('/departments', {
    pageSize: 200,
  });
  const branches = useList<{ id: string; nameAr: string; nameEn: string | null }>('/branches', {
    pageSize: 200,
  });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const q = useQuery({
    queryKey: ['/attendance', 'daily', date, deptId, branchId],
    enabled: valid,
    queryFn: async () =>
      (
        await api.get<DailyData>('/attendance/daily', {
          date,
          departmentId: deptId ?? undefined,
          branchId: branchId ?? undefined,
        })
      ).data,
  });
  const recompute = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ employees: number; days: number }>('/attendance/recompute', {
          from: date,
          to: date,
        })
      ).data,
    onSuccess: async (r) => {
      notifications.show({
        color: 'teal',
        message: t('attendance.recomputed', { days: r.days, employees: r.employees }),
      });
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const clear = useMutation({
    mutationFn: async (employeeId: string) =>
      (await api.post('/attendance/days/clear-override', { employeeId, date })).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const counts = q.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = (q.data?.rows ?? []).filter((r) => !status || (r.status ?? 'none') === status);
  const canOverride = can('attendance.day.override');

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={2}>{t('nav.attendanceDaily')}</Title>
        {can('attendance.day.recompute') && (
          <Button
            variant="default"
            loading={recompute.isPending}
            disabled={!valid}
            onClick={() => recompute.mutate()}
          >
            {t('attendance.recompute')}
          </Button>
        )}
      </Group>
      <Group align="flex-end">
        <TextInput
          type="date"
          label={t('attendance.date')}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
          w={170}
        />
        <Select
          label={t('attendance.department')}
          placeholder={t('attendance.allDepartments')}
          clearable
          w={200}
          data={(depts.data?.data ?? []).map((d) => ({
            value: d.id,
            label: localName(d, i18n.language),
          }))}
          value={deptId}
          onChange={setDeptId}
        />
        <Select
          label={t('attendance.branch')}
          placeholder={t('attendance.allBranches')}
          clearable
          w={200}
          data={(branches.data?.data ?? []).map((d) => ({
            value: d.id,
            label: localName(d, i18n.language),
          }))}
          value={branchId}
          onChange={setBranchId}
        />
      </Group>
      <Group gap="xs" data-testid="status-chips">
        <Badge
          size="lg"
          variant={status === null ? 'filled' : 'light'}
          style={{ cursor: 'pointer' }}
          onClick={() => setStatus(null)}
        >
          {t('attendance.allStatuses')} {total}
        </Badge>
        {[...ATTENDANCE_STATUSES, 'none' as const].map((s) =>
          counts[s] ? (
            <Badge
              key={s}
              size="lg"
              color={s === 'none' ? 'gray' : STATUS_COLORS[s as AttendanceStatus]}
              variant={status === s ? 'filled' : 'light'}
              style={{ cursor: 'pointer' }}
              onClick={() => setStatus(status === s ? null : s)}
            >
              {t(`attendance.statuses.${s}`)} {counts[s]}
            </Badge>
          ) : null,
        )}
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <Table.ScrollContainer minWidth={760}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('attendance.employee')}</Table.Th>
              <Table.Th>{t('attendance.status')}</Table.Th>
              <Table.Th>{t('attendance.firstIn')}</Table.Th>
              <Table.Th>{t('attendance.lastOut')}</Table.Th>
              <Table.Th>{t('attendance.worked')}</Table.Th>
              <Table.Th>{t('attendance.late')}</Table.Th>
              <Table.Th>{t('attendance.early')}</Table.Th>
              {canOverride && <Table.Th w={1}>{t('table.actions')}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.employeeId}>
                <Table.Td>
                  <Text size="sm">{r.employeeName}</Text>
                  <Text size="xs" c="dimmed" dir="ltr" ta="start">
                    {r.employeeNo}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Badge variant="light" color={r.status ? STATUS_COLORS[r.status] : 'gray'}>
                      {t(`attendance.statuses.${r.status ?? 'none'}`)}
                    </Badge>
                    {r.isOverridden && (
                      <Tooltip label={r.overrideNote ?? t('attendance.overridden')}>
                        <Badge variant="outline" color="grape">
                          ✎
                        </Badge>
                      </Tooltip>
                    )}
                    {r.diffWarning && (
                      <Tooltip label={t('attendance.diffWarning')}>
                        <Badge color="orange">!</Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {r.firstIn ? fmt.time(r.firstIn) : '—'}
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {r.lastOut ? fmt.time(r.lastOut) : '—'}
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {r.status ? hm(r.workedMinutes) : '—'}
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {r.lateMinutes ? hm(r.lateMinutes) : '—'}
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {r.earlyLeaveMinutes ? hm(r.earlyLeaveMinutes) : '—'}
                </Table.Td>
                {canOverride && (
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button size="compact-xs" variant="default" onClick={() => setEditing(r)}>
                        {t('attendance.override')}
                      </Button>
                      {r.isOverridden && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          loading={clear.isPending}
                          onClick={() => clear.mutate(r.employeeId)}
                        >
                          {t('attendance.clearOverride')}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {editing && <OverrideModal row={editing} date={date} onClose={() => setEditing(null)} />}
    </Stack>
  );
};
