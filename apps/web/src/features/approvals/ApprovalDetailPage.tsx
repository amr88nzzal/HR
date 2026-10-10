import {
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
  Timeline,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { STATUS_COLORS, type ApprovalDetail } from './types';

type Decision = 'approve' | 'reject' | 'return';

export const ApprovalDetailPage = () => {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const qc = useQueryClient();
  const { approvalId } = useParams({ strict: false }) as { approvalId: string };
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState<string>();

  const one = useQuery({
    queryKey: ['/approvals', 'one', approvalId],
    queryFn: async () => (await api.get<ApprovalDetail>(`/approvals/${approvalId}`)).data,
  });
  const done = async () => {
    notifications.show({ color: 'green', message: t('approvals.detail.done') });
    setDecision(null);
    setNote('');
    await qc.invalidateQueries({ queryKey: ['/approvals'] });
    await qc.invalidateQueries({ queryKey: ['/notifications'] });
  };
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const act = useMutation({
    mutationFn: async (d: Decision) =>
      void (await api.post(`/approvals/${approvalId}/actions`, { action: d, note: note || null })),
    onSuccess: done,
    onError: fail,
  });
  const withdraw = useMutation({
    mutationFn: async () => void (await api.post(`/approvals/${approvalId}/withdraw`, {})),
    onSuccess: done,
    onError: fail,
  });
  const resubmit = useMutation({
    mutationFn: async () =>
      void (await api.post(`/approvals/${approvalId}/resubmit`, title ? { title } : {})),
    onSuccess: done,
    onError: fail,
  });

  const d = one.data;
  if (!d) return null;
  const stepName = (s: { nameAr: string; nameEn: string | null }) =>
    i18n.language === 'ar' ? s.nameAr : (s.nameEn ?? s.nameAr);
  const needsNote = decision === 'reject' || decision === 'return';

  return (
    <Stack>
      <Anchor component={Link} to={'/approvals' as never} size="sm">
        {t('approvals.detail.back')}
      </Anchor>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{d.title}</Title>
          <Text size="sm" c="dimmed">
            {d.requesterName} · {fmt.dateTime(d.submittedAt)}
          </Text>
        </div>
        <Badge size="lg" color={STATUS_COLORS[d.status]} variant="light">
          {t(`approvals.statuses.${d.status}`)}
        </Badge>
      </Group>

      {d.canAct && (
        <Group>
          <Button color="green" onClick={() => setDecision('approve')}>
            {t('approvals.detail.approve')}
          </Button>
          <Button color="orange" variant="light" onClick={() => setDecision('return')}>
            {t('approvals.detail.return')}
          </Button>
          <Button color="red" variant="light" onClick={() => setDecision('reject')}>
            {t('approvals.detail.reject')}
          </Button>
        </Group>
      )}
      {d.canResubmit && (
        <Card withBorder>
          <Stack>
            <Text size="sm" c="dimmed">
              {t('approvals.detail.resubmitHint')}
            </Text>
            <TextInput
              label={t('approvals.requestTitle')}
              value={title ?? d.title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
            <Group>
              <Button loading={resubmit.isPending} onClick={() => resubmit.mutate()}>
                {t('approvals.detail.resubmit')}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
      {d.canWithdraw && (
        <Group>
          <Button variant="default" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
            {t('approvals.detail.withdraw')}
          </Button>
        </Group>
      )}
      {d.finalNote && (
        <Text size="sm">
          <b>{t('approvals.detail.finalNote')}:</b> {d.finalNote}
        </Text>
      )}

      <Card withBorder>
        <Text fw={600} mb="xs">
          {t('approvals.detail.payload')}
        </Text>
        <Code block dir="ltr">
          {JSON.stringify(d.payload, null, 2)}
        </Code>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          {t('approvals.detail.approvers')}
        </Text>
        <Stack gap="xs">
          {d.steps.map((s) => {
            const rows = d.assignees.filter((a) => a.position === s.position);
            return (
              <Group key={s.id} gap="xs" align="flex-start">
                <Text
                  component="div"
                  size="sm"
                  fw={d.currentPosition === s.position ? 700 : 400}
                  miw={140}
                >
                  {s.position}. {stepName(s)}
                  {d.status === 'pending' && d.currentPosition === s.position && (
                    <Badge ms="xs" size="xs">
                      {t('approvals.detail.current')}
                    </Badge>
                  )}
                </Text>
                <Stack gap={2}>
                  {rows.map((a) => (
                    <Text key={a.id} size="sm" c={a.status === 'cancelled' ? 'dimmed' : undefined}>
                      {a.userName} — {t(`approvals.detail.assigneeStatus.${a.status}`)}
                      {a.delegatedFromUserId &&
                        ` (${t('approvals.detail.delegatedFrom', { name: d.assignees.find((x) => x.userId === a.delegatedFromUserId)?.userName ?? '' })})`}
                    </Text>
                  ))}
                </Stack>
              </Group>
            );
          })}
        </Stack>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          {t('approvals.detail.timeline')}
        </Text>
        <Timeline bulletSize={14} lineWidth={2} active={d.actions.length}>
          {d.actions.map((a) => (
            <Timeline.Item
              key={a.id}
              title={`${t(`approvals.detail.actions.${a.action}`)} — ${a.actorName}`}
            >
              <Text size="xs" c="dimmed">
                {fmt.dateTime(a.createdAt)}
              </Text>
              {a.note && (
                <Text size="sm" dir="auto">
                  {a.note}
                </Text>
              )}
            </Timeline.Item>
          ))}
        </Timeline>
      </Card>

      <Modal
        opened={!!decision}
        onClose={() => setDecision(null)}
        title={decision ? t(`approvals.detail.${decision}`) : ''}
        centered
      >
        <Stack>
          <Textarea
            label={t('approvals.detail.note')}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            required={needsNote}
            error={needsNote && !note.trim() ? t('approvals.detail.noteRequired') : undefined}
            autosize
            minRows={3}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDecision(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={needsNote && !note.trim()}
              loading={act.isPending}
              onClick={() => decision && act.mutate(decision)}
            >
              {decision ? t(`approvals.detail.${decision}`) : ''}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};
