import {
  Alert,
  Badge,
  Button,
  FileInput,
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
import { buildSchedule, planDefer } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { useLookup } from '../employees/shared';
import type { Installment, LoanDetail, LoanRow } from './loans-types';
import { useLoanTypes, typeName } from './loan-types-api';
import { BulkInvoiceModal } from './BulkInvoiceModal';
import { LOAN_ACCEPT, LoanAttachments, uploadLoanFile } from './LoanAttachments';
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
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const currencies = useLookup('/currencies', 'system.currency.read');
  const now = new Date();
  const [v, setV] = useState({
    employeeId: employeeId ?? '',
    typeId: '',
    currency: '',
    principal: '',
    count: 6,
    eventDate: now.toISOString().slice(0, 10),
    reference: '',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    reason: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const types = useLoanTypes();
  const type = (types.data ?? []).find((x) => x.id === v.typeId) ?? types.data?.[0];
  const count = Math.min(v.count, type?.maxInstallments ?? v.count);
  const codes = currencies.rows.map((r) => String(r['code']));
  const currency = v.currency || codes[0] || '';
  const valid = /^\d{1,14}(\.\d{1,4})?$/.test(v.principal) && Number(v.principal) > 0;
  const preview = valid ? buildSchedule(v.principal, count, v.year, v.month) : [];
  const save = useMutation({
    mutationFn: async () =>
      api.post('/payroll/loans', {
        employeeId: v.employeeId,
        typeId: type?.id,
        currency,
        principal: v.principal,
        installmentsCount: count,
        eventDate: v.eventDate,
        reference: v.reference || null,
        firstYear: v.year,
        firstMonth: v.month,
        reason: v.reason || null,
      }),
    onSuccess: async (res) => {
      if ((res.meta?.['warnings'] as string[] | undefined)?.includes('MONTHLY_LIMIT_EXCEEDED'))
        notifications.show({ color: 'orange', message: t('loans.limitWarning') });
      // المرفق اختياري: فشل رفعه لا يُلغي السلفة المنشأة ويمكن إعادته من التفاصيل
      // The attachment is optional: a failed upload never undoes the created loan and can be retried from the details
      const created = (res.data as { id?: string } | undefined)?.id;
      if (file && created)
        await uploadLoanFile(created, file).catch((e) =>
          notifications.show({ color: 'red', message: errorMessage(e, t) }),
        );
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
            value={type?.id ?? ''}
            onChange={(e) => setV({ ...v, typeId: e.currentTarget.value })}
            data={(types.data ?? []).map((x) => ({
              value: x.id,
              label: (lang === 'en' && x.nameEn) || x.nameAr,
            }))}
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
          <TextInput
            type="date"
            label={type && !type.disburses ? t('loans.invoiceDate') : t('loans.eventDate')}
            value={v.eventDate}
            onChange={(e) => {
              const d = e.currentTarget.value;
              setV({
                ...v,
                eventDate: d,
                year: Number(d.slice(0, 4)) || v.year,
                month: Number(d.slice(5, 7)) || v.month,
              });
            }}
          />
          <TextInput
            label={t('loans.reference')}
            value={v.reference}
            onChange={(e) => setV({ ...v, reference: e.currentTarget.value })}
          />
        </Group>
        <Group grow>
          <NumberInput
            label={t('loans.count')}
            min={1}
            max={type?.maxInstallments ?? 120}
            value={count}
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
        <FileInput
          label={t('loans.attachments.file')}
          description={t('loans.attachments.hint')}
          accept={LOAN_ACCEPT}
          value={file}
          onChange={setFile}
          clearable
        />
        {type?.requiresAttachment && !file && (
          <Text size="xs" c="orange">
            {t('loans.attachments.missing')}
          </Text>
        )}
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
            disabled={!valid || !v.employeeId || !currency || !type}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const nextMonth = (y: number, m: number) => ym(y + Math.floor(m / 12), (m % 12) + 1);

/** تأجيل قسط: كامل أو جزء، إلى شهر/أقساط جديدة أو توزيع على المتبقي، مع جدول معاينة. */
const DeferModal = ({
  inst,
  list,
  onClose,
}: {
  inst: { id: string; amount: string; dueYear: number; dueMonth: number };
  list: Installment[];
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [part, setPart] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'next' | 'month' | 'remaining'>('next');
  const [target, setTarget] = useState(nextMonth(inst.dueYear, inst.dueMonth));
  const [count, setCount] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const remaining = list
    .filter(
      (i) =>
        i.status === 'scheduled' &&
        i.id !== inst.id &&
        i.dueYear * 12 + i.dueMonth > inst.dueYear * 12 + inst.dueMonth,
    )
    .map((i) => ({ id: i.id, year: i.dueYear, month: i.dueMonth, amount: i.amount }));
  const amountOk = !part || /^\d{1,14}(\.\d{1,4})?$/.test(amount);
  const [ty, tm] =
    mode === 'next'
      ? ([inst.dueMonth === 12 ? inst.dueYear + 1 : inst.dueYear, (inst.dueMonth % 12) + 1] as [
          number,
          number,
        ])
      : (target.split('-').map(Number) as [number, number]);
  const plan = planDefer({
    amount: inst.amount,
    deferAmount: part && amountOk ? amount : undefined,
    dueYear: inst.dueYear,
    dueMonth: inst.dueMonth,
    mode: mode === 'remaining' ? 'remaining' : 'month',
    targetYear: ty,
    targetMonth: tm,
    count: mode === 'next' ? 1 : count === '' ? undefined : count,
    remaining,
  });
  const save = useMutation({
    mutationFn: async () =>
      api.post(`/payroll/loan-installments/${inst.id}/defer`, {
        reason,
        ...(part ? { amount } : {}),
        mode: mode === 'remaining' ? 'remaining' : 'month',
        ...(count !== '' && mode !== 'next' ? { count } : {}),
        ...(mode !== 'remaining' ? { targetYear: ty, targetMonth: tm } : {}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('loans.deferTitle')} size="lg">
      <Stack>
        <Text size="sm" dir="ltr">{`${ym(inst.dueYear, inst.dueMonth)} · ${inst.amount}`}</Text>
        <SegmentedControl
          value={part ? 'part' : 'full'}
          onChange={(v) => setPart(v === 'part')}
          data={[
            { value: 'full', label: t('loans.deferFull') },
            { value: 'part', label: t('loans.deferPart') },
          ]}
        />
        {part && (
          <TextInput
            label={t('loans.deferAmount')}
            description={`${t('loans.deferMax')}: ${inst.amount}`}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            error={
              amount && (!amountOk || (!plan.ok && plan.code === 'INVALID_DEFER_AMOUNT'))
                ? t('loans.deferAmountInvalid')
                : undefined
            }
            dir="ltr"
          />
        )}
        <NativeSelect
          label={t('loans.deferHow')}
          value={mode}
          onChange={(e) => setMode(e.currentTarget.value as 'next' | 'month' | 'remaining')}
          data={[
            { value: 'next', label: t('loans.deferNext') },
            { value: 'month', label: t('loans.deferNewInstallments') },
            { value: 'remaining', label: t('loans.deferRemaining') },
          ]}
        />
        {mode === 'month' && (
          <Group grow align="flex-start">
            <TextInput
              type="month"
              label={t('loans.deferTo')}
              value={target}
              onChange={(e) => setTarget(e.currentTarget.value)}
              dir="ltr"
            />
            <NumberInput
              label={t('loans.deferCountNew')}
              min={1}
              max={60}
              allowDecimal={false}
              placeholder="1"
              value={count}
              onChange={(v) => setCount(v === '' ? '' : Number(v))}
            />
          </Group>
        )}
        {mode === 'remaining' && (
          <NumberInput
            label={t('loans.deferCountRemaining')}
            description={`${t('loans.deferRemainingAvailable')}: ${remaining.length}`}
            min={1}
            max={Math.max(remaining.length, 1)}
            allowDecimal={false}
            placeholder={String(remaining.length)}
            value={count}
            onChange={(v) => setCount(v === '' ? '' : Number(v))}
          />
        )}
        {plan.ok ? (
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('payroll.run.month')}</Table.Th>
                <Table.Th>{t('loans.deferSchedAdd')}</Table.Th>
                <Table.Th>{t('loans.deferSchedTotal')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {!plan.full && (
                <Table.Tr>
                  <Table.Td dir="ltr">{ym(inst.dueYear, inst.dueMonth)}</Table.Td>
                  <Table.Td dir="ltr">{`−${(Number(inst.amount) - Number(plan.keep)).toFixed(4)}`}</Table.Td>
                  <Table.Td dir="ltr">{plan.keep}</Table.Td>
                </Table.Tr>
              )}
              {plan.full && (
                <Table.Tr>
                  <Table.Td dir="ltr">{ym(inst.dueYear, inst.dueMonth)}</Table.Td>
                  <Table.Td dir="ltr">{`−${inst.amount}`}</Table.Td>
                  <Table.Td dir="ltr">0.0000</Table.Td>
                </Table.Tr>
              )}
              {plan.rows.map((r, idx) => (
                <Table.Tr key={`${r.id ?? 'new'}-${idx}`}>
                  <Table.Td dir="ltr">{ym(r.year, r.month)}</Table.Td>
                  <Table.Td dir="ltr">{`+${r.add}`}</Table.Td>
                  <Table.Td dir="ltr">{r.total}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Alert color="orange">{t(`loans.deferErr.${plan.code}`)}</Alert>
        )}
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
            disabled={!plan.ok || reason.trim().length < 2}
            onClick={() => save.mutate()}
          >
            {t('loans.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

/** تسوية مبكرة: دمج المتبقي في قسط واحد من الراتب، أو سداد نقدي يُغلق السلفة فوراً. */
const SettleModal = ({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const now = new Date();
  const [mode, setMode] = useState<'payroll' | 'cash'>('payroll');
  const [target, setTarget] = useState(ym(now.getFullYear(), now.getMonth() + 1));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [y, m] = target.split('-').map(Number);
  const valid = reason.trim().length >= 2 && (mode === 'cash' || (!!y && !!m && m >= 1 && m <= 12));
  const save = useMutation({
    mutationFn: async () =>
      api.post(
        `/payroll/loans/${loan.id}/settle`,
        mode === 'payroll'
          ? { mode, reason: reason.trim(), targetYear: y, targetMonth: m }
          : { mode, reason: reason.trim(), reference: reference.trim() || undefined },
      ),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('loans.settleDone') });
      await qc.invalidateQueries({ queryKey: ['/payroll'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('loans.settleTitle')} size="md">
      <Stack>
        <Text
          size="sm"
          dir="ltr"
          ta="start"
        >{`${t('loans.remaining')}: ${loan.remaining} ${loan.currency}`}</Text>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'payroll' | 'cash')}
          data={[
            { value: 'payroll', label: t('loans.settlePayroll') },
            { value: 'cash', label: t('loans.settleCash') },
          ]}
        />
        {mode === 'payroll' ? (
          <>
            <Text size="sm" c="dimmed">
              {t('loans.settlePayrollHint')}
            </Text>
            <TextInput
              type="month"
              dir="ltr"
              label={t('loans.settleMonth')}
              value={target}
              onChange={(e) => setTarget(e.currentTarget.value)}
            />
          </>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {t('loans.settleCashHint')}
            </Text>
            <TextInput
              label={t('loans.settleReference')}
              value={reference}
              onChange={(e) => setReference(e.currentTarget.value)}
            />
          </>
        )}
        <TextInput
          label={t('loans.reasonRequired')}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('loans.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const LoanDrawer = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
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
  const [settling, setSettling] = useState(false);
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
            >{`${typeName(loan, lang) ?? t(`loans.kinds.${loan.kind}`)} · ${loan.principal} ${loan.currency}`}</Text>
          </Group>
          <Group gap="xl">
            <Text size="sm" dir="ltr">{`${t('loans.repaid')}: ${loan.repaid}`}</Text>
            <Text size="sm" dir="ltr">{`${t('loans.remaining')}: ${loan.remaining}`}</Text>
          </Group>
          {loan.reason && <Text size="sm">{loan.reason}</Text>}
          <Title order={5}>{t('loans.attachments.title')}</Title>
          <LoanAttachments
            loanId={id}
            canEdit={can('payroll.loan.create')}
            requiresAttachment={loan.requiresAttachment === true}
          />
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
          {loan.settlementMode === 'cash' && (
            <Alert color="teal">
              {`${t('loans.settledCash')}: ${loan.settlementAmount} ${loan.currency}${loan.settlementReference ? ` — ${loan.settlementReference}` : ''}`}
            </Alert>
          )}
          {manage && loan.status === 'active' && Number(loan.remaining) > 0 && (
            <Button variant="light" onClick={() => setSettling(true)}>
              {t('loans.settle')}
            </Button>
          )}
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
      {settling && loan && <SettleModal loan={loan} onClose={() => setSettling(false)} />}
      {marking && <MarkPaidModal ids={marking} onClose={() => setMarking(null)} />}
    </Drawer>
  );
};

/** السلف والقروض: القائمة (كلها أو لموظف)، منح سلفة بمعاينة الجدول، تفاصيل الأقساط والتأجيل والإلغاء. */
export const LoansPanel = ({ employeeId }: { employeeId?: string }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [bulk, setBulk] = useState(false);
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
          <Group>
            <Button variant="default" onClick={() => setBulk(true)}>
              {t('loans.bulkNew')}
            </Button>
            <Button onClick={() => setOpen(true)}>{t('loans.new')}</Button>
          </Group>
        )}
      </Group>
      <Table withTableBorder striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {!employeeId && <Table.Th>{t('payroll.run.employee')}</Table.Th>}
            <Table.Th>{t('loans.kind')}</Table.Th>
            <Table.Th>{t('loans.eventDate')}</Table.Th>
            <Table.Th>{t('loans.reference')}</Table.Th>
            <Table.Th>{t('loans.principal')}</Table.Th>
            <Table.Th>{t('loans.repaid')}</Table.Th>
            <Table.Th>{t('loans.remaining')}</Table.Th>
            <Table.Th>{t('loans.attachments.column')}</Table.Th>
            <Table.Th>{t('payroll.run.status')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((l) => (
            <Table.Tr key={l.id} onClick={() => setSel(l.id)} style={{ cursor: 'pointer' }}>
              {!employeeId && <Table.Td>{`${l.employeeNo ?? ''} · ${l.employeeName}`}</Table.Td>}
              <Table.Td>
                <Badge
                  variant="light"
                  style={
                    l.typeColor
                      ? { backgroundColor: `${l.typeColor}33`, color: 'inherit' }
                      : undefined
                  }
                >
                  {typeName(l, lang) ?? t(`loans.kinds.${l.kind}`)}
                </Badge>
              </Table.Td>
              <Table.Td dir="ltr">{l.eventDate ?? ''}</Table.Td>
              <Table.Td dir="ltr">{l.reference ?? ''}</Table.Td>
              <Table.Td dir="ltr">{`${l.principal} ${l.currency}`}</Table.Td>
              <Table.Td dir="ltr">{l.repaid}</Table.Td>
              <Table.Td dir="ltr">{l.remaining}</Table.Td>
              <Table.Td>
                {(l.attachmentsCount ?? 0) > 0 ? (
                  <Badge variant="light" color="teal">{`📎 ${l.attachmentsCount}`}</Badge>
                ) : l.requiresAttachment ? (
                  <Badge variant="light" color="orange">
                    {t('loans.attachments.pending')}
                  </Badge>
                ) : null}
              </Table.Td>
              <Table.Td>
                <Badge color={statusColor[l.status]}>{t(`loans.statuses.${l.status}`)}</Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {(list.data ?? []).length === 0 && <Text c="dimmed">{t('loans.empty')}</Text>}
      {bulk && <BulkInvoiceModal employeeId={employeeId} onClose={() => setBulk(false)} />}
      {open && <NewLoanModal employeeId={employeeId} onClose={() => setOpen(false)} />}
      {sel && <LoanDrawer id={sel} onClose={() => setSel(null)} />}
    </Stack>
  );
};
