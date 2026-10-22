import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type Gl = {
  salariesPayable: string | null;
  loansReceivable: string | null;
  defaultExpense: string | null;
};
const KEYS = ['salariesPayable', 'loansReceivable', 'defaultExpense'] as const;

/** حسابات الشركة العامة لقيد الرواتب (رمز حساب نصي لكل بند). */
export const GlSettingsPanel = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('payroll.accounting.manage');
  const q = useQuery({
    queryKey: ['/payroll', 'gl-settings'],
    queryFn: async () => (await api.get<Gl>('/payroll/gl-settings')).data,
  });
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setV(Object.fromEntries(KEYS.map((k) => [k, q.data?.[k] ?? ''])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: async () =>
      api.put('/payroll/gl-settings', Object.fromEntries(KEYS.map((k) => [k, v[k] || null]))),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('payroll.gl.saved') });
      await qc.invalidateQueries({ queryKey: ['/payroll', 'gl-settings'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Stack maw={560}>
      <Text fw={600}>{t('payroll.gl.settingsTitle')}</Text>
      <Text size="sm" c="dimmed">
        {t('payroll.gl.settingsHint')}
      </Text>
      {KEYS.map((k) => (
        <TextInput
          key={k}
          label={t(`payroll.gl.${k}`)}
          value={v[k] ?? ''}
          maxLength={40}
          dir="ltr"
          disabled={!manage}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setV((p) => ({ ...p, [k]: value }));
          }}
        />
      ))}
      {manage && (
        <Group>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('payroll.gl.save')}
          </Button>
        </Group>
      )}
    </Stack>
  );
};
