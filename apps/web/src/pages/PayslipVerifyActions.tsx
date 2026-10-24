import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from '../lib/errors';

export type Methods = {
  figures: boolean;
  otpTelegram: boolean;
  otpEmail: boolean;
  secret: 'birthDate' | 'custom' | null;
};
type Line = { name: string; amount: string };
type Full = {
  holder: string;
  employeeNo: string | null;
  year: number;
  month: number;
  currency: string;
  earnings: Line[];
  deductions: Line[];
  loans: Line[];
  gross: string;
  deductionsTotal: string;
  net: string;
  loansTotal: string;
  payable: string;
};

/**
 * إجراءات التحقق العام: مطابقة الأرقام المطبوعة، ثم كشف القسيمة كاملة بـ OTP (تلغرام/بريد) أو بقيمة سرية.
 * Public verification actions: match the printed figures, then reveal the whole payslip via OTP (Telegram/email) or a secret value.
 */
export const PayslipVerifyActions = ({ token, methods }: { token: string; methods: Methods }) => {
  const { t } = useTranslation();
  const base = `/public/verify/payslip/${token}`;
  const [fig, setFig] = useState({ gross: '', deductions: '', payable: '' });
  const [otp, setOtp] = useState('');
  const [secret, setSecret] = useState('');
  const [sentHint, setSentHint] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: async () => (await api.post<{ match: boolean }>(`${base}/check`, fig)).data.match,
  });
  const send = useMutation({
    mutationFn: async (channel: 'telegram' | 'email') =>
      (await api.post<{ hint: string }>(`${base}/otp`, { channel })).data.hint,
    onSuccess: (h) => setSentHint(h),
  });
  const reveal = useMutation({
    mutationFn: async (body: { otp?: string; secret?: string }) =>
      (await api.post<Full>(`${base}/reveal`, body)).data,
  });
  const hasReveal = methods.otpTelegram || methods.otpEmail || methods.secret !== null;
  const d = reveal.data;
  const err = (e: unknown) => (
    <Alert color="red" variant="light">
      {errorMessage(e, t)}
    </Alert>
  );
  const rows = (title: string, list: Line[]) =>
    list.length > 0 && (
      <>
        <Table.Tr>
          <Table.Th colSpan={2}>{title}</Table.Th>
        </Table.Tr>
        {list.map((l, i) => (
          <Table.Tr key={`${title}-${i}`}>
            <Table.Td>{l.name}</Table.Td>
            <Table.Td dir="ltr" ta="end">
              {l.amount}
            </Table.Td>
          </Table.Tr>
        ))}
      </>
    );
  return (
    <Stack>
      {methods.figures && (
        <>
          <Divider />
          <Title order={5}>{t('verify.figures.title')}</Title>
          <Text size="sm" c="dimmed">
            {t('verify.figures.hint')}
          </Text>
          <Group grow align="flex-end">
            {(['gross', 'deductions', 'payable'] as const).map((k) => (
              <TextInput
                key={k}
                dir="ltr"
                inputMode="decimal"
                label={t(`verify.figures.${k}`)}
                value={fig[k]}
                onChange={(e) => setFig({ ...fig, [k]: e.currentTarget.value })}
              />
            ))}
          </Group>
          <Group>
            <Button
              onClick={() => check.mutate()}
              loading={check.isPending}
              disabled={!fig.gross || !fig.deductions || !fig.payable}
            >
              {t('verify.figures.check')}
            </Button>
            {check.data === true && (
              <Badge size="lg" color="teal" variant="light">
                {t('verify.figures.match')}
              </Badge>
            )}
            {check.data === false && (
              <Badge size="lg" color="red" variant="light">
                {t('verify.figures.noMatch')}
              </Badge>
            )}
          </Group>
          {check.isError && err(check.error)}
        </>
      )}
      {hasReveal && !d && (
        <>
          <Divider />
          <Title order={5}>{t('verify.reveal.title')}</Title>
          <Text size="sm" c="dimmed">
            {t('verify.reveal.hint')}
          </Text>
          {(methods.otpTelegram || methods.otpEmail) && (
            <Stack gap="xs">
              <Group>
                {methods.otpTelegram && (
                  <Button
                    variant="light"
                    loading={send.isPending}
                    onClick={() => send.mutate('telegram')}
                  >
                    {t('verify.reveal.sendTelegram')}
                  </Button>
                )}
                {methods.otpEmail && (
                  <Button
                    variant="light"
                    loading={send.isPending}
                    onClick={() => send.mutate('email')}
                  >
                    {t('verify.reveal.sendEmail')}
                  </Button>
                )}
              </Group>
              {send.isError && err(send.error)}
              {sentHint && (
                <>
                  <Text size="sm">{t('verify.reveal.sent', { hint: sentHint })}</Text>
                  <Group align="flex-end">
                    <TextInput
                      dir="ltr"
                      label={t('verify.reveal.otp')}
                      inputMode="numeric"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.currentTarget.value)}
                    />
                    <Button
                      loading={reveal.isPending}
                      disabled={otp.length !== 6}
                      onClick={() => reveal.mutate({ otp })}
                    >
                      {t('verify.reveal.show')}
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          )}
          {methods.secret && (
            <Group align="flex-end">
              <TextInput
                dir="ltr"
                type={methods.secret === 'birthDate' ? 'date' : 'text'}
                label={t(`verify.reveal.secret.${methods.secret}`)}
                value={secret}
                onChange={(e) => setSecret(e.currentTarget.value)}
              />
              <Button
                loading={reveal.isPending}
                disabled={!secret}
                onClick={() => reveal.mutate({ secret })}
              >
                {t('verify.reveal.show')}
              </Button>
            </Group>
          )}
          {reveal.isError && err(reveal.error)}
        </>
      )}
      {d && (
        <>
          <Divider />
          <Title order={5}>
            {d.holder} · {d.year}-{String(d.month).padStart(2, '0')}
          </Title>
          <Table>
            <Table.Tbody>
              {rows(t('verify.reveal.earnings'), d.earnings)}
              <Table.Tr>
                <Table.Th>{t('verify.figures.gross')}</Table.Th>
                <Table.Td dir="ltr" ta="end" fw={700}>
                  {d.gross} {d.currency}
                </Table.Td>
              </Table.Tr>
              {rows(t('verify.reveal.deductions'), d.deductions)}
              <Table.Tr>
                <Table.Th>{t('verify.figures.deductions')}</Table.Th>
                <Table.Td dir="ltr" ta="end" fw={700}>
                  {d.deductionsTotal} {d.currency}
                </Table.Td>
              </Table.Tr>
              {rows(t('verify.reveal.loans'), d.loans)}
              <Table.Tr>
                <Table.Th>{t('verify.reveal.net')}</Table.Th>
                <Table.Td dir="ltr" ta="end" fw={700}>
                  {d.net} {d.currency}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>{t('verify.figures.payable')}</Table.Th>
                <Table.Td dir="ltr" ta="end" fw={700}>
                  {d.payable} {d.currency}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
};
