import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  Indicator,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { NotificationDto } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useFormat } from '../../lib/useFormat';

/** جرس الإشعارات في الترويسة: عدّاد غير المقروء (استعلام دوري) وآخر الإشعارات. */
export const NotificationBell = () => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [opened, setOpened] = useState(false);

  const count = useQuery({
    queryKey: ['/notifications', 'unread-count'],
    queryFn: async () =>
      (await api.get<{ count: number }>('/notifications/unread-count')).data.count,
    refetchInterval: 30_000,
  });
  const latest = useList('/notifications', { page: 1, pageSize: 6 }, opened);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/notifications'] });
  const markRead = useMutation({
    mutationFn: async (id: string) => void (await api.post(`/notifications/${id}/read`, {})),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: async () => void (await api.post('/notifications/read-all', {})),
    onSuccess: refresh,
  });

  const rows = (latest.data?.data ?? []) as unknown as NotificationDto[];
  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpened(false);
    void navigate({ to: (n.link ?? '/notifications') as never });
  };

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={340} withinPortal>
      <Popover.Target>
        <Indicator
          label={count.data && count.data > 99 ? '99+' : count.data}
          disabled={!count.data}
          size={16}
          color="red"
          offset={4}
        >
          <ActionIcon
            variant="subtle"
            aria-label={t('notifications.title')}
            title={t('notifications.title')}
            onClick={() => setOpened((o) => !o)}
          >
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Group justify="space-between" px="xs" pb="xs">
          <Text fw={600} size="sm">
            {t('notifications.title')}
          </Text>
          <Anchor
            size="xs"
            component="button"
            type="button"
            disabled={!count.data}
            onClick={() => markAll.mutate()}
          >
            {t('notifications.markAll')}
          </Anchor>
        </Group>
        <Stack gap={2}>
          {rows.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="md">
              {t('notifications.empty')}
            </Text>
          )}
          {rows.map((n) => (
            <UnstyledButton
              key={n.id}
              onClick={() => open(n)}
              p="xs"
              style={{
                borderRadius: 6,
                background: n.readAt ? undefined : 'var(--mantine-color-blue-light)',
              }}
            >
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={n.readAt ? 400 : 600} dir="auto">
                    {n.title}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2} dir="auto">
                    {n.body}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {fmt.dateTime(n.createdAt)}
                  </Text>
                </Stack>
                {!n.readAt && <Badge size="xs" circle />}
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
        <Group justify="center" pt="xs">
          <Anchor
            size="xs"
            component="button"
            type="button"
            onClick={() => {
              setOpened(false);
              void navigate({ to: '/notifications' as never });
            }}
          >
            {t('notifications.viewAll')}
          </Anchor>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
};
