import { Card, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../lib/errors';

type Values = Record<string, string | number>;
type Def = {
  key: string;
  type: 'select' | 'text';
  options?: (string | number)[];
  numeric?: boolean;
};

const DEFS: Def[] = [
  { key: 'locale', type: 'select', options: ['ar', 'en'] },
  { key: 'timezone', type: 'text' },
  { key: 'calendar', type: 'select', options: ['gregorian', 'hijri'] },
  { key: 'dateFormat', type: 'select', options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] },
  { key: 'timeFormat', type: 'select', options: ['12h', '24h'] },
  { key: 'weekStart', type: 'select', options: [0, 1, 2, 3, 4, 5, 6], numeric: true },
  { key: 'numberDigits', type: 'select', options: ['western', 'arabic'] },
  { key: 'decimalSeparator', type: 'select', options: ['.', ','] },
  { key: 'thousandsSeparator', type: 'select', options: [',', '.', ' ', ''] },
];

/** معاينة حيّة بالإعدادات الفعلية عبر Intl (التقويم الهجري والأرقام العربية بدعم المتصفح). */
const preview = (v: Values): string => {
  try {
    const ext = [
      v['calendar'] === 'hijri' ? 'ca-islamic-umalqura' : 'ca-gregory',
      v['numberDigits'] === 'arabic' ? 'nu-arab' : 'nu-latn',
    ].join('-');
    const loc = `${String(v['locale'] ?? 'ar')}-u-${ext}`;
    const d = new Intl.DateTimeFormat(loc, {
      dateStyle: 'long',
      timeZone: String(v['timezone'] || 'UTC'),
      hour12: v['timeFormat'] === '12h',
      timeStyle: 'short',
    }).format(new Date());
    const n = new Intl.NumberFormat(loc)
      .format(1234567.89)
      .replace(/[,٬]/g, String(v['thousandsSeparator'] ?? ',') || '')
      .replace(/[.٫]/g, String(v['decimalSeparator'] ?? '.'));
    return `${d}  ·  ${n}`;
  } catch {
    return '—';
  }
};

const SettingsForm = ({
  scope,
  values,
  canEdit,
  onSaved,
}: {
  scope: 'company' | 'me';
  values: Values;
  canEdit: boolean;
  onSaved: () => void;
}) => {
  const { t } = useTranslation();
  const [local, setLocal] = useState<Values>({});
  const current: Values = { ...values, ...local };

  const change = async (def: Def, raw: string | null) => {
    if (raw === null) return;
    const value = def.numeric ? Number(raw) : raw;
    setLocal((s) => ({ ...s, [def.key]: value }));
    try {
      await api.request(`/settings/${scope}/${def.key}`, { method: 'PUT', body: { value } });
      notifications.show({ color: 'teal', message: t('table.saved'), autoClose: 1500 });
      onSaved();
    } catch (err) {
      setLocal((s) => {
        const { [def.key]: _drop, ...rest } = s;
        void _drop;
        return rest;
      });
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    }
  };

  const label = (def: Def, o: string | number) =>
    def.key === 'weekStart'
      ? ((t('settingsPage.weekdays', { returnObjects: true }) as string[])[Number(o)] ?? String(o))
      : def.key === 'locale' ||
          def.key === 'calendar' ||
          def.key === 'timeFormat' ||
          def.key === 'numberDigits'
        ? t(`settingsPage.values.${o}`)
        : o === ''
          ? t('settingsPage.values.none')
          : o === ' '
            ? '␣'
            : String(o);

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {DEFS.map((def) =>
          def.type === 'text' ? (
            <TextInput
              key={def.key}
              label={t(`settingsPage.keys.${def.key}`)}
              dir="ltr"
              disabled={!canEdit}
              value={String(current[def.key] ?? '')}
              onChange={(e) => setLocal((s) => ({ ...s, [def.key]: e.currentTarget.value }))}
              onBlur={() =>
                local[def.key] !== undefined &&
                local[def.key] !== values[def.key] &&
                void change(def, String(local[def.key]))
              }
            />
          ) : (
            <Select
              key={def.key}
              label={t(`settingsPage.keys.${def.key}`)}
              disabled={!canEdit}
              allowDeselect={false}
              data={(def.options ?? []).map((o) => ({ value: String(o), label: label(def, o) }))}
              value={String(current[def.key] ?? '')}
              onChange={(v) => void change(def, v)}
            />
          ),
        )}
      </SimpleGrid>
      <Card withBorder>
        <Text size="sm" c="dimmed">
          {t('settingsPage.preview')}
        </Text>
        <Text fw={500}>{preview(current)}</Text>
      </Card>
    </Stack>
  );
};

export const SettingsPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const company = useQuery({
    queryKey: ['/settings', 'company'],
    enabled: can('system.setting.read'),
    queryFn: async () => (await api.get<Values>('/settings/company')).data,
  });
  const effective = useQuery({
    queryKey: ['/settings', 'effective'],
    queryFn: async () => (await api.get<Values>('/settings/effective')).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['/settings'] });

  return (
    <Stack>
      <Title order={2}>{t('settingsPage.title')}</Title>
      <Tabs defaultValue={can('system.setting.read') ? 'company' : 'me'}>
        <Tabs.List>
          {can('system.setting.read') && (
            <Tabs.Tab value="company">{t('settingsPage.company')}</Tabs.Tab>
          )}
          <Tabs.Tab value="me">{t('settingsPage.personal')}</Tabs.Tab>
        </Tabs.List>
        {can('system.setting.read') && (
          <Tabs.Panel value="company" pt="md">
            {company.data && (
              <SettingsForm
                scope="company"
                values={company.data}
                canEdit={can('system.setting.update')}
                onSaved={refresh}
              />
            )}
          </Tabs.Panel>
        )}
        <Tabs.Panel value="me" pt="md">
          <Text size="sm" c="dimmed" mb="sm">
            {t('settingsPage.personalHint')}
          </Text>
          {effective.data && (
            <SettingsForm scope="me" values={effective.data} canEdit onSaved={refresh} />
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
