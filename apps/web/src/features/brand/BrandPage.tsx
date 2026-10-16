import {
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND_SLOTS, type BrandSlot } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type Brand = Record<string, string | number | null | Record<string, boolean>> & {
  version: number;
  slots: Record<BrandSlot, boolean>;
};
const TEXT_FIELDS = [
  'legalNameAr',
  'legalNameEn',
  'addressAr',
  'addressEn',
  'footerAr',
  'footerEn',
  'phone',
  'email',
  'website',
  'taxNo',
  'registrationNo',
] as const;
const MULTILINE = new Set(['addressAr', 'addressEn', 'footerAr', 'footerEn']);
const LTR = new Set(['phone', 'email', 'website', 'taxNo', 'registrationNo']);

const SlotCard = ({
  slot,
  has,
  canEdit,
  stamp,
}: {
  slot: BrandSlot;
  has: boolean;
  canEdit: boolean;
  stamp: number;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    if (has)
      void api
        .blob(`/company-brand/files/${slot}`)
        .then((b) => {
          url = URL.createObjectURL(b);
          if (live) setSrc(url);
        })
        .catch(() => undefined);
    else setSrc(null);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [has, slot, stamp]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/company-brand'] });
  const upload = useMutation({
    mutationFn: async (file: File) =>
      api.upload(`/company-brand/files/${slot}`, file, { method: 'PUT' }),
    onSuccess: refresh,
    onError: (e) => {
      const problems = (e as { details?: { problems?: string[] } }).details?.problems;
      notifications.show({
        color: 'red',
        message: problems?.length ? problems.join(' • ') : errorMessage(e, t),
      });
    },
  });
  const remove = useMutation({
    mutationFn: async () => api.del(`/company-brand/files/${slot}`),
    onSuccess: refresh,
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs" align="center">
        <Text size="sm" fw={600}>
          {t(`brand.slots.${slot}`)}
        </Text>
        <div
          style={{
            height: 70,
            display: 'flex',
            alignItems: 'center',
            padding: 6,
            background: slot.includes('dark') ? '#222' : '#fff',
            borderRadius: 4,
          }}
        >
          {src ? (
            <img
              src={src}
              alt={t(`brand.slots.${slot}`)}
              style={{ maxHeight: 58, maxWidth: 180 }}
            />
          ) : (
            <Text size="xs" c="dimmed">
              {t('brand.noImage')}
            </Text>
          )}
        </div>
        {canEdit && (
          <Group gap="xs">
            <input
              ref={input}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/svg+xml,.svg"
              data-testid={`file-${slot}`}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) upload.mutate(f);
                e.currentTarget.value = '';
              }}
            />
            <Button
              size="compact-xs"
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {t('brand.upload')}
            </Button>
            {has && (
              <Button
                size="compact-xs"
                color="red"
                variant="subtle"
                onClick={() => remove.mutate()}
              >
                {t('brand.remove')}
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Paper>
  );
};

/** الهوية البصرية: شعارات بلغتين ونسخ داكنة وختم، ونصوص الترويسة والتذييل، ومعاينة حيّة بكل لغة. */
export const BrandPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can('org.brand.update');
  const q = useQuery({
    queryKey: ['/company-brand'],
    queryFn: async () => (await api.get<Brand>('/company-brand')).data,
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [html, setHtml] = useState('');
  if (q.data && !loaded) {
    setLoaded(true);
    setForm(Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(q.data?.[k] ?? '')])));
  }
  const [debounced] = useDebouncedValue(form, 400);
  const stamp = q.data?.version ?? 0;
  const preview = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ html: string }>('/company-brand/preview', {
          lang,
          fields: Object.fromEntries(TEXT_FIELDS.map((k) => [k, debounced[k] || null])),
        })
      ).data.html,
    onSuccess: setHtml,
  });
  const { mutate: runPreview } = preview;
  useEffect(() => {
    if (loaded) runPreview();
  }, [loaded, debounced, lang, stamp, runPreview]);
  const save = useMutation({
    mutationFn: async () =>
      api.put('/company-brand', {
        ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k] || null])),
        version: q.data?.version,
      }),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('brand.saved') });
      await qc.invalidateQueries({ queryKey: ['/company-brand'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  if (!q.data) return null;
  return (
    <Stack>
      <Title order={2}>{t('nav.brand')}</Title>
      <Text size="sm" c="dimmed">
        {t('brand.hint')}
      </Text>
      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        {BRAND_SLOTS.map((s) => (
          <SlotCard key={s} slot={s} has={q.data!.slots[s]} canEdit={canEdit} stamp={stamp} />
        ))}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {TEXT_FIELDS.map((k) => {
              const common = {
                key: k,
                label: t(`brand.fields.${k}`),
                value: form[k] ?? '',
                disabled: !canEdit,
                dir: LTR.has(k) ? ('ltr' as const) : undefined,
                onChange: (e: { currentTarget: { value: string } }) =>
                  setForm({ ...form, [k]: e.currentTarget.value }),
              };
              return MULTILINE.has(k) ? (
                <Textarea {...common} rows={3} />
              ) : (
                <TextInput {...common} />
              );
            })}
          </SimpleGrid>
          {canEdit && (
            <Group>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </Group>
          )}
        </Stack>
        <Stack>
          <SegmentedControl
            value={lang}
            onChange={(v) => setLang(v as 'ar' | 'en')}
            data={[
              { value: 'ar', label: t('letters.langAr') },
              { value: 'en', label: t('letters.langEn') },
            ]}
          />
          <iframe
            title={t('brand.preview')}
            sandbox=""
            srcDoc={html}
            style={{ width: '100%', height: 360, border: '1px solid #ccc', background: '#fff' }}
          />
        </Stack>
      </SimpleGrid>
    </Stack>
  );
};
