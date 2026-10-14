import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';

/** جلب قائمة مورد الرواتب وحفظه (POST/PATCH بالإصدار) وحذفه مع عرض مشكلات الصيغة إن وُجدت. */
export const useCrud = <T extends { id: string; version?: number }>(
  base: string,
  enabled = true,
) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['/payroll', base];
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<T[]>(`/payroll/${base}`)).data,
    enabled,
  });
  const fail = (e: unknown) => {
    const problems = (e as { details?: { problems?: string[] } }).details?.problems;
    notifications.show({
      color: 'red',
      message: problems?.length ? problems.join(' • ') : errorMessage(e, t),
    });
  };
  const done = async () => {
    notifications.show({ color: 'teal', message: t('payroll.saved') });
    await qc.invalidateQueries({ queryKey: ['/payroll'] });
  };
  const save = useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: unknown }) =>
      id ? api.patch(`/payroll/${base}/${id}`, body) : api.post(`/payroll/${base}`, body),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`/payroll/${base}/${id}`),
    onSuccess: done,
    onError: fail,
  });
  return { rows: list.data ?? [], list, save, remove };
};

/** أول رسالة خطأ من مخطط zod (للتحقق قبل الإرسال). */
export const firstIssue = (schema: z.ZodType, value: unknown): string | null => {
  const r = schema.safeParse(value);
  if (r.success) return null;
  const i = r.error.issues[0];
  return i ? `${i.path.join('.') ? `${i.path.join('.')}: ` : ''}${i.message}` : 'invalid';
};

export const FormModal = ({
  opened,
  title,
  onClose,
  onSubmit,
  submitting,
  error,
  children,
}: {
  opened: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg">
      <Stack>
        {children}
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={submitting} onClick={onSubmit}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
