import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Paper,
  Select,
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
import { useList } from '../../api/hooks';
import { localName } from '../../lib/names';
import { monthGrid, requestsOn, weekdayOf, type CalendarData } from './calendar';

const MAX_CHIPS = 3;

/** تقويم الفريق: إجازات الشهر (المعتمدة بلون النوع، والمعلّقة بإطار منقّط) مع العطل والراحة الأسبوعية. */
export const TeamCalendarPage = () => {
  const { t, i18n } = useTranslation();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [deptId, setDeptId] = useState<string | null>(null);
  const depts = useList<{ id: string; nameAr: string; nameEn: string | null }>('/departments', {
    pageSize: 200,
  });
  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const from = grid[0] as string;
  const to = grid[41] as string;
  const q = useQuery({
    queryKey: ['/leave-requests', 'calendar', from, to, deptId],
    queryFn: async () =>
      (
        await api.get<CalendarData>('/leave-requests/calendar', {
          from,
          to,
          departmentId: deptId ?? undefined,
        })
      ).data,
  });
  const data = q.data;
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.holidayDate, h]));
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
      <Group justify="space-between">
        <Title order={2}>{t('nav.leaveCalendar')}</Title>
        <Select
          placeholder={t('leave.allDepartments')}
          clearable
          w={220}
          data={(depts.data?.data ?? []).map((d) => ({
            value: d.id,
            label: localName(d, i18n.language),
          }))}
          value={deptId}
          onChange={setDeptId}
        />
      </Group>
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
      <Group gap="md">
        <Badge variant="light">{t('leave.legendApproved')}</Badge>
        <Badge variant="outline" style={{ borderStyle: 'dashed' }}>
          {t('leave.legendPending')}
        </Badge>
        <Badge variant="light" color="orange">
          {t('leave.kinds.holiday')}
        </Badge>
      </Group>
      <SimpleGrid cols={7} spacing={2} data-testid="leave-calendar">
        {dayNames.map((n) => (
          <Text key={n} size="xs" fw={600} ta="center" c="dimmed">
            {n}
          </Text>
        ))}
        {grid.map((date) => {
          const inMonth = Number(date.slice(5, 7)) - 1 === ym.m;
          const off = (data?.weeklyOff ?? [5, 6]).includes(weekdayOf(date));
          const hol = holidays.get(date);
          const reqs = data ? requestsOn(data.requests, date) : [];
          return (
            <Paper
              key={date}
              withBorder
              p={4}
              mih={84}
              style={{
                opacity: inMonth ? 1 : 0.45,
                background: off ? 'var(--mantine-color-gray-light)' : undefined,
              }}
            >
              <Text size="xs" c="dimmed" dir="ltr" ta="start">
                {Number(date.slice(8, 10))}
              </Text>
              {hol && (
                <Text size="10px" c="orange" lineClamp={1} title={localName(hol, i18n.language)}>
                  {localName(hol, i18n.language)}
                </Text>
              )}
              <Stack gap={2} mt={2}>
                {reqs.slice(0, MAX_CHIPS).map((r) => (
                  <Box
                    key={r.id}
                    px={4}
                    title={`${r.employeeName} — ${localName({ nameAr: r.typeNameAr, nameEn: r.typeNameEn }, i18n.language)}`}
                    style={{
                      fontSize: 10,
                      borderRadius: 4,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      background:
                        r.status === 'approved'
                          ? (r.color ?? 'var(--mantine-color-blue-light)')
                          : 'transparent',
                      color: r.status === 'approved' && r.color ? '#fff' : undefined,
                      border:
                        r.status === 'pending'
                          ? `1px dashed ${r.color ?? 'var(--mantine-color-blue-6)'}`
                          : undefined,
                    }}
                  >
                    {r.employeeName}
                  </Box>
                ))}
                {reqs.length > MAX_CHIPS && (
                  <Text size="10px" c="dimmed">
                    +{reqs.length - MAX_CHIPS}
                  </Text>
                )}
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
};
