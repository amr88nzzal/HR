import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildSchedule } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { useLookup } from '../employees/shared';
import type { LoanDetail, LoanRow } from './loans-types';
import { MarkPaidModal } from './MarkPaidModal';

const statusColor = { active: 'blue', settled: 'teal', cancelled: 'gray' } as const;
const instColor = {
  scheduled: 'gray',
  deducted: 'teal',
  deferred: 'orange',
  cancelled: 'gray',
} as const;
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

const NewLoanModal = ({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currencies = useLookup('/currencies', 'system.currency.read');
  const now = new Date();
  const [v, setV] = useState({
    employeeId: employeeId ?? '',
    kind: 'loan',
    currency: '',
    principal: '',
    count: 6,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    reason: '',
  });
  const codes = currencies.rows.map((r) => String(r['code']));
  const currency = v.currency || codes[0] || '';
  const valid = /^\d{1,14}(\.\d{1,4})?$/.test(v.principal) && Number(v.principal) > 0;
  const preview = valid ? buildSchedule(v.principal, v.count, v.year, v.month) : [];
  const save = useMutation({
    mutationFn: async () =>
      api.post('/payroll/loans', {
        employeeId: v.employeeId,
        kind: v.kind,
        currency,
        principal: v.principal,
        installmentsCount: v.count,
        firstYear: v.year,
        firstMonth: v.month,
        reason: v.reason || null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('loans.new')} centered size="lg">
      <Stack>
        {!employeeId && (
          <EmployeeSelect
            label={t('payroll.run.employee')}
            value={v.employeeId || null}
            onChange={(id) => setV({ ...v, employeeId: id ?? '' })}
          />
        )}
        <Group grow>
          <NativeSelect
            label={t('loans.kind')}
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.currentTarget.value })}
            data={['loan', 'advance'].map((k) => ({ value: k, label: t(`loans.kinds.${k}`) }))}
          />
          <NativeSelect
            label={t('payroll.run.currency')}
            value={currency}
            onChange={(e) => setV({ ...v, currency: e.currentTarget.value })}
            data={codes}
          />
          <TextInput
            label={t('loans.principal')}
            dir="ltr"
            value={v.principal}
            onChange={(e) => setV({ ...v, principal: e.currentTarget.value })}
          />
        </Group>
        <Group grow>
          <NumberInput
            label={t('loans.count')}
            min={1}
            max={120}
            value={v.count}
            onChange={(n) => setV({ ...v, count: Number(n) || 1 })}
          />
          <NumberInput
            label={t('payroll.run.year')}
            value={v.year}
            onChange={(n) => setV({ ...v, year: Number(n) || v.year })}
          />
          <NumberInput
            label={t('payroll.run.month')}
            min={1}
            max={12}
            value={v.month}
            onChange={(n) => setV({ ...v, month: Number(n) || 1 })}
          />
        </Group>
        <TextInput
          label={t('loans.reason')}
          value={v.reason}
          onChange={(e) => setV({ ...v, reason: e.currentTarget.value })}
        />
        {preview.length > 0 && (
          <Text size="sm" c="dimmed" dir="ltr">
            {preview
              .slice(0, 6)
              .map((p) => `${ym(p.year, p.month)}: ${p.amount}`)
              .join('  ·  ')}
            {preview.length > 6 ? '  …' : ''}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!valid || !v.employeeId || !currency}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const nextAfterLast = (list: { dueYear: number; dueMonth: number; status: string }[]) => {
  const last = Math.max(
    ...list.filter((i) => i.status !== 'cancelled').map((i) => i.dueYear * 12 + i.dueMonth - 1),
  );
  return ym(Math.floor((last + 1) / 12), ((last + 1) % 12) + 1);
};

/** تأجيل قسط: كامل أو جزء منه، إلى شهر يُحدَّد، بسبب إلزامي. */
const DeferModal = ({
  inst,
  list,
  onClose,
}: {
  inst: { id: string; amount: string; dueYear: number; dueMonth: number };
  list: { dueYear: number; dueMonth: number; status: string }[];
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState(nextAfterLast(list));
  const [reason, setReason] = useState('');
  const full = Number(inst.amount);
  const partOk =
    mode === 'full' ||
    (/^\d{1,14}(\.\d{1,4})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= full);
  const [ty, tm] = target.split('-').map(Number) as [number, number];
  const targetOk = /^\d{4}-\d{2}$/.test(target) && ty * 12 + tm > inst.dueYear * 12 + inst.dueMonth;
  const save = useMutation({
    mutationFn: async () =>
      api.post(`/payroll/loan-installments/${inst.id}/defer`, {
        reason,
        ...(mode === 'part' ? { amount } : {}),
        targetYear: ty,
        targetMonth: tm,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('loans.deferTitle')}>
      <Stack>
        <Text size="sm" dir="ltr">{`${ym(inst.dueYear, inst.dueMonth)} · ${inst.amount}`}</Text>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'full' | 'part')}
          data={[
            { value: 'full', label: t('loans.deferFull') },
            { value: 'part', label: t('loans.deferPart') },
          ]}
        />
        {mode === 'part' && (
          <TextInput
            label={t('loans.deferAmount')}
            description={`${t('loans.deferMax')}: ${inst.amount}`}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            error={amount && !partOk ? t('loans.deferAmountInvalid') : undefined}
            dir="ltr"
          />
        )}
        <TextInput
          type="month"
          label={t('loans.deferTo')}
          value={target}
          onChange={(e) => setTarget(e.currentTarget.value)}
          error={!targetOk ? t('loans.deferToInvalid') : undefined}
          dir="ltr"
        />
        <TextInput
          label={t('loans.reasonRequired')}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!partOk || !targetOk || reason.trim().length < 2}
            onClick={() => save.mutate()}
          >
            {t('loans.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const LoanDrawer = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('payroll.loan.manage');
  const [reason, setReason] = useState<{ target: string; text: string } | null>(null);
  const [defer, setDefer] = useState<{
    id: string;
    amount: string;
    dueYear: number;
    dueMonth: number;
  } | null>(null);
  const [marking, setMarking] = useState<string[] | null>(null);
  const d = useQuery({
    queryKey: ['/payroll', 'loan', id],
    queryFn: async () => (await api.get<LoanDetail>(`/payroll/loans/${id}`)).data,
  });
  const act = useMutation({
    mutationFn: async () =>
      reason!.target === 'cancel'
        ? api.post(`/payroll/loans/${id}/cancel`, { reason: reason!.text })
        : api.post(`/payroll/loan-installments/${reason!.target}/defer`, { reason: reason!.text }),
    onSuccess: async () => {
      setReason(null);
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const loan = d.data;
  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={t('loans.details')}>
      {loan && (
        <Stack>
          <Title order={4}>{`${loan.employeeNo ?? ''} · ${loan.employeeName}`}</Title>
          <Group>
            <Badge color={statusColor[loan.status]}>{t(`loans.statuses.${loan.status}`)}</Badge>
            <Text
              size="sm"
              dir="ltr"
            >{`${t(`loans.kinds.${loan.kind}`)} · ${loan.principal} ${loan.currency}`}</Text>
          </Group>
          <Group gap="xl">
            <Text size="sm" dir="ltr">{`${t('loans.repaid')}: ${loan.repaid}`}</Text>
            <Text size="sm" dir="ltr">{`${t('loans.remaining')}: ${loan.remaining}`}</Text>
          </Group>
          {loan.reason && <Text size="sm">{loan.reason}</Text>}
          {loan.cancelReason && (
            <Alert color="gray">{`${t('loans.cancelReason')}: ${loan.cancelReason}`}</Alert>
          )}
          {loan.payments.map((p) => (
            <Group key={p.id}>
              <Text size="sm">{t('loans.disbursement')}</Text>
              <Badge color={p.status === 'paid' ? 'teal' : 'gray'}>
                {t(`loans.paymentStatus.${p.status}`)}
              </Badge>
              {p.status === 'pending' && can('payroll.payment.manage') && (
                <Button size="compact-xs" onClick={() => setMarking([p.id])}>
                  {t('loans.markPaid')}
                </Button>
              )}
            </Group>
          ))}
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>{t('payroll.run.month')}</Table.Th>
                <Table.Th>{t('payroll.run.amount')}</Table.Th>
                <Table.Th>{t('payroll.run.status')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loan.installments.map((i) => (
                <Table.Tr key={i.id}>
                  <Table.Td>{i.no}</Table.Td>
                  <Table.Td dir="ltr">{ym(i.dueYear, i.dueMonth)}</Table.Td>
                  <Table.Td dir="ltr">{i.amount}</Table.Td>
                  <Table.Td>
                    <Badge color={instColor[i.status]} variant="light">
                      {t(`loans.instStatuses.${i.status}`)}
                    </Badge>
                    {i.deferredReason && (
                      <Text size="xs" c="dimmed">
                        {i.systemDeferred ? t('loans.overCap') : i.deferredReason}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {manage && i.status === 'scheduled' && loan.status === 'active' && (
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="orange"
                        onClick={() =>
                          setDefer({
                            id: i.id,
                            amount: i.amount,
                            dueYear: i.dueYear,
                            dueMonth: i.dueMonth,
                          })
                        }
                      >
                        {t('loans.defer')}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {manage && loan.status === 'active' && (
            <Button
              color="red"
              variant="light"
              onClick={() => setReason({ target: 'cancel', text: '' })}
            >
              {t('loans.cancel')}
            </Button>
          )}
          {reason && (
            <Stack>
              <TextInput
                label={t('loans.reasonRequired')}
                value={reason.text}
                onChange={(e) => setReason({ ...reason, text: e.currentTarget.value })}
              />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setReason(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  loading={act.isPending}
                  disabled={reason.text.trim().length < 2}
                  onClick={() => act.mutate()}
                >
                  {t('loans.confirm')}
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      )}
      {defer && loan && (
        <DeferModal inst={defer} list={loan.installments} onClose={() => setDefer(null)} />
      )}
      {marking && <MarkPaidModal ids={marking} onClose={() => setMarking(null)} />}
    </Drawer>
  );
};

/** السلف والقروض: القائمة (كلها أو لموظف)، منح سلفة بمعاينة الجدول، تفاصيل الأقساط والتأجيل والإلغاء. */
export const LoansPanel = ({ employeeId }: { employeeId?: string }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['/payroll', 'loans', employeeId ?? 'all'],
    queryFn: async () =>
      (await api.get<LoanRow[]>('/payroll/loans', { employeeId, pageSize: 200 })).data,
  });
  return (
    <Stack>
      <Group justify="space-between">
        {!employeeId && <Title order={2}>{t('nav.payrollLoans')}</Title>}
        {can('payroll.loan.create') && (
          <Button onClick={() => setOpen(true)}>{t('loans.new')}</Button>
        )}
      </Group>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {!employeeId && <Table.Th>{t('payroll.run.employee')}</Table.Th>}
            <Table.Th>{t('loans.kind')}</Table.Th>
            <Table.Th>{t('loans.principal')}</Table.Th>
            <Table.Th>{t('loans.repaid')}</Table.Th>
            <Table.Th>{t('loans.remaining')}</Table.Th>
            <Table.Th>{t('payroll.run.status')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((l) => (
            <Table.Tr key={l.id} onClick={() => setSel(l.id)} style={{ cursor: 'pointer' }}>
              {!employeeId && <Table.Td>{`${l.employeeNo ?? ''} · ${l.employeeName}`}</Table.Td>}
              <Table.Td>{t(`loans.kinds.${l.kind}`)}</Table.Td>
              <Table.Td dir="ltr">{`${l.principal} ${l.currency}`}</Table.Td>
              <Table.Td dir="ltr">{l.repaid}</Table.Td>
              <Table.Td dir="ltr">{l.remaining}</Table.Td>
              <Table.Td>
                <Badge color={statusColor[l.status]}>{t(`loans.statuses.${l.status}`)}</Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {(list.data ?? []).length === 0 && <Text c="dimmed">{t('loans.empty')}</Text>}
      {open && <NewLoanModal employeeId={employeeId} onClose={() => setOpen(false)} />}
      {sel && <LoanDrawer id={sel} onClose={() => setSel(null)} />}
    </Stack>
  );
};
