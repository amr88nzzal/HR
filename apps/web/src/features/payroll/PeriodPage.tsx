import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';
import { statusColor } from './PeriodsPage';
import { ComparePanel, type CompareRow } from './ComparePanel';
import { PaymentsPanel } from './PaymentsPanel';
import { PayslipDrawer } from './PayslipDrawer';
import { FormModal } from './crud';
import type { Period, SlipRow } from './runs-types';

const KEYS = [
  'days_in_period',
  'worked_days',
  'absent_days',
  'unpaid_leave_days',
  'overtime_hours',
  'late_minutes',
] as const;

type Sim = {
  totals: Record<string, string>;
  slips: {
    employeeId: string;
    name: string;
    status: string;
    error: string | null;
    totals: Record<string, string> | null;
  }[];
};

/** تفاصيل دورة: الإجراءات، القسائم، المقارنة، التعديلات اليدوية، المدخلات. */
export const PeriodPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { periodId } = useParams({ strict: false }) as { periodId: string };
  const base = `/payroll/periods/${periodId}`;
  const period = useQuery({
    queryKey: ['/payroll', 'period', periodId],
    queryFn: async () => (await api.get<Period>(base)).data,
  });
  const [page, setPage] = useState(1);
  const total = (): number =>
    Number((slips.data?.meta as { total?: number } | undefined)?.total ?? 0);
  const [q, setQ] = useState('');
  const [manualOnly, setManualOnly] = useState(false);
  const slips = useQuery({
    queryKey: ['/payroll', 'slips', periodId, page, q, manualOnly],
    queryFn: async () =>
      await api.get<SlipRow[]>(`${base}/payslips`, {
        page,
        pageSize: 50,
        q: q || undefined,
        manualOnly: manualOnly ? 'true' : undefined,
      }),
    enabled: can('payroll.payslip.read'),
  });
  const compare = useQuery({
    queryKey: ['/payroll', 'compare', periodId, period.data?.calculatedAt],
    queryFn: async () =>
      (
        await api.get<{
          rows: CompareRow[];
        }>(`${base}/compare`)
      ).data,
    enabled: can('payroll.payslip.read'),
  });
  const overrides = useQuery({
    queryKey: ['/payroll', 'overrides', periodId, period.data?.version, slips.dataUpdatedAt],
    queryFn: async () => (await api.get<Record<string, string>[]>(`${base}/overrides`)).data,
    enabled: can('payroll.payslip.read'),
  });
  const inputs = useQuery({
    queryKey: ['/payroll', 'inputs', periodId],
    queryFn: async () => (await api.get<Record<string, string>[]>(`${base}/inputs`)).data,
    enabled: can('payroll.input.read'),
  });
  const [sim, setSim] = useState<Sim | null>(null);
  const [slipId, setSlipId] = useState<string | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const [inp, setInp] = useState({ employeeId: '', key: 'absent_days', value: '' });

  const refresh = () => qc.invalidateQueries({ queryKey: ['/payroll'] });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      api.post<unknown>(`${base}/${path}`, body),
    onSuccess: async (_r, v) => {
      if (v.path === 'reopen') setReopen(null);
      notifications.show({ color: 'teal', message: t(`payroll.run.done.${v.path}`) });
      await refresh();
    },
    onError: fail,
  });
  const [zipping, setZipping] = useState(false);
  const downloadZip = async () => {
    setZipping(true);
    try {
      downloadBlob(await api.blob(`${base}/payslips.zip`), `payslips-${periodId}.zip`);
    } catch (e) {
      fail(e);
    } finally {
      setZipping(false);
    }
  };
  const simulate = useMutation({
    mutationFn: async () => (await api.post<Sim>(`${base}/simulate`, {})).data,
    onSuccess: setSim,
    onError: fail,
  });
  const saveInput = useMutation({
    mutationFn: async (value: string | null) =>
      api.put(`${base}/inputs`, {
        items: [{ employeeId: inp.employeeId, key: inp.key, value }],
      }),
    onSuccess: refresh,
    onError: fail,
  });

  const p = period.data;
  if (!p) return null;
  const draft = p.status === 'draft';
  return (
    <Stack>
      <Group justify="space-between">
        <Stack gap={0}>
          <Button
            component={Link}
            to="/payroll/periods"
            variant="subtle"
            size="compact-sm"
            w="fit-content"
          >
            ‹ {t('nav.payrollPeriods')}
          </Button>
          <Title order={2}>
            {`${p.year}-${String(p.month).padStart(2, '0')} · ${p.groupName} · ${p.currency}`}{' '}
            <Badge color={statusColor[p.status]}>{t(`payroll.run.statuses.${p.status}`)}</Badge>
          </Title>
        </Stack>
        <Group>
          {draft && can('payroll.period.calculate') && (
            <>
              <Button
                variant="default"
                loading={simulate.isPending}
                onClick={() => simulate.mutate()}
              >
                {t('payroll.run.simulate')}
              </Button>
              <Button loading={act.isPending} onClick={() => act.mutate({ path: 'calculate' })}>
                {t('payroll.run.calculate')}
              </Button>
            </>
          )}
          {draft && can('payroll.period.approve') && (
            <Button color="blue" onClick={() => act.mutate({ path: 'approve' })}>
              {t('payroll.run.approve')}
            </Button>
          )}
          {p.status === 'approved' && can('payroll.period.lock') && (
            <Button color="teal" onClick={() => act.mutate({ path: 'lock' })}>
              {t('payroll.run.lock')}
            </Button>
          )}
          {can('payroll.payslip.read') && p.employeesCount > 0 && (
            <Button variant="default" loading={zipping} onClick={() => void downloadZip()}>
              {t('payslips.zip')}
            </Button>
          )}
          {p.status !== 'draft' &&
            can(p.status === 'locked' ? 'payroll.period.reopen' : 'payroll.period.approve') && (
              <Button color="orange" variant="light" onClick={() => setReopen('')}>
                {t('payroll.run.reopen')}
              </Button>
            )}
        </Group>
      </Group>
      {p.reopenReason && draft && (
        <Alert color="orange">{`${t('payroll.run.reopenReason')}: ${p.reopenReason}`}</Alert>
      )}
      {p.errorCount > 0 && (
        <Alert color="red">{t('payroll.run.errorsAlert', { n: p.errorCount })}</Alert>
      )}
      <SimpleGrid cols={{ base: 2, sm: 7 }}>
        {(
          [
            ['employees', String(p.employeesCount)],
            ['gross', p.grossTotal],
            ['deductions', p.deductionsTotal],
            ['net', p.netTotal],
            ['loans', p.loansTotal],
            ['payable', p.payableTotal],
            ['employer', p.employerTotal],
          ] as const
        ).map(([k, val]) => (
          <Card key={k} withBorder padding="sm">
            <Text size="xs" c="dimmed">
              {t(`payroll.run.${k}`)}
            </Text>
            <Text fw={600} dir="ltr">
              {val}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <Tabs defaultValue="slips" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="slips">{t('payroll.run.tabs.slips')}</Tabs.Tab>
          <Tabs.Tab value="compare">{t('payroll.run.tabs.compare')}</Tabs.Tab>
          <Tabs.Tab value="overrides">{t('payroll.run.tabs.overrides')}</Tabs.Tab>
          {can('payroll.payment.read') && p.status !== 'draft' && (
            <Tabs.Tab value="payments">{t('loans.paymentsTab')}</Tabs.Tab>
          )}
          {can('payroll.input.read') && (
            <Tabs.Tab value="inputs">{t('payroll.run.tabs.inputs')}</Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="slips" pt="md">
          <Stack>
            <Group>
              <TextInput
                placeholder={t('payroll.run.search')}
                value={q}
                onChange={(e) => {
                  setQ(e.currentTarget.value);
                  setPage(1);
                }}
              />
              <Checkbox
                label={t('payroll.run.manualOnly')}
                checked={manualOnly}
                onChange={(e) => {
                  setManualOnly(e.currentTarget.checked);
                  setPage(1);
                }}
              />
            </Group>
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('payroll.run.employee')}</Table.Th>
                  <Table.Th>{t('payroll.run.basic')}</Table.Th>
                  <Table.Th>{t('payroll.run.gross')}</Table.Th>
                  <Table.Th>{t('payroll.run.deductions')}</Table.Th>
                  <Table.Th>{t('payroll.run.net')}</Table.Th>
                  <Table.Th>{t('payroll.run.loans')}</Table.Th>
                  <Table.Th>{t('payroll.run.payable')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(slips.data?.data ?? []).map((s) => (
                  <Table.Tr
                    key={s.id}
                    onClick={() => setSlipId(s.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td>{`${s.employeeNo} · ${s.employeeName}`}</Table.Td>
                    <Table.Td dir="ltr">{s.basicAmount}</Table.Td>
                    <Table.Td dir="ltr">{s.grossAmount}</Table.Td>
                    <Table.Td dir="ltr">{s.deductionsAmount}</Table.Td>
                    <Table.Td dir="ltr" fw={600}>
                      {s.netAmount}
                    </Table.Td>
                    <Table.Td dir="ltr">{s.loansAmount}</Table.Td>
                    <Table.Td dir="ltr" fw={600}>
                      {s.payableAmount}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {s.hasManual && (
                          <Badge color="orange" variant="light">
                            {t('payroll.run.manual')}
                          </Badge>
                        )}
                        {s.status === 'error' && (
                          <Badge color="red">{t('payroll.run.error')}</Badge>
                        )}
                        {s.warnings.includes('LOAN_OVER_CAP') && (
                          <Badge color="yellow" variant="light">
                            {t('loans.overCap')}
                          </Badge>
                        )}
                        {s.warnings.includes('NEGATIVE_NET') && (
                          <Badge color="red" variant="light">
                            {t('payroll.run.negativeNet')}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {total() > 50 && (
              <Group justify="center">
                <Button
                  size="xs"
                  variant="default"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  ‹
                </Button>
                <Text size="sm">{page}</Text>
                <Button
                  size="xs"
                  variant="default"
                  disabled={page * 50 >= total()}
                  onClick={() => setPage(page + 1)}
                >
                  ›
                </Button>
              </Group>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="payments" pt="md">
          <PaymentsPanel periodId={periodId} />
        </Tabs.Panel>

        <Tabs.Panel value="compare" pt="md">
          <ComparePanel rows={compare.data?.rows ?? []} />
        </Tabs.Panel>

        <Tabs.Panel value="overrides" pt="md">
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('payroll.run.employee')}</Table.Th>
                <Table.Th>{t('payroll.run.line')}</Table.Th>
                <Table.Th>{t('payroll.run.auto')}</Table.Th>
                <Table.Th>{t('payroll.run.amount')}</Table.Th>
                <Table.Th>{t('payroll.run.reason')}</Table.Th>
                <Table.Th>{t('payroll.run.by')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(overrides.data ?? []).map((r) => (
                <Table.Tr key={r['lineId']}>
                  <Table.Td>{`${r['employeeNo']} · ${r['employeeName']}`}</Table.Td>
                  <Table.Td>{r['nameAr']}</Table.Td>
                  <Table.Td dir="ltr">{r['autoAmount'] ?? '—'}</Table.Td>
                  <Table.Td dir="ltr">{r['amount']}</Table.Td>
                  <Table.Td>
                    {[r['reasonName'], r['overrideNote']].filter(Boolean).join(' — ')}
                  </Table.Td>
                  <Table.Td dir="ltr">{r['overrideBy']}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="inputs" pt="md">
          <Stack>
            {draft && can('payroll.input.manage') && (
              <Group align="flex-end">
                <TextInput
                  label={t('payroll.run.employeeId')}
                  dir="ltr"
                  value={inp.employeeId}
                  onChange={(e) => setInp({ ...inp, employeeId: e.currentTarget.value })}
                />
                <Select
                  label={t('payroll.run.variable')}
                  value={inp.key}
                  data={KEYS.map((k) => ({ value: k, label: k }))}
                  onChange={(x) => setInp({ ...inp, key: x ?? 'absent_days' })}
                  allowDeselect={false}
                />
                <NumberInput
                  label={t('payroll.run.amount')}
                  min={0}
                  value={inp.value}
                  onChange={(x) => setInp({ ...inp, value: String(x) })}
                />
                <Button
                  disabled={!inp.employeeId || inp.value === ''}
                  onClick={() => saveInput.mutate(inp.value)}
                >
                  {t('common.save')}
                </Button>
              </Group>
            )}
            <Table withTableBorder striped>
              <Table.Tbody>
                {(inputs.data ?? []).map((r) => (
                  <Table.Tr key={`${r['employeeId']}${r['key']}`}>
                    <Table.Td>{`${r['employeeNo']} · ${r['employeeName']}`}</Table.Td>
                    <Table.Td dir="ltr">{r['key']}</Table.Td>
                    <Table.Td dir="ltr">{r['value']}</Table.Td>
                    <Table.Td>
                      {draft && can('payroll.input.manage') && (
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            api
                              .put(`${base}/inputs`, {
                                items: [
                                  { employeeId: r['employeeId'], key: r['key'], value: null },
                                ],
                              })
                              .then(refresh)
                              .catch(fail)
                          }
                        >
                          {t('payroll.run.clearInput')}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {sim && (
        <FormModal
          opened
          title={t('payroll.run.simulationTitle')}
          onClose={() => setSim(null)}
          onSubmit={() => setSim(null)}
          submitting={false}
          error={null}
        >
          <Text size="sm" c="dimmed">
            {t('payroll.run.simulationNote')}
          </Text>
          <Text dir="ltr">{`${t('payroll.run.net')}: ${sim.totals['net']}`}</Text>
          <Table withTableBorder>
            <Table.Tbody>
              {sim.slips.map((s) => (
                <Table.Tr key={s.employeeId}>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td dir="ltr">{s.totals?.['net'] ?? s.error}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </FormModal>
      )}
      <FormModal
        opened={reopen !== null}
        title={t('payroll.run.reopen')}
        onClose={() => setReopen(null)}
        onSubmit={() => act.mutate({ path: 'reopen', body: { reason: reopen } })}
        submitting={act.isPending}
        error={null}
      >
        <TextInput
          label={t('payroll.run.reopenReason')}
          value={reopen ?? ''}
          onChange={(e) => setReopen(e.currentTarget.value)}
        />
      </FormModal>
      {slipId && (
        <PayslipDrawer
          slipId={slipId}
          canOverride={draft && can('payroll.payslip.override')}
          onClose={() => setSlipId(null)}
        />
      )}
    </Stack>
  );
};
