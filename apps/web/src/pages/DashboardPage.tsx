import { Anchor, Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type Dash = {
  me: {
    employeeLinked: boolean;
    pendingApprovals: number;
    leaveBalance?: string;
    pendingLeaveRequests?: number;
    latestPayslip?: { id: string; year: number; month: number } | null;
    today?: { status: string } | null;
  };
  org?: {
    headcount?: { active: number; suspended: number; newHires: number };
    leave?: { pending: number; onLeaveToday: number };
    attendance?: { present: number; absent: number; late: number; needsReview: number };
  };
  payroll?: {
    latestPeriod?: {
      year: number;
      month: number;
      status: string;
      currency: string;
      employeesCount: number;
      manualCount: number;
      errorCount: number;
      netTotal: string;
      payableTotal: string;
    } | null;
    pendingPayments?: { pending: number; amount: string };
    activeLoans?: { active: number };
  };
};

const Stat = ({
  label,
  value,
  to,
  color,
}: {
  label: string;
  value: string | number;
  to?: string;
  color?: string;
}) => {
  const body = (
    <Card withBorder padding="sm" h="100%">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fz={26} fw={700} dir="ltr" ta="start" c={color}>
        {value}
      </Text>
    </Card>
  );
  return to ? (
    <Anchor component={Link} to={to} underline="never" c="inherit">
      {body}
    </Anchor>
  ) : (
    body
  );
};

const money = (v: string): string =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 });

export const DashboardPage = () => {
  const { t } = useTranslation();
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ['/dashboard', 'summary'],
    queryFn: async () => (await api.get<Dash>('/dashboard/summary')).data,
    staleTime: 30_000,
  });
  const d = q.data;
  const pr = d?.payroll?.latestPeriod;
  return (
    <Stack>
      <Title order={2}>{t('dashboard.welcome', { name: me?.displayName })}</Title>
      {d && (
        <>
          <Stack gap="xs">
            <Title order={4}>{t('dashboard.me')}</Title>
            <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
              <Stat
                label={t('dashboard.w.pendingApprovals')}
                value={d.me.pendingApprovals}
                to="/approvals"
                color={d.me.pendingApprovals > 0 ? 'orange' : undefined}
              />
              {d.me.employeeLinked ? (
                <>
                  <Stat
                    label={t('dashboard.w.leaveBalance')}
                    value={Number(d.me.leaveBalance ?? 0)}
                    to="/leave"
                  />
                  <Stat
                    label={t('dashboard.w.pendingLeave')}
                    value={d.me.pendingLeaveRequests ?? 0}
                    to="/leave"
                  />
                  <Stat
                    label={t('dashboard.w.latestPayslip')}
                    value={
                      d.me.latestPayslip
                        ? `${d.me.latestPayslip.year}-${String(d.me.latestPayslip.month).padStart(2, '0')}`
                        : '—'
                    }
                    to="/me/payslips"
                  />
                  <Stat
                    label={t('dashboard.w.today')}
                    value={d.me.today ? t(`dashboard.statuses.${d.me.today.status}`) : '—'}
                    to="/attendance"
                  />
                </>
              ) : (
                <Text c="dimmed" size="sm">
                  {t('dashboard.w.notLinked')}
                </Text>
              )}
            </SimpleGrid>
          </Stack>

          {d.org && (
            <Stack gap="xs">
              <Title order={4}>{t('dashboard.org')}</Title>
              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
                {d.org.headcount && (
                  <>
                    <Stat
                      label={t('dashboard.w.headcount')}
                      value={d.org.headcount.active}
                      to="/employees"
                    />
                    <Stat label={t('dashboard.w.suspended')} value={d.org.headcount.suspended} />
                    <Stat label={t('dashboard.w.newHires')} value={d.org.headcount.newHires} />
                  </>
                )}
                {d.org.leave && (
                  <>
                    <Stat
                      label={t('dashboard.w.leavePending')}
                      value={d.org.leave.pending}
                      to="/approvals"
                    />
                    <Stat
                      label={t('dashboard.w.onLeaveToday')}
                      value={d.org.leave.onLeaveToday}
                      to="/leave/calendar"
                    />
                  </>
                )}
                {d.org.attendance && (
                  <>
                    <Stat
                      label={t('dashboard.w.present')}
                      value={d.org.attendance.present}
                      to="/attendance/daily"
                    />
                    <Stat
                      label={t('dashboard.w.absent')}
                      value={d.org.attendance.absent}
                      to="/attendance/daily"
                      color={d.org.attendance.absent > 0 ? 'red' : undefined}
                    />
                    <Stat
                      label={t('dashboard.w.late')}
                      value={d.org.attendance.late}
                      to="/attendance/daily"
                    />
                    <Stat
                      label={t('dashboard.w.needsReview')}
                      value={d.org.attendance.needsReview}
                      to="/attendance/daily"
                    />
                  </>
                )}
              </SimpleGrid>
            </Stack>
          )}

          {d.payroll && (
            <Stack gap="xs">
              <Group>
                <Title order={4}>{t('dashboard.payroll')}</Title>
                {pr && (
                  <Badge variant="light">
                    {t('dashboard.w.latestPeriod')}: {pr.year}-{String(pr.month).padStart(2, '0')} ·{' '}
                    {t(`payroll.run.statuses.${pr.status}`)}
                  </Badge>
                )}
              </Group>
              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
                {pr && (
                  <>
                    <Stat
                      label={`${t('dashboard.w.net')} (${pr.currency})`}
                      value={money(pr.netTotal)}
                      to="/payroll/periods"
                    />
                    <Stat
                      label={`${t('dashboard.w.payable')} (${pr.currency})`}
                      value={money(pr.payableTotal)}
                      to="/payroll/periods"
                    />
                    <Stat
                      label={t('dashboard.w.overrides')}
                      value={pr.manualCount}
                      color={pr.manualCount > 0 ? 'orange' : undefined}
                    />
                    <Stat
                      label={t('dashboard.w.errors')}
                      value={pr.errorCount}
                      color={pr.errorCount > 0 ? 'red' : undefined}
                    />
                  </>
                )}
                {d.payroll.pendingPayments && (
                  <Stat
                    label={t('dashboard.w.pendingPayments')}
                    value={d.payroll.pendingPayments.pending}
                    to="/payroll/periods"
                  />
                )}
                {d.payroll.activeLoans && (
                  <Stat
                    label={t('dashboard.w.activeLoans')}
                    value={d.payroll.activeLoans.active}
                    to="/payroll/loans"
                  />
                )}
              </SimpleGrid>
            </Stack>
          )}
          <Anchor component={Link} to="/reports">
            {t('dashboard.w.reports')}
          </Anchor>
        </>
      )}
    </Stack>
  );
};
