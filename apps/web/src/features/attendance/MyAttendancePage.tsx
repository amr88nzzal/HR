import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { monthGrid } from '../leave/calendar';
import { ATTENDANCE_STATUSES, STATUS_COLORS, hm, type DayRow } from './types';

/** تقويم الحضور الشهري: حالة كل يوم وأول دخول وآخر خروج والتأخير؛ ولمن يملك الصلاحية اختيار أي موظف. */
export const MyAttendancePage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const canPick = can('attendance.day.read_all');
  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const from = grid[0] as string;
  const to = grid[41] as string;
  const target = canPick ? employeeId : null;
  const q = useQuery({
    queryKey: ['/attendance', 'days', target ?? 'me', from, to],
    queryFn: async () =>
      (
        await (target
          ? api.get<DayRow[]>('/attendance/days', { employeeId: target, from, to })
          : api.get<DayRow[]>('/attendance/days/me', { from, to }))
      ).data,
    retry: false,
  });
  const byDate = new Map((q.data ?? []).map((d) => [d.dayDate, d]));
  const monthDays = (q.data ?? []).filter((d) => Number(d.dayDate.slice(5, 7)) - 1 === ym.m);
  const sum = (f: (d: DayRow) => number) => monthDays.reduce((a, d) => a + f(d), 0);
  const monthName = new Intl.DateTimeFormat(i18n.language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.y, ym.m, 1)));
  const dayNames = (t('settingsPage.weekdays', { returnObjects: true }) as string[]) ?? [];
  const shift = (d: number) =>
    setYm((s) => {
      const x = new Date(Date.UTC(s.y, s.m + d, 1));
      return { y: x.getUTCFullYear(), m: x.getUTCMonth() };
    });
  const rtl = i18n.dir() === 'rtl';

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={2}>{t('nav.myAttendance')}</Title>
        {canPick && (
          <Box w={300}>
            <EmployeeSelect
              label={t('attendance.selectEmployee')}
              value={employeeId}
              onChange={setEmployeeId}
            />
          </Box>
        )}
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Card withBorder padding="sm">
          <Text size="sm" c="dimmed">
            {t('attendance.daysPresent')}
          </Text>
          <Text fz={26} fw={700} dir="ltr" ta="start">
            {monthDays.filter((d) => d.status === 'present').length}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Text size="sm" c="dimmed">
            {t('attendance.daysAbsent')}
          </Text>
          <Text fz={26} fw={700} dir="ltr" ta="start">
            {monthDays.filter((d) => d.status === 'absent').length}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Text size="sm" c="dimmed">
            {t('attendance.totalWorked')}
          </Text>
          <Text fz={26} fw={700} dir="ltr" ta="start">
            {hm(sum((d) => d.workedMinutes))}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Text size="sm" c="dimmed">
            {t('attendance.totalLate')}
          </Text>
          <Text fz={26} fw={700} dir="ltr" ta="start">
            {hm(sum((d) => d.lateMinutes))}
          </Text>
        </Card>
      </SimpleGrid>
      <Group justify="center">
        <ActionIcon variant="default" onClick={() => shift(-1)} aria-label={t('leave.prevMonth')}>
          {rtl ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
        </ActionIcon>
        <Text fw={600} w={180} ta="center">
          {monthName}
        </Text>
        <ActionIcon variant="default" onClick={() => shift(1)} aria-label={t('leave.nextMonth')}>
          {rtl ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
        </ActionIcon>
      </Group>
      <Group gap="xs">
        {ATTENDANCE_STATUSES.map((s) => (
          <Badge key={s} variant="light" color={STATUS_COLORS[s]}>
            {t(`attendance.statuses.${s}`)}
          </Badge>
        ))}
      </Group>
      <SimpleGrid cols={7} spacing={2} data-testid="attendance-calendar">
        {dayNames.map((n) => (
          <Text key={n} size="xs" fw={600} ta="center" c="dimmed">
            {n}
          </Text>
        ))}
        {grid.map((date) => {
          const inMonth = Number(date.slice(5, 7)) - 1 === ym.m;
          const d = byDate.get(date);
          return (
            <Box
              key={date}
              p={4}
              mih={92}
              data-status={d?.status}
              style={{
                opacity: inMonth ? 1 : 0.45,
                borderRadius: 6,
                border: '1px solid var(--mantine-color-default-border)',
                background: d
                  ? `var(--mantine-color-${STATUS_COLORS[d.status]}-light)`
                  : 'transparent',
              }}
            >
              <Group justify="space-between" gap={2} wrap="nowrap">
                <Text size="xs" c="dimmed" dir="ltr">
                  {Number(date.slice(8, 10))}
                </Text>
                {d?.isOverridden && (
                  <Text size="10px" c="grape" title={d.overrideNote ?? ''}>
                    ✎
                  </Text>
                )}
              </Group>
              {d && (
                <Stack gap={0}>
                  <Text size="xs" fw={600}>
                    {t(`attendance.statuses.${d.status}`)}
                  </Text>
                  {d.firstIn && (
                    <Text size="10px" dir="ltr" ta="start">
                      {fmt.time(d.firstIn)}
                      {d.lastOut ? ` – ${fmt.time(d.lastOut)}` : ''}
                    </Text>
                  )}
                  {d.lateMinutes > 0 && (
                    <Text size="10px" c="red">
                      {t('attendance.late')} {hm(d.lateMinutes)}
                    </Text>
                  )}
                  {d.overtimeMinutes > 0 && (
                    <Text size="10px" c="teal">
                      {t('adjust.tabs.overtime')} {hm(d.overtimeMinutes)}
                    </Text>
                  )}
                  {d.earlyLeaveMinutes > 0 && (
                    <Text size="10px" c="orange">
                      {t('attendance.early')} {hm(d.earlyLeaveMinutes)}
                    </Text>
                  )}
                </Stack>
              )}
            </Box>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
};
