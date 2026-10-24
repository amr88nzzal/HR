import { Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SETTING_DEFS } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type Opts = {
  figures: boolean;
  otpTelegram: boolean;
  otpEmail: boolean;
  secretField: 'none' | 'birthDate' | 'custom';
  secretCustomKey: string;
  fullName: boolean;
};

/**
 * إعدادات التحقق العام من القسيمة (رابط/QR): طرق التحقق وما يُعرض. تُحفظ كإعداد للشركة.
 * Public payslip verification settings: the methods and what is shown. Saved as a company setting.
 */
export const PayslipVerifySettings = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['/settings/company'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/settings/company')).data,
  });
  const parsed = SETTING_DEFS.payslipVerify.schema.safeParse(q.data?.['payslipVerify']);
  const o: Opts = parsed.success ? parsed.data : SETTING_DEFS.payslipVerify.default;
  const canEdit = can('system.setting.update');
  const save = useMutation({
    mutationFn: async (value: Opts) =>
      api.request('/settings/company/payslipVerify', { method: 'PUT', body: { value } }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('table.saved'), autoClose: 1500 });
      await qc.invalidateQueries({ queryKey: ['/settings/company'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const set = (patch: Partial<Opts>) => save.mutate({ ...o, ...patch });
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={4}>{t('payslipVerify.title')}</Title>
        <Text size="sm" c="dimmed">
          {t('payslipVerify.hint')}
        </Text>
        <Switch
          label={t('payslipVerify.figures')}
          description={t('payslipVerify.figuresHint')}
          disabled={!canEdit}
          checked={o.figures}
          onChange={(e) => set({ figures: e.currentTarget.checked })}
        />
        <Switch
          label={t('payslipVerify.otpTelegram')}
          description={t('payslipVerify.otpHint')}
          disabled={!canEdit}
          checked={o.otpTelegram}
          onChange={(e) => set({ otpTelegram: e.currentTarget.checked })}
        />
        <Switch
          label={t('payslipVerify.otpEmail')}
          disabled={!canEdit}
          checked={o.otpEmail}
          onChange={(e) => set({ otpEmail: e.currentTarget.checked })}
        />
        <Select
          label={t('payslipVerify.secretField')}
          description={t('payslipVerify.secretHint')}
          disabled={!canEdit}
          allowDeselect={false}
          data={(['none', 'birthDate', 'custom'] as const).map((v) => ({
            value: v,
            label: t(`payslipVerify.secret.${v}`),
          }))}
          value={o.secretField}
          onChange={(v) => v && set({ secretField: v as Opts['secretField'] })}
        />
        {o.secretField === 'custom' && (
          <TextInput
            dir="ltr"
            label={t('payslipVerify.customKey')}
            description={t('payslipVerify.customKeyHint')}
            disabled={!canEdit}
            defaultValue={o.secretCustomKey}
            onBlur={(e) =>
              e.currentTarget.value !== o.secretCustomKey &&
              set({ secretCustomKey: e.currentTarget.value })
            }
          />
        )}
        <Switch
          label={t('payslipVerify.fullName')}
          description={t('payslipVerify.fullNameHint')}
          disabled={!canEdit}
          checked={o.fullName}
          onChange={(e) => set({ fullName: e.currentTarget.checked })}
        />
      </Stack>
    </Paper>
  );
};
