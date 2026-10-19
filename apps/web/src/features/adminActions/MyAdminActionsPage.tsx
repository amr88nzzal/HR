import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { categoryColor, type MyActionRow } from './types';

/** سجلّي الإداري: الإجراءات المعتمدة بحق الموظف المرتبط بحسابه، مع إقرار الاستلام. */
export const MyAdminActionsPage = () => {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['/me/admin-actions'],
    queryFn: async () => (await api.get<MyActionRow[]>('/me/admin-actions')).data,
  });
  const ack = useMutation({
    mutationFn: async (id: string) => api.post(`/me/admin-actions/${id}/acknowledge`, {}),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('adminActions.ackDone') });
      await qc.invalidateQueries({ queryKey: ['/me/admin-actions'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.requiresAcknowledgment && !r.acknowledgedAt).length;
  return (
    <Stack>
      <Title order={2}>{t('nav.myAdminActions')}</Title>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      {pending > 0 && (
        <Alert color="orange">{t('adminActions.myPending', { count: pending })}</Alert>
      )}
      {!q.isLoading && rows.length === 0 && <Text c="dimmed">{t('adminActions.myEmpty')}</Text>}
      {rows.map((r) => (
        <Card key={r.id} withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <Badge color={categoryColor[r.category]} variant="light">
                  {i18n.language === 'en' && r.typeNameEn ? r.typeNameEn : r.typeName}
                </Badge>
                <Text fw={600}>{r.title}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {fmt.date(r.actionDate)}
              </Text>
            </Group>
            {r.description && <Text size="sm">{r.description}</Text>}
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {t('adminActions.cols.effectiveDate')}: {fmt.date(r.effectiveDate)}
                {r.amount ? ` — ${r.amount} ${r.currency ?? ''}` : ''}
              </Text>
              {r.requiresAcknowledgment &&
                (r.acknowledgedAt ? (
                  <Badge color="teal" variant="light">
                    {t('adminActions.acknowledgedOn', { date: fmt.date(r.acknowledgedAt) })}
                  </Badge>
                ) : (
                  <Button size="xs" loading={ack.isPending} onClick={() => ack.mutate(r.id)}>
                    {t('adminActions.acknowledge')}
                  </Button>
                ))}
            </Group>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
};
