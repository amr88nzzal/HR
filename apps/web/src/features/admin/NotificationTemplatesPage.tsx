import {
  Badge,
  Button,
  Code,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LOCALES,
  type NotificationChannel,
  type NotificationLocale,
} from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

type Override = {
  eventKey: string;
  channel: NotificationChannel;
  locale: NotificationLocale;
  subject: string | null;
  body: string;
  isActive: boolean;
};
type EventRow = {
  eventKey: string;
  category: string;
  variables: string[];
  defaults: Record<NotificationLocale, { subject: string; body: string }>;
  overrides: Override[];
};

const Editor = ({ event, onClose }: { event: EventRow; onClose: () => void }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<NotificationChannel>('email');
  const [locale, setLocale] = useState<NotificationLocale>('ar');
  const override = event.overrides.find((o) => o.channel === channel && o.locale === locale);
  const def = event.defaults[locale];
  const [draft, setDraft] = useState<{
    key: string;
    subject: string;
    body: string;
    isActive: boolean;
  }>();
  const key = `${channel}/${locale}`;
  const form =
    draft?.key === key
      ? draft
      : {
          key,
          subject: override?.subject ?? def.subject,
          body: override?.body ?? def.body,
          isActive: override?.isActive ?? true,
        };
  const url = `/notification-templates/${event.eventKey}/${channel}/${locale}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['/notification-templates'] });
  const save = useMutation({
    mutationFn: async () =>
      void (await api.put(url, {
        subject: form.subject,
        body: form.body,
        isActive: form.isActive,
      })),
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('notifTemplates.saved') });
      return refresh();
    },
    onError: () => notifications.show({ color: 'red', message: t('notifTemplates.invalid') }),
  });
  const reset = useMutation({
    mutationFn: async () => void (await api.del(url)),
    onSuccess: () => {
      setDraft(undefined);
      return refresh();
    },
  });
  const canEdit = can('system.notification_template.update');

  return (
    <Modal opened onClose={onClose} title={event.eventKey} size="lg" centered>
      <Stack>
        <Group>
          <SegmentedControl
            value={channel}
            onChange={(v) => setChannel(v as NotificationChannel)}
            data={NOTIFICATION_CHANNELS.map((c) => ({
              value: c,
              label: t(`notifications.channels.${c}`),
            }))}
          />
          <SegmentedControl
            value={locale}
            onChange={(v) => setLocale(v as NotificationLocale)}
            data={NOTIFICATION_LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))}
          />
          {override && <Badge variant="light">{t('notifTemplates.customized')}</Badge>}
        </Group>
        <Text size="xs" c="dimmed">
          {t('notifTemplates.variables')}:{' '}
          {event.variables.map((v) => (
            <Code key={v} me={4}>{`{{${v}}}`}</Code>
          ))}
        </Text>
        <TextInput
          label={t('notifTemplates.subject')}
          value={form.subject}
          disabled={!canEdit}
          dir="auto"
          onChange={(e) => setDraft({ ...form, subject: e.currentTarget.value })}
        />
        <Textarea
          label={t('notifTemplates.body')}
          value={form.body}
          disabled={!canEdit}
          autosize
          minRows={4}
          dir="auto"
          onChange={(e) => setDraft({ ...form, body: e.currentTarget.value })}
        />
        <Switch
          label={t('notifTemplates.active')}
          checked={form.isActive}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...form, isActive: e.currentTarget.checked })}
        />
        {canEdit && (
          <Group justify="space-between">
            <Button
              variant="default"
              disabled={!override}
              loading={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {t('notifTemplates.reset')}
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
};

export const NotificationTemplatesPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const events = useQuery({
    queryKey: ['/notification-templates'],
    queryFn: async () => (await api.get<EventRow[]>('/notification-templates')).data,
  });
  const test = useMutation({
    mutationFn: async () => void (await api.post('/notifications/test', {})),
    onSuccess: () => notifications.show({ color: 'green', message: t('notifTemplates.testSent') }),
    onError: () => notifications.show({ color: 'red', message: t('notifTemplates.testFailed') }),
  });
  const current = events.data?.find((e) => e.eventKey === selected);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('notifTemplates.title')}</Title>
        {can('system.notification_template.update') && (
          <Button variant="light" loading={test.isPending} onClick={() => test.mutate()}>
            {t('notifTemplates.sendTest')}
          </Button>
        )}
      </Group>
      <Table highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('notifTemplates.event')}</Table.Th>
            <Table.Th>{t('notifications.category')}</Table.Th>
            <Table.Th>{t('notifTemplates.customizedCount')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(events.data ?? []).map((e) => (
            <Table.Tr
              key={e.eventKey}
              onClick={() => setSelected(e.eventKey)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td dir="ltr">{e.eventKey}</Table.Td>
              <Table.Td>
                {t(`notifications.categories.${e.category}`, { defaultValue: e.category })}
              </Table.Td>
              <Table.Td>{e.overrides.length}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {current && (
        <Editor key={current.eventKey} event={current} onClose={() => setSelected(null)} />
      )}
    </Stack>
  );
};
