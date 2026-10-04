import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export const LoginPage = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const company = new URLSearchParams(window.location.search).get('company') ?? undefined;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ identifier: identifier.trim(), password, company });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'generic';
      const key = `login.errors.${code}`;
      setError(t(key, { defaultValue: t('login.errors.generic') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={400} maw="100%" component="form" onSubmit={submit}>
        <Stack>
          <Title order={3}>{t('app.name')}</Title>
          <Title order={5} c="dimmed" fw={500}>
            {t('login.title')}
          </Title>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <TextInput
            label={t('login.identifier')}
            value={identifier}
            onChange={(e) => setIdentifier(e.currentTarget.value)}
            autoComplete="username"
            dir="ltr"
            required
            autoFocus
          />
          <PasswordInput
            label={t('login.password')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            dir="ltr"
            required
          />
          <Button type="submit" loading={busy}>
            {t('login.submit')}
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
};
