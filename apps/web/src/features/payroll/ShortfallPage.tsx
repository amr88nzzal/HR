import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  SegmentedControl,
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
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHORTFALL_TARGETS, type ShortfallTarget } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { csv, MultiFilter } from '../../components/MultiFilter';
import { errorMessage } from '../../lib/errors';
import { useLookup, useOrgLookups } from '../employees/shared';

// ───────────── الأنواع / Types ─────────────

type ReportRow = {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName: string | null;
  payslipStatus: 'draft' | 'approved' | 'locked' | null;
  lateMinutes: number;
  earlyMinutes: number;
  occurrences: number;
  chargeableMinutes: number;
  daysDue: string;
  target: ShortfallTarget;
  decided: boolean;
  decisionReason: string | null;
  available: string;
  daysLeave: string;
  daysSalary: string;
  balanceShort: boolean;
  suggestAction: boolean;
};
type ReportMeta = { total: number; policyEnabled: boolean };

type Policy = {
  isEnabled: boolean;
  method: 'minutes' | 'tiers';
  countLate: boolean;
  countEarly: boolean;
  monthlyFreeMinutes: number;
  minutesPerDay: number;
  tiers: { from: number; dayFraction: string }[];
  defaultTarget: 'salary' | 'leave';
  leaveTypeId: string | null;
  suggestActionAfter: number | null;
  version?: number;
};

const targetColor: Record<ShortfallTarget, string> = {
  salary: 'red',
  leave: 'blue',
  split: 'grape',
  waive: 'gray',
};
/** عرض أيام بخانتين عشريتين / days shown with two decimals */
const d2 = (v: string) => Number(v).toFixed(2);

// ───────────── قرار المدير / Manager decision ─────────────

const DecisionModal = ({
  row,
  year,
  month,
  onClose,
}: {
  row: ReportRow;
  year: number;
  month: number;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [target, setTarget] = useState<ShortfallTarget>(row.target);
  const [leaveDays, setLeaveDays] = useState<string>(
    row.target === 'split' ? d2(row.daysLeave) : '',
  );
  const [reason, setReason] = useState(row.decisionReason ?? '');
  const locked = row.payslipStatus === 'approved' || row.payslipStatus === 'locked';
  const valid =
    reason.trim().length >= 2 &&
    (target !== 'split' || (/^\d{1,4}(\.\d{1,2})?$/.test(leaveDays) && Number(leaveDays) > 0));
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['/payroll/shortfall'] });
    await qc.invalidateQueries({ queryKey: ['/payroll', 'periods'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () =>
      api.put('/payroll/shortfall/decisions', {
        employeeId: row.employeeId,
        year,
        month,
        target,
        ...(target === 'split' ? { leaveDays } : {}),
        reason: reason.trim(),
      }),
    onSuccess: done,
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const clear = useMutation({
    mutationFn: async () =>
      api.del(
        `/payroll/shortfall/decisions?employeeId=${row.employeeId}&year=${year}&month=${month}`,
      ),
    onSuccess: done,
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal
      opened
      onClose={onClose}
      title={`${t('shortfall.decide')} — ${row.employeeName}`}
      size="lg"
    >
      <Stack>
        {locked && <Alert color="orange">{t('shortfall.locked')}</Alert>}
        <Text size="sm">
          {t('shortfall.summary', {
            minutes: row.chargeableMinutes,
            days: d2(row.daysDue),
            available: d2(row.available),
          })}
        </Text>
        <SegmentedControl
          fullWidth
          value={target}
          onChange={(v) => setTarget(v as ShortfallTarget)}
          data={SHORTFALL_TARGETS.map((x) => ({ value: x, label: t(`shortfall.targets.${x}`) }))}
        />
        <Text size="xs" c="dimmed">
          {t(`shortfall.targetHints.${target}`)}
        </Text>
        {target === 'split' && (
          <TextInput
            label={t('shortfall.leaveDays')}
            description={t('shortfall.leaveDaysHint', { available: d2(row.available) })}
            value={leaveDays}
            onChange={(e) => setLeaveDays(e.currentTarget.value)}
            inputMode="decimal"
          />
        )}
        <Textarea
          label={t('shortfall.reason')}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          minRows={3}
        />
        <Group justify="space-between">
          {row.decided ? (
            <Button
              color="red"
              variant="subtle"
              loading={clear.isPending}
              disabled={locked}
              onClick={() => clear.mutate()}
            >
              {t('shortfall.clearDecision')}
            </Button>
          ) : (
            <span />
          )}
          <Group>
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={!valid || locked}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};

// ───────────── التقرير الشهري / Monthly report ─────────────

const ReportTab = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { branches, departments } = useOrgLookups();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [text, setText] = useState('');
  const [dept, setDept] = useState<string[]>([]);
  const [branch, setBranch] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<ReportRow | null>(null);
  const PAGE = 50;
  const params = (p: number, size: number) => ({
    year,
    month,
    q: text.trim() || undefined,
    departmentId: csv(dept),
    branchId: csv(branch),
    page: p,
    pageSize: size,
  });
  const q = useQuery({
    queryKey: ['/payroll/shortfall', 'report', year, month, text, dept, branch, page],
    queryFn: async () => {
      const r = await api.get<ReportRow[]>('/payroll/shortfall/report', params(page, PAGE));
      return { rows: r.data, meta: r.meta as unknown as ReportMeta };
    },
  });
  const policyOff = q.data && !q.data.meta.policyEnabled;
  const canDecide = can('payroll.shortfall.decide');

  const columns: Column<ReportRow>[] = [
    { key: 'employeeNo', header: t('shortfall.cols.no'), render: (r) => r.employeeNo, ltr: true },
    { key: 'employeeName', header: t('shortfall.cols.employee'), render: (r) => r.employeeName },
    {
      key: 'department',
      header: t('shortfall.cols.department'),
      render: (r) => r.departmentName ?? '—',
    },
    {
      key: 'late',
      header: t('shortfall.cols.late'),
      render: (r) => r.lateMinutes,
      align: 'end',
    },
    {
      key: 'early',
      header: t('shortfall.cols.early'),
      render: (r) => r.earlyMinutes,
      align: 'end',
    },
    {
      key: 'occurrences',
      header: t('shortfall.cols.occurrences'),
      render: (r) => (
        <Group gap={4} wrap="nowrap">
          <span>{r.occurrences}</span>
          {r.suggestAction && (
            <Badge color="orange" variant="light" title={t('shortfall.suggestHint')}>
              {t('shortfall.suggest')}
            </Badge>
          )}
        </Group>
      ),
      exportValue: (r) => r.occurrences,
      align: 'end',
    },
    {
      key: 'chargeable',
      header: t('shortfall.cols.chargeable'),
      render: (r) => r.chargeableMinutes,
      align: 'end',
    },
    {
      key: 'daysDue',
      header: t('shortfall.cols.daysDue'),
      render: (r) => Number(r.daysDue).toFixed(4),
      align: 'end',
    },
    {
      key: 'target',
      header: t('shortfall.cols.target'),
      render: (r) => (
        <Group gap={4} wrap="nowrap">
          <Badge color={targetColor[r.target]} variant="light">
            {t(`shortfall.targets.${r.target}`)}
          </Badge>
          {!r.decided && (
            <Text size="xs" c="dimmed">
              {t('shortfall.default')}
            </Text>
          )}
          {r.balanceShort && (
            <Badge color="yellow" variant="light">
              {t('shortfall.balanceShort')}
            </Badge>
          )}
        </Group>
      ),
      exportValue: (r) => t(`shortfall.targets.${r.target}`),
    },
    {
      key: 'daysLeave',
      header: t('shortfall.cols.fromLeave'),
      render: (r) => d2(r.daysLeave),
      align: 'end',
    },
    {
      key: 'daysSalary',
      header: t('shortfall.cols.fromSalary'),
      render: (r) => Number(r.daysSalary).toFixed(4),
      align: 'end',
    },
    {
      key: 'payslip',
      header: t('shortfall.cols.payslip'),
      render: (r) => (r.payslipStatus ? t(`payroll.run.statuses.${r.payslipStatus}`) : '—'),
    },
  ];

  return (
    <Stack>
      <Group align="flex-end">
        <NumberInput
          label={t('payroll.run.year')}
          value={year}
          onChange={(v) => {
            setYear(Number(v) || now.getFullYear());
            setPage(1);
          }}
          min={2000}
          max={2100}
          w={110}
        />
        <NumberInput
          label={t('payroll.run.monthNo')}
          value={month}
          onChange={(v) => {
            setMonth(Math.min(12, Math.max(1, Number(v) || 1)));
            setPage(1);
          }}
          min={1}
          max={12}
          w={130}
        />
        <TextInput
          label={t('shortfall.search')}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setPage(1);
          }}
          w={200}
        />
        <MultiFilter
          label={t('shortfall.cols.department')}
          data={departments.options}
          value={dept}
          onChange={(v) => {
            setDept(v);
            setPage(1);
          }}
        />
        <MultiFilter
          label={t('shortfall.branch')}
          data={branches.options}
          value={branch}
          onChange={(v) => {
            setBranch(v);
            setPage(1);
          }}
        />
      </Group>
      {policyOff && <Alert color="orange">{t('shortfall.policyOff')}</Alert>}
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <DataTable
        tableId="payroll-shortfall"
        title={`${t('shortfall.title')} ${year}-${String(month).padStart(2, '0')}`}
        columns={columns}
        rows={q.data?.rows ?? []}
        loading={q.isLoading}
        page={page}
        pageSize={PAGE}
        total={q.data?.meta.total ?? 0}
        onPage={setPage}
        fetchAll={async () =>
          (await api.get<ReportRow[]>('/payroll/shortfall/report', params(1, 500))).data
        }
        actions={
          canDecide
            ? (r) => (
                <Button size="xs" variant="light" onClick={() => setDeciding(r)}>
                  {t('shortfall.decide')}
                </Button>
              )
            : undefined
        }
      />
      {deciding && (
        <DecisionModal row={deciding} year={year} month={month} onClose={() => setDeciding(null)} />
      )}
    </Stack>
  );
};

// ───────────── السياسة / Policy ─────────────

const PolicyTab = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const leaveTypes = useLookup('/leave-types', 'leave.type.read');
  const canEdit = can('payroll.shortfall.policy');
  const q = useQuery({
    queryKey: ['/payroll/shortfall', 'policy'],
    queryFn: async () => (await api.get<Policy>('/payroll/shortfall/policy')).data,
  });
  const [draft, setDraft] = useState<Policy | null>(null);
  const v = draft ?? q.data;
  const set = (patch: Partial<Policy>) => v && setDraft({ ...v, ...patch });
  const needsLeave = v?.defaultTarget === 'leave';
  const tiersOk =
    v?.method !== 'tiers' ||
    (v.tiers.length > 0 &&
      v.tiers.every((x) => x.from >= 1 && /^\d{1,2}(\.\d{1,4})?$/.test(x.dayFraction)));
  const valid = !!v && (v.countLate || v.countEarly) && (!needsLeave || !!v.leaveTypeId) && tiersOk;
  const save = useMutation({
    mutationFn: async () => api.put('/payroll/shortfall/policy', v),
    onSuccess: async () => {
      setDraft(null);
      notifications.show({ color: 'teal', message: t('shortfall.saved') });
      await qc.invalidateQueries({ queryKey: ['/payroll/shortfall'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  if (!v) return null;
  return (
    <Stack maw={640}>
      <Text size="sm" c="dimmed">
        {t('shortfall.policyHint')}
      </Text>
      <Switch
        label={t('shortfall.policy.enabled')}
        checked={v.isEnabled}
        disabled={!canEdit}
        onChange={(e) => set({ isEnabled: e.currentTarget.checked })}
      />
      <Group>
        <Switch
          label={t('shortfall.policy.countLate')}
          checked={v.countLate}
          disabled={!canEdit}
          onChange={(e) => set({ countLate: e.currentTarget.checked })}
        />
        <Switch
          label={t('shortfall.policy.countEarly')}
          checked={v.countEarly}
          disabled={!canEdit}
          onChange={(e) => set({ countEarly: e.currentTarget.checked })}
        />
      </Group>
      <NativeSelect
        label={t('shortfall.policy.method')}
        value={v.method}
        disabled={!canEdit}
        onChange={(e) => set({ method: e.currentTarget.value as Policy['method'] })}
        data={[
          { value: 'minutes', label: t('shortfall.policy.methods.minutes') },
          { value: 'tiers', label: t('shortfall.policy.methods.tiers') },
        ]}
      />
      <Group>
        <NumberInput
          label={t('shortfall.policy.free')}
          description={t('shortfall.policy.freeHint')}
          value={v.monthlyFreeMinutes}
          min={0}
          disabled={!canEdit}
          onChange={(n) => set({ monthlyFreeMinutes: Number(n) || 0 })}
          w={220}
        />
        {v.method === 'minutes' && (
          <NumberInput
            label={t('shortfall.policy.perDay')}
            description={t('shortfall.policy.perDayHint')}
            value={v.minutesPerDay}
            min={60}
            max={1440}
            disabled={!canEdit}
            onChange={(n) => set({ minutesPerDay: Number(n) || 480 })}
            w={220}
          />
        )}
      </Group>
      {v.method === 'tiers' && (
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {t('shortfall.policy.tiers')}
          </Text>
          <Text size="xs" c="dimmed">
            {t('shortfall.policy.tiersHint')}
          </Text>
          {v.tiers.map((tier, i) => (
            <Group key={i} align="flex-end">
              <NumberInput
                label={t('shortfall.policy.tierFrom')}
                value={tier.from}
                min={1}
                max={31}
                disabled={!canEdit}
                onChange={(n) =>
                  set({
                    tiers: v.tiers.map((x, j) => (j === i ? { ...x, from: Number(n) || 1 } : x)),
                  })
                }
                w={140}
              />
              <TextInput
                label={t('shortfall.policy.tierFraction')}
                value={tier.dayFraction}
                disabled={!canEdit}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  set({ tiers: v.tiers.map((x, j) => (j === i ? { ...x, dayFraction: val } : x)) });
                }}
                w={160}
              />
              {canEdit && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  aria-label={t('shortfall.policy.removeTier')}
                  onClick={() => set({ tiers: v.tiers.filter((_, j) => j !== i) })}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Group>
          ))}
          {canEdit && (
            <Button
              variant="default"
              size="xs"
              w="fit-content"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                set({ tiers: [...v.tiers, { from: v.tiers.length + 1, dayFraction: '0.25' }] })
              }
            >
              {t('shortfall.policy.addTier')}
            </Button>
          )}
        </Stack>
      )}
      <NativeSelect
        label={t('shortfall.policy.defaultTarget')}
        value={v.defaultTarget}
        disabled={!canEdit}
        onChange={(e) => set({ defaultTarget: e.currentTarget.value as Policy['defaultTarget'] })}
        data={[
          { value: 'salary', label: t('shortfall.targets.salary') },
          { value: 'leave', label: t('shortfall.targets.leave') },
        ]}
      />
      <NativeSelect
        label={t('shortfall.policy.leaveType')}
        description={t('shortfall.policy.leaveTypeHint')}
        value={v.leaveTypeId ?? ''}
        disabled={!canEdit}
        onChange={(e) => set({ leaveTypeId: e.currentTarget.value || null })}
        data={[{ value: '', label: '—' }, ...leaveTypes.options]}
        error={needsLeave && !v.leaveTypeId ? t('shortfall.policy.leaveTypeRequired') : undefined}
      />
      <NumberInput
        label={t('shortfall.policy.suggestAfter')}
        description={t('shortfall.policy.suggestAfterHint')}
        value={v.suggestActionAfter ?? ''}
        min={1}
        max={31}
        allowDecimal={false}
        disabled={!canEdit}
        onChange={(n) => set({ suggestActionAfter: n === '' ? null : Number(n) })}
        w={260}
      />
      {canEdit && (
        <Group>
          <Button
            loading={save.isPending}
            disabled={!valid || !draft}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      )}
    </Stack>
  );
};

export const ShortfallPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('shortfall.title')}</Title>
      <Tabs defaultValue="report" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="report">{t('shortfall.tabs.report')}</Tabs.Tab>
          <Tabs.Tab value="policy">{t('shortfall.tabs.policy')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="report" pt="md">
          <ReportTab />
        </Tabs.Panel>
        <Tabs.Panel value="policy" pt="md">
          <PolicyTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
