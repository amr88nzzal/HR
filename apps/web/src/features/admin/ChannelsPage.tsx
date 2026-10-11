import {
  Alert,
  Badge,
  Button,
  Card,
  ActionIcon,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailSettingsDto, TelegramLinkDto, TelegramSettingsDto } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { IconTrash } from '@tabler/icons-react';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type Form = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** undefined = إبقاء المحفوظ */
  password: string | undefined;
  from: string;
};

const toForm = (d: EmailSettingsDto | null): Form => ({
  enabled: d?.enabled ?? true,
  host: d?.host ?? '',
  port: d?.port ?? 587,
  secure: d?.secure ?? false,
  user: d?.user ?? '',
  password: undefined,
  from: d?.from ?? '',
});

const EmailCard = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('system.integration.manage');
  const q = useQuery({
    queryKey: ['/integrations/email'],
    queryFn: async () => (await api.get<EmailSettingsDto | null>('/integrations/email')).data,
  });
  const [draft, setDraft] = useState<Form>();
  const [testTo, setTestTo] = useState('');
  const form = draft ?? toForm(q.data ?? null);
  const set = (patch: Partial<Form>) => setDraft({ ...form, ...patch });

  const save = useMutation({
    mutationFn: async () =>
      api.put('/integrations/email', {
        enabled: form.enabled,
        host: form.host.trim(),
        port: form.port,
        secure: form.secure,
        user: form.user.trim() || null,
        password: form.password,
        from: form.from.trim(),
      }),
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('channels.saved') });
      setDraft(undefined);
      await qc.invalidateQueries({ queryKey: ['/integrations/email'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const test = useMutation({
    mutationFn: async () => api.post('/integrations/email/test', { to: testTo.trim() }),
    onSuccess: () => notifications.show({ color: 'green', message: t('channels.testSent') }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const source = q.data?.source ?? 'none';
  const valid = !!form.host.trim() && !!form.from.trim() && form.port > 0;

  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>{t('channels.email.title')}</Title>
          <Badge color={source === 'none' ? 'gray' : 'green'}>
            {t(`channels.email.source.${source}`)}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {t('channels.email.hint')}
        </Text>
        <Switch
          label={t('channels.email.enabled')}
          checked={form.enabled}
          disabled={!canManage}
          onChange={(e) => set({ enabled: e.currentTarget.checked })}
        />
        <Group grow align="flex-start">
          <TextInput
            label={t('channels.email.host')}
            placeholder="smtp.gmail.com"
            value={form.host}
            disabled={!canManage}
            onChange={(e) => set({ host: e.currentTarget.value })}
          />
          <NumberInput
            label={t('channels.email.port')}
            value={form.port}
            min={1}
            max={65535}
            disabled={!canManage}
            onChange={(v) => set({ port: Number(v) || 0 })}
          />
        </Group>
        <Switch
          label={t('channels.email.secure')}
          description={t('channels.email.secureHint')}
          checked={form.secure}
          disabled={!canManage}
          onChange={(e) => set({ secure: e.currentTarget.checked })}
        />
        <Group grow align="flex-start">
          <TextInput
            label={t('channels.email.user')}
            value={form.user}
            disabled={!canManage}
            onChange={(e) => set({ user: e.currentTarget.value })}
          />
          <PasswordInput
            label={t('channels.email.password')}
            description={q.data?.hasPassword ? t('channels.email.passwordKept') : undefined}
            placeholder={q.data?.hasPassword ? '••••••••' : ''}
            value={form.password ?? ''}
            disabled={!canManage}
            autoComplete="new-password"
            onChange={(e) => set({ password: e.currentTarget.value })}
          />
        </Group>
        <TextInput
          label={t('channels.email.from')}
          placeholder="HRMS <name@example.com>"
          value={form.from}
          disabled={!canManage}
          onChange={(e) => set({ from: e.currentTarget.value })}
        />
        {canManage && (
          <>
            <Group>
              <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </Group>
            <Alert variant="light" title={t('channels.email.testTitle')}>
              <Group align="flex-end">
                <TextInput
                  style={{ flex: 1 }}
                  type="email"
                  label={t('channels.email.testTo')}
                  value={testTo}
                  onChange={(e) => setTestTo(e.currentTarget.value)}
                />
                <Button
                  variant="light"
                  loading={test.isPending}
                  disabled={!testTo.includes('@') || draft !== undefined}
                  onClick={() => test.mutate()}
                >
                  {t('channels.email.send')}
                </Button>
              </Group>
              {draft !== undefined && (
                <Text size="xs" c="dimmed" mt="xs">
                  {t('channels.email.saveFirst')}
                </Text>
              )}
            </Alert>
          </>
        )}
      </Stack>
    </Card>
  );
};

const TelegramCard = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('system.integration.manage');
  const q = useQuery({
    queryKey: ['/integrations/telegram'],
    queryFn: async () => (await api.get<TelegramSettingsDto | null>('/integrations/telegram')).data,
  });
  const links = useQuery({
    queryKey: ['/integrations/telegram/links'],
    queryFn: async () => (await api.get<TelegramLinkDto[]>('/integrations/telegram/links')).data,
  });
  const [draft, setDraft] = useState<{
    enabled: boolean;
    botToken: string;
    publicUrl: string;
  }>();
  const form = draft ?? {
    enabled: q.data?.enabled ?? true,
    botToken: '',
    publicUrl: q.data?.publicUrl ?? '',
  };
  const set = (patch: Partial<typeof form>) => setDraft({ ...form, ...patch });

  const save = useMutation({
    mutationFn: async () =>
      api.put('/integrations/telegram', {
        enabled: form.enabled,
        botToken: form.botToken.trim() || undefined,
        publicUrl: form.publicUrl.trim(),
      }),
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('channels.saved') });
      setDraft(undefined);
      await qc.invalidateQueries({ queryKey: ['/integrations/telegram'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const test = useMutation({
    mutationFn: async () => api.post('/integrations/telegram/test', {}),
    onSuccess: () => notifications.show({ color: 'green', message: t('channels.testSent') }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const unlink = useMutation({
    mutationFn: async (userId: string) => api.del(`/integrations/telegram/links/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/integrations/telegram/links'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const valid =
    (q.data?.hasToken || !!form.botToken.trim()) &&
    (form.publicUrl.trim() === '' || form.publicUrl.trim().startsWith('https://'));
  const [manualUser, setManualUser] = useState<string | null>(null);
  const [manualChat, setManualChat] = useState('');
  const users = useQuery({
    queryKey: ['/users', 'options'],
    enabled: canManage,
    queryFn: async () =>
      (await api.get<{ id: string; displayName: string }[]>('/users', { pageSize: 200 })).data,
  });
  const manual = useMutation({
    mutationFn: async () =>
      api.put(`/integrations/telegram/links/${manualUser}`, { chatId: manualChat.trim() }),
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('channels.saved') });
      setManualChat('');
      await qc.invalidateQueries({ queryKey: ['/integrations/telegram/links'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>{t('channels.telegram.title')}</Title>
          <Badge color={q.data?.enabled ? 'green' : 'gray'}>
            {q.data?.enabled ? `@${q.data.botUsername ?? ''}` : t('channels.telegram.off')}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {t('channels.telegram.hint')}
        </Text>
        <Switch
          label={t('channels.email.enabled')}
          checked={form.enabled}
          disabled={!canManage}
          onChange={(e) => set({ enabled: e.currentTarget.checked })}
        />
        <PasswordInput
          label={t('channels.telegram.token')}
          description={q.data?.hasToken ? t('channels.telegram.tokenKept') : undefined}
          placeholder={q.data?.hasToken ? '••••••••' : '123456789:AA…'}
          value={form.botToken}
          disabled={!canManage}
          autoComplete="off"
          onChange={(e) => set({ botToken: e.currentTarget.value })}
        />
        <TextInput
          label={t('channels.telegram.publicUrl')}
          description={t('channels.telegram.publicUrlHint')}
          value={form.publicUrl}
          disabled={!canManage}
          onChange={(e) => set({ publicUrl: e.currentTarget.value })}
        />
        {canManage && (
          <Group>
            <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
            <Button
              variant="light"
              loading={test.isPending}
              disabled={!q.data?.enabled || draft !== undefined}
              onClick={() => test.mutate()}
            >
              {t('channels.telegram.testMine')}
            </Button>
          </Group>
        )}
        {canManage && (
          <Alert variant="light" title={t('channels.telegram.manualTitle')}>
            <Group align="flex-end">
              <Select
                style={{ flex: 1 }}
                searchable
                label={t('channels.telegram.manualUser')}
                value={manualUser}
                onChange={setManualUser}
                data={(users.data ?? []).map((u) => ({ value: u.id, label: u.displayName }))}
              />
              <TextInput
                label="chat id"
                dir="ltr"
                value={manualChat}
                onChange={(e) => setManualChat(e.currentTarget.value)}
              />
              <Button
                variant="light"
                loading={manual.isPending}
                disabled={
                  !manualUser || !/^-?\d{4,20}$/.test(manualChat.trim()) || !q.data?.enabled
                }
                onClick={() => manual.mutate()}
              >
                {t('channels.telegram.manualLink')}
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt="xs">
              {t('channels.telegram.manualHint')}
            </Text>
          </Alert>
        )}
        <Text fw={600} size="sm">
          {t('channels.telegram.linked')}
        </Text>
        {(links.data ?? []).length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('channels.telegram.noLinks')}
          </Text>
        ) : (
          <Table withTableBorder>
            <Table.Tbody>
              {(links.data ?? []).map((l) => (
                <Table.Tr key={l.userId}>
                  <Table.Td>{l.displayName}</Table.Td>
                  <Table.Td dir="ltr">{l.tgUsername ? `@${l.tgUsername}` : '—'}</Table.Td>
                  <Table.Td w={40}>
                    {canManage && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t('channels.telegram.unlink')}
                        onClick={() => unlink.mutate(l.userId)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
};

export const ChannelsPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('channels.title')}</Title>
      <EmailCard />
      <TelegramCard />
    </Stack>
  );
};
