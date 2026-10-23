import {
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  NativeSelect,
  NumberInput,
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
import { api } from '../../api/client';
import { printSlip } from './payslipPrint';
import { errorMessage } from '../../lib/errors';
import type { Reason, SlipDetail, SlipLine } from './runs-types';

/** قسيمة: البنود، «كيف حُسب؟»، التجاوز اليدوي بسبب إلزامي، والبنود المضافة. */
export const PayslipDrawer = ({
  slipId,
  canOverride,
  onClose,
}: {
  slipId: string;
  canOverride: boolean;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const slip = useQuery({
    queryKey: ['/payroll', 'slip', slipId],
    queryFn: async () => (await api.get<SlipDetail>(`/payroll/payslips/${slipId}`)).data,
  });
  const reasons = useQuery({
    queryKey: ['/payroll', 'override-reasons'],
    queryFn: async () => (await api.get<Reason[]>('/payroll/override-reasons')).data,
    enabled: canOverride,
  });
  const [edit, setEdit] = useState<{
    line: SlipLine | null;
    amount: string;
    reasonId: string;
    note: string;
    kind: string;
    nameAr: string;
  } | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/payroll'] });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const save = useMutation({
    mutationFn: async () => {
      if (!edit) return;
      const body = { amount: edit.amount, reasonId: edit.reasonId, note: edit.note || null };
      if (edit.line) await api.patch(`/payroll/payslips/${slipId}/lines/${edit.line.id}`, body);
      else
        await api.post(`/payroll/payslips/${slipId}/lines`, {
          ...body,
          kind: edit.kind,
          nameAr: edit.nameAr,
        });
    },
    onSuccess: async () => {
      setEdit(null);
      await refresh();
    },
    onError: fail,
  });
  const d = slip.data;
  const name = (l: SlipLine) => (i18n.language === 'en' && l.nameEn) || l.nameAr;
  const reasonOptions = (reasons.data ?? [])
    .filter((r) => r.isActive)
    .map((r) => ({ value: r.id, label: r.nameAr }));
  const openEdit = (line: SlipLine | null) =>
    setEdit({
      line,
      amount: line?.amount ?? '',
      reasonId: reasonOptions[0]?.value ?? '',
      note: '',
      kind: 'earning',
      nameAr: '',
    });
  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size="lg"
      title={d ? `${d.employeeNo} · ${d.employeeName}` : ''}
    >
      {d && (
        <Stack>
          {d.error && <Text c="red">{d.error}</Text>}
          <Group justify="flex-end">
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => printSlip(slipId, i18n.language).catch(fail)}
            >
              {t('hr.emp.payslips.print')}
            </Button>
          </Group>
          <Table withTableBorder>
            <Table.Tbody>
              {d.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    {name(l)}{' '}
                    {l.isManual && (
                      <Badge size="xs" color="orange">
                        {t('payroll.run.manual')}
                      </Badge>
                    )}
                    {l.autoChanged && (
                      <Badge size="xs" color="red" variant="light">
                        {t('payroll.run.autoChanged')}
                      </Badge>
                    )}
                    {l.overrideReasonName && (
                      <Text size="xs" c="dimmed">
                        {[l.overrideReasonName, l.overrideNote].filter(Boolean).join(' — ')}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{t(`payroll.kinds.${l.kind}`)}</Table.Td>
                  <Table.Td dir="ltr" fw={600}>
                    {l.amount}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() => setWhy(why === l.id ? null : l.id)}
                      >
                        {t('payroll.run.how')}
                      </Button>
                      {canOverride && l.code !== 'basic' && (
                        <Button size="compact-xs" variant="subtle" onClick={() => openEdit(l)}>
                          {t('payroll.edit')}
                        </Button>
                      )}
                      {canOverride && l.isManual && !l.isAdded && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() =>
                            api
                              .del(`/payroll/payslips/${slipId}/lines/${l.id}/override`)
                              .then(refresh)
                              .catch(fail)
                          }
                        >
                          {t('payroll.run.revert')}
                        </Button>
                      )}
                      {canOverride && l.isAdded && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            api
                              .del(`/payroll/payslips/${slipId}/lines/${l.id}`)
                              .then(refresh)
                              .catch(fail)
                          }
                        >
                          {t('payroll.remove')}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {why && (
            <Code block dir="ltr">
              {JSON.stringify(d.lines.find((l) => l.id === why)?.explain ?? {}, null, 2)}
            </Code>
          )}
          <Group justify="space-between">
            <Stack gap={2}>
              <Title order={5} dir="ltr">{`${t('payroll.run.net')}: ${d.netAmount}`}</Title>
              {(d.loanItems ?? []).length > 0 && (
                <>
                  <Text size="sm" dir="ltr">{`${t('payroll.run.loans')}: ${d.loansAmount}`}</Text>
                  <Title
                    order={5}
                    dir="ltr"
                  >{`${t('payroll.run.payable')}: ${d.payableAmount}`}</Title>
                  {(d.loanItems ?? []).map((i) => (
                    <Text
                      key={i.installmentId}
                      size="xs"
                      c={i.overCap ? 'orange' : 'dimmed'}
                      dir="ltr"
                    >
                      {`${t(`loans.kinds.${i.kind}`)} ${i.no}/${i.installmentsCount} · ${i.amount}${
                        i.overCap ? ` · ${t('loans.overCap')}` : ''
                      }`}
                    </Text>
                  ))}
                </>
              )}
            </Stack>
            {canOverride && (
              <Button size="xs" variant="light" onClick={() => openEdit(null)}>
                {t('payroll.run.addLine')}
              </Button>
            )}
          </Group>
          {edit && (
            <Stack>
              <Title order={6}>{edit.line ? name(edit.line) : t('payroll.run.addLine')}</Title>
              {!edit.line && (
                <Group grow>
                  <TextInput
                    label={t('payroll.nameAr')}
                    value={edit.nameAr}
                    onChange={(e) => setEdit({ ...edit, nameAr: e.currentTarget.value })}
                  />
                  <NativeSelect
                    label={t('payroll.kind')}
                    value={edit.kind}
                    data={['earning', 'deduction', 'employer'].map((k) => ({
                      value: k,
                      label: t(`payroll.kinds.${k}`),
                    }))}
                    onChange={(e) => setEdit({ ...edit, kind: e.currentTarget.value })}
                  />
                </Group>
              )}
              <NumberInput
                label={t('payroll.run.amount')}
                min={0}
                decimalScale={4}
                value={edit.amount}
                onChange={(x) => setEdit({ ...edit, amount: String(x) })}
              />
              <NativeSelect
                label={t('payroll.run.reason')}
                value={edit.reasonId}
                data={reasonOptions}
                onChange={(e) => setEdit({ ...edit, reasonId: e.currentTarget.value })}
              />
              <TextInput
                label={t('payroll.run.note')}
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.currentTarget.value })}
              />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setEdit(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  loading={save.isPending}
                  disabled={!edit.reasonId || edit.amount === ''}
                  onClick={() => save.mutate()}
                >
                  {t('common.save')}
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
};
