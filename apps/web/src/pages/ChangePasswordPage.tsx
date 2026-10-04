import { Alert, Button, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export const ChangePasswordPage = () => {
  const { t } = useTranslation();
  const { me, endSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError(t('password.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      endSession(); // الخادم أبطل كل الجلسات: يعود المستخدم لشاشة الدخول
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WEAK_PASSWORD') setError(err.message);
      else
        setError(
          t(`password.errors.${err instanceof ApiError ? err.code : 'generic'}`, {
            defaultValue: t('password.errors.generic'),
          }),
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder p="lg" maw={440} component="form" onSubmit={submit}>
      <Stack>
        <Title order={3}>{t('password.title')}</Title>
        {me?.mustChangePassword && <Alert color="yellow">{t('password.forced')}</Alert>}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <PasswordInput
          label={t('password.current')}
          value={current}
          onChange={(e) => setCurrent(e.currentTarget.value)}
          autoComplete="current-password"
          dir="ltr"
          required
        />
        <PasswordInput
          label={t('password.next')}
          value={next}
          onChange={(e) => setNext(e.currentTarget.value)}
          autoComplete="new-password"
          dir="ltr"
          required
        />
        <PasswordInput
          label={t('password.confirm')}
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          autoComplete="new-password"
          dir="ltr"
          required
        />
        <Text size="xs" c="dimmed">
          {t('password.hint')}
        </Text>
        <Button type="submit" loading={busy}>
          {t('common.save')}
        </Button>
      </Stack>
    </Paper>
  );
};
