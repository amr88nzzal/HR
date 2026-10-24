import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  ColorInput,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useElementSize } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PAYSLIP_HEADER_FIELDS,
  PAYSLIP_PRESETS,
  PAYSLIP_SECTIONS,
  type PayslipConfig,
  type PayslipSection,
} from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { PayslipVerifySettings } from './PayslipVerifySettings';

type Template = {
  id: string;
  nameAr: string;
  nameEn: string | null;
  config: PayslipConfig;
  isDefault: boolean;
  version: number;
};
type Draft = {
  id?: string;
  version?: number;
  nameAr: string;
  nameEn: string;
  config: PayslipConfig;
};

const PRESET_KEYS = ['stacked', 'side_by_side', 'detailed'] as const;

/** ترتيب الأقسام الكامل: المفعَّلة بترتيبها أولاً ثم غير المفعَّلة / full order: enabled first, then the rest */
const fullOrder = (enabled: PayslipSection[]): PayslipSection[] => [
  ...enabled,
  ...PAYSLIP_SECTIONS.filter((s) => !enabled.includes(s)),
];

const PAGE_W = 794; // عرض A4 بالبكسل (96dpi) / A4 width in px
const PAGE_H = 1123;

/** معاينة بعرض A4 الحقيقي مصغّرة لتناسب العمود، فتطابق الطباعة / A4-width preview scaled to fit, so it matches print */
const ScaledPreview = ({ html, title }: { html: string; title: string }) => {
  const { ref, width } = useElementSize();
  const scale = width ? Math.min(1, width / PAGE_W) : 1;
  return (
    <div
      ref={ref}
      dir="ltr"
      style={{
        width: '100%',
        height: PAGE_H * scale,
        overflow: 'hidden',
        border: '1px solid #ccc',
        background: '#fff',
      }}
    >
      <iframe
        title={title}
        sandbox=""
        srcDoc={html}
        style={{
          width: PAGE_W,
          height: PAGE_H,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
};

/** تصميم قسيمة الراتب: قوالب منظَّمة بمعاينة حيّة (انظر docs/guide/articles/payslip-template.md). */
export const PayslipDesignPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('payroll.payslip_template.manage');
  const list = useQuery({
    queryKey: ['/payroll/payslip-templates'],
    queryFn: async () => (await api.get<Template[]>('/payroll/payslip-templates')).data,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [html, setHtml] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['/payroll/payslip-templates'] });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });

  const [debounced] = useDebouncedValue(draft?.config, 400);
  const { mutate: runPreview } = useMutation({
    mutationFn: async (config: PayslipConfig) =>
      (await api.post<{ html: string }>('/payroll/payslip-templates/preview', { config, lang }))
        .data.html,
    onSuccess: setHtml,
  });
  useEffect(() => {
    if (debounced) runPreview(debounced);
  }, [debounced, lang, runPreview]);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { nameAr: d.nameAr, nameEn: d.nameEn || null, config: d.config };
      return d.id
        ? (
            await api.put<Template>(`/payroll/payslip-templates/${d.id}`, {
              ...body,
              version: d.version,
            })
          ).data
        : (await api.post<Template>('/payroll/payslip-templates', body)).data;
    },
    onSuccess: async (saved) => {
      notifications.show({ color: 'teal', message: t('payslipDesign.saved') });
      setDraft((d) => (d ? { ...d, id: saved.id, version: saved.version } : d));
      await refresh();
    },
    onError: fail,
  });
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: fail,
  });

  const open = (tp: Template) =>
    setDraft({
      id: tp.id,
      version: tp.version,
      nameAr: tp.nameAr,
      nameEn: tp.nameEn ?? '',
      config: tp.config,
    });
  const create = (preset: (typeof PRESET_KEYS)[number]) =>
    setDraft({
      nameAr: t(`payslipDesign.presets.${preset}`),
      nameEn: '',
      config: structuredClone(PAYSLIP_PRESETS[preset]),
    });
  const set = <K extends keyof PayslipConfig>(k: K, v: PayslipConfig[K]) =>
    setDraft((d) => (d ? { ...d, config: { ...d.config, [k]: v } } : d));
  const cfg = draft?.config;

  const order = cfg ? fullOrder(cfg.sections) : [];
  const toggleSection = (s: PayslipSection, on: boolean) => {
    if (!cfg) return;
    const next = on ? [...cfg.sections, s] : cfg.sections.filter((x) => x !== s);
    set('sections', next);
  };
  const move = (s: PayslipSection, dir: -1 | 1) => {
    if (!cfg) return;
    const i = cfg.sections.indexOf(s);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.sections.length) return;
    const next = [...cfg.sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set('sections', next);
  };

  const templates = list.data ?? [];
  const hasDefault = templates.some((x) => x.isDefault);

  return (
    <Stack>
      <Title order={2}>{t('payslipDesign.title')}</Title>
      <Text size="sm" c="dimmed">
        {t('payslipDesign.hint')}
      </Text>
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Button
          variant="default"
          size="xs"
          disabled
          rightSection={!hasDefault ? <Badge size="xs">{t('payslipDesign.active')}</Badge> : null}
        >
          {t('payslipDesign.builtin')}
        </Button>
        {templates.map((tp) => (
          <Button
            key={tp.id}
            size="xs"
            variant={draft?.id === tp.id ? 'filled' : 'light'}
            onClick={() => open(tp)}
            rightSection={
              tp.isDefault ? (
                <Badge size="xs" color="yellow">
                  {t('payslipDesign.active')}
                </Badge>
              ) : null
            }
          >
            {tp.nameAr}
          </Button>
        ))}
        {canManage && (
          <Select
            size="xs"
            w={240}
            placeholder="…"
            aria-label={t('payslipDesign.newFrom')}
            label={t('payslipDesign.newFrom')}
            data={PRESET_KEYS.map((k) => ({ value: k, label: t(`payslipDesign.presets.${k}`) }))}
            value={null}
            onChange={(v) => v && create(v as (typeof PRESET_KEYS)[number])}
          />
        )}
        {canManage && hasDefault && (
          <Button
            variant="default"
            size="xs"
            onClick={() => act.mutate(() => api.post('/payroll/payslip-templates/use-builtin'))}
          >
            {t('payslipDesign.useBuiltin')}
          </Button>
        )}
      </Group>
      <SimpleGrid cols={{ base: 1, md: 12 }}>
        <Paper withBorder p="md" style={{ gridColumn: 'span 5' }}>
          {draft && cfg ? (
            <Stack gap="sm">
              <SimpleGrid cols={2}>
                <TextInput
                  label={t('payslipDesign.nameAr')}
                  value={draft.nameAr}
                  onChange={(e) => setDraft({ ...draft, nameAr: e.currentTarget.value })}
                  disabled={!canManage}
                />
                <TextInput
                  label={t('payslipDesign.nameEn')}
                  value={draft.nameEn}
                  onChange={(e) => setDraft({ ...draft, nameEn: e.currentTarget.value })}
                  disabled={!canManage}
                />
              </SimpleGrid>
              <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0 }}>
                <Stack gap="sm">
                  <SegmentedControl
                    value={cfg.layout}
                    onChange={(v) => set('layout', v as PayslipConfig['layout'])}
                    data={(['stacked', 'side_by_side'] as const).map((k) => ({
                      value: k,
                      label: t(`payslipDesign.layouts.${k}`),
                    }))}
                  />
                  <Select
                    label={t('payslipDesign.language')}
                    value={cfg.language}
                    onChange={(v) => v && set('language', v as PayslipConfig['language'])}
                    data={(['company', 'ar', 'en'] as const).map((k) => ({
                      value: k,
                      label: t(`payslipDesign.languages.${k}`),
                    }))}
                    allowDeselect={false}
                  />
                  <SimpleGrid cols={2}>
                    <TextInput
                      label={t('payslipDesign.titleAr')}
                      value={cfg.title.ar}
                      onChange={(e) => set('title', { ...cfg.title, ar: e.currentTarget.value })}
                    />
                    <TextInput
                      label={t('payslipDesign.titleEn')}
                      value={cfg.title.en}
                      onChange={(e) => set('title', { ...cfg.title, en: e.currentTarget.value })}
                    />
                  </SimpleGrid>
                  <MultiSelect
                    label={t('payslipDesign.headerFields')}
                    value={cfg.headerFields}
                    onChange={(v) =>
                      v.length && set('headerFields', v as PayslipConfig['headerFields'])
                    }
                    data={PAYSLIP_HEADER_FIELDS.map((k) => ({
                      value: k,
                      label: t(`payslipDesign.fields.${k}`),
                    }))}
                  />
                  <SegmentedControl
                    value={String(cfg.headerColumns)}
                    onChange={(v) => set('headerColumns', Number(v) as 1 | 2)}
                    data={['1', '2']}
                    aria-label={t('payslipDesign.headerColumns')}
                  />
                  <Text size="sm" fw={500}>
                    {t('payslipDesign.sections')}
                  </Text>
                  {order.map((s) => {
                    const on = cfg.sections.includes(s);
                    return (
                      <Group key={s} justify="space-between" wrap="nowrap">
                        <Checkbox
                          label={t(`payslipDesign.sectionNames.${s}`)}
                          checked={on}
                          disabled={s === 'lines'}
                          onChange={(e) => toggleSection(s, e.currentTarget.checked)}
                        />
                        {on && (
                          <Group gap={4} wrap="nowrap">
                            <ActionIcon
                              variant="subtle"
                              aria-label={t('payslipDesign.up')}
                              onClick={() => move(s, -1)}
                            >
                              ↑
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              aria-label={t('payslipDesign.down')}
                              onClick={() => move(s, 1)}
                            >
                              ↓
                            </ActionIcon>
                          </Group>
                        )}
                      </Group>
                    );
                  })}
                  <Switch
                    label={t('payslipDesign.hideZeroLines')}
                    checked={cfg.hideZeroLines}
                    onChange={(e) => set('hideZeroLines', e.currentTarget.checked)}
                  />
                  <Switch
                    label={t('payslipDesign.showLineCodes')}
                    checked={cfg.showLineCodes}
                    onChange={(e) => set('showLineCodes', e.currentTarget.checked)}
                  />
                  <Switch
                    label={t('payslipDesign.showPrintedAt')}
                    checked={cfg.showPrintedAt}
                    onChange={(e) => set('showPrintedAt', e.currentTarget.checked)}
                  />
                  <SimpleGrid cols={3}>
                    <ColorInput
                      label={t('payslipDesign.accent')}
                      value={cfg.accent}
                      format="hex"
                      onChange={(v) => /^#[0-9a-fA-F]{6}$/.test(v) && set('accent', v)}
                    />
                    <NumberInput
                      label={t('payslipDesign.fontSize')}
                      value={cfg.fontSize}
                      min={8}
                      max={13}
                      onChange={(v) => typeof v === 'number' && set('fontSize', v)}
                    />
                    <Select
                      label={t('payslipDesign.borders')}
                      value={cfg.borders}
                      onChange={(v) => v && set('borders', v as PayslipConfig['borders'])}
                      data={[
                        { value: 'grid', label: t('payslipDesign.bordersGrid') },
                        { value: 'lines', label: t('payslipDesign.bordersLines') },
                      ]}
                      allowDeselect={false}
                    />
                  </SimpleGrid>
                  <SimpleGrid cols={2}>
                    <Textarea
                      label={t('payslipDesign.notesAr')}
                      rows={2}
                      value={cfg.notes.ar}
                      onChange={(e) => set('notes', { ...cfg.notes, ar: e.currentTarget.value })}
                    />
                    <Textarea
                      label={t('payslipDesign.notesEn')}
                      rows={2}
                      value={cfg.notes.en}
                      onChange={(e) => set('notes', { ...cfg.notes, en: e.currentTarget.value })}
                    />
                    <TextInput
                      label={t('payslipDesign.footerAr')}
                      value={cfg.footer.ar}
                      onChange={(e) => set('footer', { ...cfg.footer, ar: e.currentTarget.value })}
                    />
                    <TextInput
                      label={t('payslipDesign.footerEn')}
                      value={cfg.footer.en}
                      onChange={(e) => set('footer', { ...cfg.footer, en: e.currentTarget.value })}
                    />
                  </SimpleGrid>
                </Stack>
              </fieldset>
              {canManage && (
                <Group>
                  <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
                    {t('common.save')}
                  </Button>
                  {draft.id && (
                    <>
                      <Button
                        variant="light"
                        onClick={() =>
                          act.mutate(() =>
                            api.post(`/payroll/payslip-templates/${draft.id}/default`),
                          )
                        }
                      >
                        {t('payslipDesign.setDefault')}
                      </Button>
                      <Button
                        color="red"
                        variant="subtle"
                        onClick={() => {
                          if (!window.confirm(t('payslipDesign.confirmDelete'))) return;
                          act.mutate(async () => {
                            await api.del(`/payroll/payslip-templates/${draft.id}`);
                            setDraft(null);
                            notifications.show({
                              color: 'teal',
                              message: t('payslipDesign.deleted'),
                            });
                          });
                        }}
                      >
                        {t('payslipDesign.delete')}
                      </Button>
                    </>
                  )}
                </Group>
              )}
            </Stack>
          ) : (
            <Text c="dimmed">{t('payslipDesign.newFrom')}</Text>
          )}
        </Paper>

        <Stack style={{ gridColumn: 'span 7' }}>
          <SegmentedControl
            value={lang}
            onChange={(v) => setLang(v as 'ar' | 'en')}
            data={[
              { value: 'ar', label: t('letters.langAr') },
              { value: 'en', label: t('letters.langEn') },
            ]}
          />
          <ScaledPreview html={html} title={t('payslipDesign.preview')} />
        </Stack>
      </SimpleGrid>
      {can('system.setting.read') && <PayslipVerifySettings />}
    </Stack>
  );
};
