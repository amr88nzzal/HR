import { Alert, Button, Center, Paper, PasswordInput, Stack, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

/** صفحة عامة: الموظف يعيّن كلمة مروره من رابط الدعوة (لمرة واحدة) ثم يسجّل الدخول. */
export const AcceptInvitePage = () => {
  const { t } = useTranslation();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (password !== confirm) return setError(t('account.accept.mismatch'));
    setBusy(true);
    try {
      await api.post('/auth/accept-invite', { token, password });
      setDone(true);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setError(
        t(`account.accept.errors.${code}`, {
          defaultValue: (e as Error).message || t('account.accept.errors.generic'),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="xl" maw={440} w="100%" radius="md">
        <Stack>
          <Title order={3}>{t('account.accept.title')}</Title>
          {done ? (
            <>
              <Alert color="teal">{t('account.accept.done')}</Alert>
              <Button component={Link} to="/login">
                {t('account.accept.login')}
              </Button>
            </>
          ) : (
            <>
              {!token && <Alert color="red">{t('account.accept.errors.INVALID_INVITE')}</Alert>}
              <PasswordInput
                label={t('account.accept.password')}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <PasswordInput
                label={t('account.accept.confirm')}
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
              />
              {error && <Alert color="red">{error}</Alert>}
              <Button loading={busy} disabled={!token || !password} onClick={() => void submit()}>
                {t('account.accept.submit')}
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
};
