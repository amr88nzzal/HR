import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Code,
  CopyButton,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { COMPANY_HOST_PATTERN } from '../../lib/companyHost';

type Company = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  timezone: string;
  defaultLocale: 'ar' | 'en';
  status: 'active' | 'suspended';
  version: number;
  userCount: number;
  employeeCount: number;
};

const TOKEN_KEY = 'hr.platformToken';
const readToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (v: string | null) => {
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* التخزين غير متاح / storage unavailable */
  }
};

class PlatformError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// طلبات المنصة منفصلة عن عميل المستخدمين: توكن مستقل ولا تجديد تلقائي
// Platform calls are separate from the user API client: own token, no auto-refresh
const call = async <T,>(
  path: string,
  token: string | null,
  init: { method?: string; body?: unknown } = {},
): Promise<T> => {
  const res = await fetch(`/api/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!res.ok)
    throw new PlatformError(json.error?.code ?? 'generic', res.status, json.error?.message ?? '');
  return json.data as T;
};

const loginUrl = (slug: string): string =>
  `https://${COMPANY_HOST_PATTERN.replace('{company}', slug)}/login`;

const TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Amman',
  'Africa/Cairo',
  'Europe/Berlin',
  'Europe/Istanbul',
  'UTC',
];

type FormState = {
  slug: string;
  nameAr: string;
  nameEn: string;
  timezone: string;
  defaultLocale: 'ar' | 'en';
  adminEmail: string;
  adminName: string;
};
const emptyForm: FormState = {
  slug: '',
  nameAr: '',
  nameEn: '',
  timezone: 'Asia/Riyadh',
  defaultLocale: 'ar',
  adminEmail: '',
  adminName: '',
};

export const PlatformPage = () => {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(readToken);
  const [key, setKey] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [modal, setModal] = useState<'create' | Company | null>(null);
  const [result, setResult] = useState<{ email: string; password: string; slug: string } | null>(
    null,
  );

  const fail = useCallback(
    (e: unknown) => {
      const code = e instanceof PlatformError ? e.code : 'generic';
      if (e instanceof PlatformError && e.status === 401 && code === 'UNAUTHORIZED') {
        writeToken(null);
        setToken(null);
      }
      notifications.show({
        color: 'red',
        message: t(`platform.errors.${code}`, { defaultValue: t('platform.errors.generic') }),
      });
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setCompanies(await call<Company[]>('/companies', token));
    } catch (e) {
      fail(e);
    }
  }, [token, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await call<{ token: string }>('/session', null, {
        method: 'POST',
        body: { key },
      });
      writeToken(r.token);
      setToken(r.token);
      setKey('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm);
    setModal('create');
  };
  const openEdit = (c: Company) => {
    setForm({
      ...emptyForm,
      slug: c.slug,
      nameAr: c.nameAr,
      nameEn: c.nameEn ?? '',
      timezone: c.timezone,
      defaultLocale: c.defaultLocale,
    });
    setModal(c);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal === 'create') {
        const r = await call<{ admin: { email: string; temporaryPassword: string } }>(
          '/companies',
          token,
          {
            method: 'POST',
            body: {
              slug: form.slug,
              nameAr: form.nameAr,
              nameEn: form.nameEn || null,
              timezone: form.timezone,
              defaultLocale: form.defaultLocale,
              admin: { email: form.adminEmail, name: form.adminName },
            },
          },
        );
        setResult({
          email: r.admin.email,
          password: r.admin.temporaryPassword,
          slug: form.slug.trim().toLowerCase(),
        });
      } else if (modal) {
        await call(`/companies/${modal.id}`, token, {
          method: 'PATCH',
          body: {
            nameAr: form.nameAr,
            nameEn: form.nameEn || null,
            timezone: form.timezone,
            defaultLocale: form.defaultLocale,
            status: modal.status,
            version: modal.version,
          },
        });
      }
      setModal(null);
      await load();
    } catch (err) {
      fail(err);
      if (err instanceof PlatformError && err.code === 'VERSION_CONFLICT') {
        setModal(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: Company) => {
    const next = c.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(t('platform.confirmSuspend'))) return;
    try {
      await call(`/companies/${c.id}`, token, {
        method: 'PATCH',
        body: {
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          timezone: c.timezone,
          defaultLocale: c.defaultLocale,
          status: next,
          version: c.version,
        },
      });
    } catch (e) {
      fail(e);
    }
    await load();
  };

  if (!token)
    return (
      <Center mih="100vh" p="md">
        <Paper withBorder shadow="sm" p="xl" w={400} maw="100%" component="form" onSubmit={signIn}>
          <Stack>
            <Title order={3}>{t('platform.title')}</Title>
            <Text size="sm" c="dimmed">
              {t('platform.subtitle')}
            </Text>
            <PasswordInput
              label={t('platform.key')}
              description={t('platform.keyHint')}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              dir="ltr"
              autoComplete="off"
              required
            />
            <Button type="submit" loading={busy}>
              {t('platform.signIn')}
            </Button>
          </Stack>
        </Paper>
      </Center>
    );

  const editing = modal && modal !== 'create' ? modal : null;
  const set = (k: keyof FormState) => (e: { currentTarget: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.currentTarget.value }));

  return (
    <Stack p="md" maw={1100} mx="auto">
      <Group justify="space-between">
        <div>
          <Title order={3}>{t('platform.title')}</Title>
          <Text size="sm" c="dimmed">
            {t('platform.subtitle')}
          </Text>
        </div>
        <Group>
          <Button onClick={openCreate}>{t('platform.newCompany')}</Button>
          <Button
            variant="default"
            onClick={() => {
              writeToken(null);
              setToken(null);
            }}
          >
            {t('platform.signOut')}
          </Button>
        </Group>
      </Group>

      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('platform.slug')}</Table.Th>
                <Table.Th>{t('platform.nameAr')}</Table.Th>
                <Table.Th>{t('platform.status')}</Table.Th>
                <Table.Th>{t('platform.users')}</Table.Th>
                <Table.Th>{t('platform.employees')}</Table.Th>
                <Table.Th>{t('platform.loginLink')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {companies.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Code>{c.slug}</Code>
                  </Table.Td>
                  <Table.Td>{c.nameAr}</Table.Td>
                  <Table.Td>
                    <Badge color={c.status === 'active' ? 'teal' : 'red'} variant="light">
                      {t(`platform.${c.status}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{c.userCount}</Table.Td>
                  <Table.Td>{c.employeeCount}</Table.Td>
                  <Table.Td dir="ltr">
                    <Text size="xs" component="a" href={loginUrl(c.slug)} target="_blank">
                      {loginUrl(c.slug).replace('https://', '')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button size="xs" variant="default" onClick={() => openEdit(c)}>
                        {t('platform.edit')}
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color={c.status === 'active' ? 'red' : 'teal'}
                        onClick={() => void toggle(c)}
                      >
                        {c.status === 'active' ? t('platform.suspend') : t('platform.activate')}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {companies.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center">
                      {t('platform.empty')}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal
        opened={!!modal}
        onClose={() => setModal(null)}
        title={editing ? t('platform.edit') : t('platform.newCompany')}
      >
        <form onSubmit={submit}>
          <Stack>
            <TextInput
              label={t('platform.slug')}
              description={editing ? undefined : t('platform.slugHint')}
              value={form.slug}
              onChange={set('slug')}
              disabled={!!editing}
              dir="ltr"
              required
            />
            <TextInput
              label={t('platform.nameAr')}
              value={form.nameAr}
              onChange={set('nameAr')}
              required
            />
            <TextInput label={t('platform.nameEn')} value={form.nameEn} onChange={set('nameEn')} />
            <Select
              label={t('platform.timezone')}
              data={TIMEZONES}
              value={form.timezone}
              onChange={(v) => v && setForm((f) => ({ ...f, timezone: v }))}
              searchable
              allowDeselect={false}
            />
            <Select
              label={t('platform.locale')}
              data={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' },
              ]}
              value={form.defaultLocale}
              onChange={(v) => v && setForm((f) => ({ ...f, defaultLocale: v as 'ar' | 'en' }))}
              allowDeselect={false}
            />
            {!editing && (
              <>
                <TextInput
                  label={t('platform.adminName')}
                  value={form.adminName}
                  onChange={set('adminName')}
                  required
                />
                <TextInput
                  label={t('platform.adminEmail')}
                  type="email"
                  dir="ltr"
                  value={form.adminEmail}
                  onChange={set('adminEmail')}
                  required
                />
              </>
            )}
            <Button type="submit" loading={busy}>
              {editing ? t('common.save') : t('platform.create')}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={!!result}
        onClose={() => setResult(null)}
        title={t('platform.created')}
        closeOnClickOutside={false}
      >
        {result && (
          <Stack>
            <Alert color="yellow">{t('platform.tempHint')}</Alert>
            <Text size="sm" dir="ltr">
              {loginUrl(result.slug)}
            </Text>
            <Text size="sm" dir="ltr">
              {result.email}
            </Text>
            <Group justify="space-between" wrap="nowrap">
              <Code fz="md" dir="ltr" aria-label={t('platform.tempPassword')}>
                {result.password}
              </Code>
              <CopyButton value={result.password}>
                {({ copied, copy }) => (
                  <ActionIcon variant="default" w="auto" px="sm" onClick={copy}>
                    {copied ? t('platform.copied') : t('platform.copy')}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
};
