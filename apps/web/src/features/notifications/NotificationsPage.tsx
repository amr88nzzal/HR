import {
  Anchor,
  Badge,
  Button,
  Group,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationDto,
  type PreferenceMatrix,
  type TelegramMeDto,
} from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { DataTable, type Column } from '../../components/DataTable';
import { useFormat } from '../../lib/useFormat';

const PAGE_SIZE = 20;

const TelegramLink = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['/integrations/telegram/me'],
    queryFn: async () => (await api.get<TelegramMeDto>('/integrations/telegram/me')).data,
  });
  const [link, setLink] = useState<string>();
  const create = useMutation({
    mutationFn: async () =>
      (await api.post<{ deepLink: string }>('/integrations/telegram/me/link-code', {})).data,
    onSuccess: (d) => setLink(d.deepLink),
    onError: () => notifications.show({ color: 'red', message: t('apiErrors.generic') }),
  });
  const unlink = useMutation({
    mutationFn: async () => void (await api.del('/integrations/telegram/me')),
    onSuccess: () => {
      setLink(undefined);
      return qc.invalidateQueries({ queryKey: ['/integrations/telegram/me'] });
    },
  });
  if (!me.data?.available) return null;
  return (
    <Stack gap="xs" maw={560}>
      <Group>
        <Text fw={600}>{t('notifications.telegram.title')}</Text>
        <Badge color={me.data.linked ? 'green' : 'gray'}>
          {me.data.linked
            ? `${t('notifications.telegram.linked')}${me.data.tgUsername ? ` @${me.data.tgUsername}` : ''}`
            : t('notifications.telegram.notLinked')}
        </Badge>
        {me.data.linked ? (
          <Button size="xs" variant="light" color="red" onClick={() => unlink.mutate()}>
            {t('notifications.telegram.unlink')}
          </Button>
        ) : (
          <Button size="xs" loading={create.isPending} onClick={() => create.mutate()}>
            {t('notifications.telegram.link')}
          </Button>
        )}
      </Group>
      {link && !me.data.linked && (
        <Text size="sm">
          {t('notifications.telegram.openLink')}{' '}
          <Anchor href={link} target="_blank" rel="noreferrer" dir="ltr">
            {link}
          </Anchor>
          <br />
          <Button
            mt="xs"
            size="xs"
            variant="subtle"
            onClick={() => qc.invalidateQueries({ queryKey: ['/integrations/telegram/me'] })}
          >
            {t('notifications.telegram.refresh')}
          </Button>
        </Text>
      )}
    </Stack>
  );
};

const Preferences = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['/notifications', 'preferences'],
    queryFn: async () => (await api.get<PreferenceMatrix>('/notifications/preferences')).data,
  });
  const save = useMutation({
    mutationFn: async (v: { category: string; channel: NotificationChannel; enabled: boolean }) =>
      void (await api.put('/notifications/preferences', { items: [v] })),
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('notifications.saved') });
      return qc.invalidateQueries({ queryKey: ['/notifications', 'preferences'] });
    },
  });
  return (
    <Stack>
      <TelegramLink />
      <Text size="sm" c="dimmed">
        {t('notifications.prefsHint')}
      </Text>
      <Table withTableBorder maw={560}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('notifications.category')}</Table.Th>
            {NOTIFICATION_CHANNELS.map((c) => (
              <Table.Th key={c}>{t(`notifications.channels.${c}`)}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(prefs.data ?? []).map((row) => (
            <Table.Tr key={row.category}>
              <Table.Td>
                {t(`notifications.categories.${row.category}`, { defaultValue: row.category })}
                {row.mandatory && (
                  <Badge ms="xs" size="xs" variant="light">
                    {t('notifications.mandatory')}
                  </Badge>
                )}
              </Table.Td>
              {NOTIFICATION_CHANNELS.map((c) => (
                <Table.Td key={c}>
                  <Switch
                    checked={row.channels[c]}
                    disabled={row.mandatory || save.isPending}
                    aria-label={`${row.category}-${c}`}
                    onChange={(e) =>
                      save.mutate({
                        category: row.category,
                        channel: c,
                        enabled: e.currentTarget.checked,
                      })
                    }
                  />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
};

const Inbox = () => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const list = useList('/notifications', {
    page,
    pageSize: PAGE_SIZE,
    unread: unread || undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['/notifications'] });
  const markRead = useMutation({
    mutationFn: async (id: string) => void (await api.post(`/notifications/${id}/read`, {})),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: async () => void (await api.post('/notifications/read-all', {})),
    onSuccess: refresh,
  });
  const rows = (list.data?.data ?? []) as unknown as NotificationDto[];
  const columns: Column<NotificationDto>[] = [
    {
      key: 'title',
      header: t('notifications.titleCol'),
      render: (n) => (
        <Stack gap={0}>
          <Text size="sm" fw={n.readAt ? 400 : 700} dir="auto">
            {n.title}
          </Text>
          <Text size="xs" c="dimmed" dir="auto">
            {n.body}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'category',
      header: t('notifications.category'),
      render: (n) => t(`notifications.categories.${n.category}`, { defaultValue: n.category }),
    },
    { key: 'when', header: t('notifications.when'), render: (n) => fmt.dateTime(n.createdAt) },
  ];
  return (
    <Stack>
      <Group>
        <Switch
          label={t('notifications.onlyUnread')}
          checked={unread}
          onChange={(e) => (setUnread(e.currentTarget.checked), setPage(1))}
        />
        <Button
          variant="light"
          size="xs"
          loading={markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {t('notifications.markAll')}
        </Button>
      </Group>
      <DataTable
        columns={columns}
        rows={rows}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        onRowClick={(n) => {
          if (!n.readAt) markRead.mutate(n.id);
          if (n.link) void navigate({ to: n.link as never });
        }}
      />
    </Stack>
  );
};

export const NotificationsPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('notifications.title')}</Title>
      <Tabs defaultValue="inbox" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="inbox">{t('notifications.inbox')}</Tabs.Tab>
          <Tabs.Tab value="prefs">{t('notifications.preferences')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="inbox" pt="md">
          <Inbox />
        </Tabs.Panel>
        <Tabs.Panel value="prefs" pt="md">
          <Preferences />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
