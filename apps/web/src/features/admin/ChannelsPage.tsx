import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailSettingsDto } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
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

export const ChannelsPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('channels.title')}</Title>
      <EmailCard />
    </Stack>
  );
};
