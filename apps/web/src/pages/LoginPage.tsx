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
import { BASE_DOMAIN, companyFromHost } from '../lib/companyHost';

const COMPANY_KEY = 'hr.loginCompany';

export const LoginPage = () => {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  // رمز الشركة: من الرابط أولاً ثم آخر قيمة محفوظة في المتصفح؛ فارغ = الشركة الافتراضية
  // Company code: from the URL first, then the last value saved in the browser; empty = default company
  // النطاق الفرعي له الأولوية ويُثبَّت الحقل / the subdomain wins and locks the field
  const hostCompany = companyFromHost(window.location.hostname, BASE_DOMAIN);
  const [companyInput, setCompanyInput] = useState(() => {
    if (hostCompany) return hostCompany;
    const fromUrl = new URLSearchParams(window.location.search).get('company');
    if (fromUrl) return fromUrl;
    try {
      return localStorage.getItem(COMPANY_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const company = companyInput.trim().toLowerCase() || undefined;
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
      try {
        if (company) localStorage.setItem(COMPANY_KEY, company);
        else localStorage.removeItem(COMPANY_KEY);
      } catch {
        /* التخزين غير متاح / storage unavailable */
      }
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
          <img
            src={`/api/v1/public/brand/${encodeURIComponent(company ?? 'default')}/logo?lang=${i18n.language === 'en' ? 'en' : 'ar'}`}
            alt=""
            style={{ maxHeight: 60, maxWidth: 220, alignSelf: 'center' }}
            onError={(e) => {
              // لا شعار للشركة: نعرض علامة المشروع بدلاً منه / no company logo: show the project mark
              const img = e.currentTarget;
              if (img.dataset['fallback']) return;
              img.dataset['fallback'] = '1';
              img.src = '/mark.svg';
              img.style.maxHeight = '64px';
            }}
          />
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
            label={t('login.company')}
            description={t('login.companyHint')}
            value={companyInput}
            onChange={(e) => setCompanyInput(e.currentTarget.value)}
            autoComplete="organization"
            readOnly={!!hostCompany}
            dir="ltr"
          />
          <TextInput
            label={t('login.identifier')}
            value={identifier}
            onChange={(e) => setIdentifier(e.currentTarget.value)}
            autoComplete="username"
            dir="ltr"
            required
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
