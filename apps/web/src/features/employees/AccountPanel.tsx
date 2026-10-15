import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';

export type AccountState = 'none' | 'invited' | 'active' | 'disabled';
type Account = {
  state: AccountState;
  userId?: string;
  email?: string;
  username?: string | null;
  disabledReason?: string | null;
  lastLoginAt?: string | null;
  inviteExpiresAt?: string | null;
};
export type AccountResult = {
  email: string;
  delivery: 'invite' | 'temp';
  tempPassword?: string;
  inviteLink?: string;
  inviteExpiresAt?: string;
};

export const stateColor: Record<AccountState, string> = {
  none: 'gray',
  invited: 'yellow',
  active: 'teal',
  disabled: 'red',
};

/** نتيجة الإنشاء: الكلمة المؤقتة/رابط الدعوة تُعرض هنا مرة واحدة ولا تُخزَّن. */
export const AccountResultModal = ({
  result,
  onClose,
}: {
  result: AccountResult | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const secret = result?.tempPassword ?? result?.inviteLink ?? '';
  return (
    <Modal opened={result !== null} onClose={onClose} title={t('account.resultTitle')} centered>
      {result && (
        <Stack>
          <Text size="sm">
            {t(result.delivery === 'invite' ? 'account.inviteSent' : 'account.tempCreated', {
              email: result.email,
            })}
          </Text>
          <Code block dir="ltr">
            {secret}
          </Code>
          <Alert color="yellow">{t('account.shownOnce')}</Alert>
          <Group justify="flex-end">
            <CopyButton value={secret}>
              {({ copied, copy }) => (
                <Button variant="default" onClick={copy}>
                  {copied ? t('account.copied') : t('account.copy')}
                </Button>
              )}
            </CopyButton>
            <Button onClick={onClose}>{t('account.done')}</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

/** تبويب «الحساب» في بطاقة الموظف: حالة الحساب، إنشاؤه (دعوة/مؤقت)، وإعادة إرسال الدعوة. */
export const AccountPanel = ({ employeeId }: { employeeId: string }) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['/employees', 'account', employeeId],
    queryFn: async () => (await api.get<Account>(`/employees/${employeeId}/account`)).data,
  });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: '', delivery: 'invite' });
  const [result, setResult] = useState<AccountResult | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/employees'] });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<AccountResult>(`/employees/${employeeId}/account`, {
          delivery: v.delivery,
          ...(v.email ? { email: v.email } : {}),
        })
      ).data,
    onSuccess: async (r) => {
      setOpen(false);
      setResult(r);
      await refresh();
    },
    onError: fail,
  });
  const resend = useMutation({
    mutationFn: async () =>
      (await api.post<AccountResult>(`/employees/${employeeId}/account/resend-invite`, {})).data,
    onSuccess: async (r) => {
      setResult({ ...r, email: q.data?.email ?? '', delivery: 'invite' });
      await refresh();
    },
    onError: fail,
  });
  const a = q.data;
  if (!a) return null;
  return (
    <Stack>
      <Group>
        <Badge size="lg" color={stateColor[a.state]}>
          {t(`account.states.${a.state}`)}
        </Badge>
        {a.state === 'disabled' && a.disabledReason === 'employment_ended' && (
          <Text size="sm" c="dimmed">
            {t('account.disabledByEmployment')}
          </Text>
        )}
      </Group>
      {a.state === 'none' ? (
        <Group>
          <Text size="sm" c="dimmed">
            {t('account.noneHint')}
          </Text>
          <Button onClick={() => setOpen(true)}>{t('account.create')}</Button>
        </Group>
      ) : (
        <Table withTableBorder w="fit-content">
          <Table.Tbody>
            <Table.Tr>
              <Table.Th>{t('account.email')}</Table.Th>
              <Table.Td dir="ltr">{a.email}</Table.Td>
            </Table.Tr>
            {a.username && (
              <Table.Tr>
                <Table.Th>{t('account.username')}</Table.Th>
                <Table.Td dir="ltr">{a.username}</Table.Td>
              </Table.Tr>
            )}
            <Table.Tr>
              <Table.Th>{t('account.lastLogin')}</Table.Th>
              <Table.Td>{a.lastLoginAt ? fmt.dateTime(a.lastLoginAt) : '—'}</Table.Td>
            </Table.Tr>
            {a.state === 'invited' && (
              <Table.Tr>
                <Table.Th>{t('account.inviteExpires')}</Table.Th>
                <Table.Td>{a.inviteExpiresAt ? fmt.dateTime(a.inviteExpiresAt) : '—'}</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
      {a.state === 'invited' && (
        <Group>
          <Button variant="light" loading={resend.isPending} onClick={() => resend.mutate()}>
            {t('account.resend')}
          </Button>
        </Group>
      )}
      <Modal opened={open} onClose={() => setOpen(false)} title={t('account.create')} centered>
        <Stack>
          <TextInput
            label={t('account.email')}
            description={t('account.emailHint')}
            dir="ltr"
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.currentTarget.value })}
          />
          <Select
            label={t('account.delivery')}
            allowDeselect={false}
            value={v.delivery}
            data={[
              { value: 'invite', label: t('account.deliveries.invite') },
              { value: 'temp', label: t('account.deliveries.temp') },
            ]}
            onChange={(x) => setV({ ...v, delivery: x ?? 'invite' })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              {t('account.create')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <AccountResultModal result={result} onClose={() => setResult(null)} />
    </Stack>
  );
};
