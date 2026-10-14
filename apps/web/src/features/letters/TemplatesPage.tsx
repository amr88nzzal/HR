import {
  Alert,
  Badge,
  Button,
  Drawer,
  FileInput,
  Group,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { downloadBlob } from '../../lib/export';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import {
  DEFAULT_BODY_AR,
  DEFAULT_BODY_EN,
  type TemplateDetail,
  type TemplateRow,
  type VariableDef,
} from './types';

const GROUPS = ['employee', 'job', 'contract', 'company', 'document'] as const;

/** محرر القالب: HTML مع دليل المتغيرات بأسماء عربية ومعاينة بموظف حقيقي وإصدارات. */
const Editor = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canWrite = can(id ? 'letters.template.update' : 'letters.template.create');
  const area = useRef<HTMLTextAreaElement>(null);
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [body, setBody] = useState(DEFAULT_BODY_AR);
  const [note, setNote] = useState('');
  const [previewEmp, setPreviewEmp] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [newFormat, setNewFormat] = useState<'html' | 'docx'>('html');
  const [file, setFile] = useState<File | null>(null);

  const vars = useQuery({
    queryKey: ['/letter-templates', 'variables'],
    queryFn: async () => (await api.get<VariableDef[]>('/letter-templates/variables')).data,
  });
  const detail = useQuery({
    queryKey: ['/letter-templates', id],
    queryFn: async () => (await api.get<TemplateDetail>(`/letter-templates/${id}`)).data,
    enabled: !!id,
  });
  const format = detail.data?.format ?? newFormat;
  const isDocx = format === 'docx';
  if (detail.data && loadedFor !== detail.data.id) {
    const active = detail.data.versions.find((v) => v.id === detail.data?.activeVersionId);
    setLoadedFor(detail.data.id);
    setCode(detail.data.code);
    setNameAr(detail.data.nameAr);
    setNameEn(detail.data.nameEn ?? '');
    setLanguage(detail.data.language);
    setBody(active?.bodyHtml ?? '');
  }
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['/letter-templates'] });
  };
  const fail = (e: unknown) => {
    const problems = (e as { details?: { problems?: string[] } }).details?.problems;
    notifications.show({
      color: 'red',
      message: problems?.length ? problems.join(' • ') : errorMessage(e, t),
    });
  };
  const save = useMutation({
    mutationFn: async () => {
      if (isDocx) {
        if (!id && file)
          return api.upload('/letter-templates/docx', file, {
            query: {
              code,
              nameAr,
              nameEn: nameEn || undefined,
              language,
              fileName: file.name,
            },
          });
        await api.patch(`/letter-templates/${id}`, { nameAr, nameEn: nameEn || null });
        if (file)
          return api.upload(`/letter-templates/${id}/versions/docx`, file, {
            query: { note: note || undefined, fileName: file.name },
          });
        return;
      }
      if (!id)
        return api.post('/letter-templates', {
          code,
          nameAr,
          nameEn: nameEn || null,
          language,
          bodyHtml: body,
        });
      await api.patch(`/letter-templates/${id}`, { nameAr, nameEn: nameEn || null });
      return api.post(`/letter-templates/${id}/versions`, { bodyHtml: body, note: note || null });
    },
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('letters.saved') });
      setFile(null);
      await refresh();
      if (!id) onClose();
    },
    onError: fail,
  });
  const activate = useMutation({
    mutationFn: async (versionId: string) =>
      api.post(`/letter-templates/${id}/versions/${versionId}/activate`, {}),
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('letters.activated') });
      await refresh();
    },
    onError: fail,
  });
  const preview = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ html: string }>(`/letter-templates/${id ?? 'new'}/preview`, {
          bodyHtml: body,
          employeeId: previewEmp,
        })
      ).data.html,
    onSuccess: setPreviewHtml,
    onError: fail,
  });
  const insert = (key: string) => {
    const el = area.current;
    const token = `{{${key}}}`;
    if (isDocx) {
      void navigator.clipboard?.writeText(token);
      notifications.show({ color: 'teal', message: t('letters.copied', { token }) });
      return;
    }
    if (!el) return setBody((b) => b + token);
    const s = el.selectionStart;
    const e = el.selectionEnd;
    setBody((b) => b.slice(0, s) + token + b.slice(e));
  };
  const downloadVersion = async (versionId: string, versionNo: number) => {
    try {
      downloadBlob(
        await api.blob(`/letter-templates/${id}/versions/${versionId}/docx`),
        `${code || 'template'}-v${versionNo}.docx`,
      );
    } catch (e) {
      fail(e);
    }
  };
  const lang = i18n.language === 'en' ? 'en' : 'ar';

  return (
    <Stack>
      <Group grow align="flex-start">
        <TextInput
          label={t('letters.code')}
          value={code}
          disabled={!!id}
          onChange={(e) => setCode(e.currentTarget.value)}
        />
        <TextInput
          label={t('letters.nameAr')}
          value={nameAr}
          onChange={(e) => setNameAr(e.currentTarget.value)}
        />
        <TextInput
          label={t('letters.nameEn')}
          value={nameEn}
          onChange={(e) => setNameEn(e.currentTarget.value)}
        />
      </Group>
      {!id && (
        <SegmentedControl
          aria-label={t('letters.format')}
          value={newFormat}
          onChange={(v) => setNewFormat(v as 'html' | 'docx')}
          data={[
            { value: 'html', label: t('letters.formatHtml') },
            { value: 'docx', label: t('letters.formatDocx') },
          ]}
        />
      )}
      {!id && (
        <SegmentedControl
          value={language}
          onChange={(v) => {
            const l = v as 'ar' | 'en';
            if (body === DEFAULT_BODY_AR || body === DEFAULT_BODY_EN)
              setBody(l === 'ar' ? DEFAULT_BODY_AR : DEFAULT_BODY_EN);
            setLanguage(l);
          }}
          data={[
            { value: 'ar', label: t('letters.langAr') },
            { value: 'en', label: t('letters.langEn') },
          ]}
        />
      )}
      <Group align="flex-start" wrap="nowrap">
        <Stack style={{ flex: 1 }} gap="xs">
          {isDocx && (
            <FileInput
              label={t('letters.docxFile')}
              description={t('letters.docxHint')}
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              clearable
              value={file}
              onChange={setFile}
            />
          )}
          {!isDocx && (
            <Textarea
              ref={area}
              aria-label={t('letters.body')}
              label={t('letters.body')}
              description={t('letters.bodyHint')}
              rows={16}
              dir="ltr"
              styles={{ input: { fontFamily: 'monospace', fontSize: 13 } }}
              value={body}
              onChange={(e) => setBody(e.currentTarget.value)}
            />
          )}
          {id && (
            <TextInput
              label={t('letters.versionNote')}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          )}
        </Stack>
        <Stack w={260} gap={4}>
          <Text fw={600} size="sm">
            {t('letters.variables')}
          </Text>
          {GROUPS.map((g) => (
            <Stack key={g} gap={2}>
              <Text size="xs" c="dimmed">
                {t(`letters.groups.${g}`)}
              </Text>
              <Group gap={4}>
                {(vars.data ?? [])
                  .filter((v) => v.group === g)
                  .map((v) => (
                    <Badge
                      key={v.key}
                      variant="light"
                      style={{ cursor: 'pointer', textTransform: 'none' }}
                      title={v.key}
                      onClick={() => insert(v.key)}
                    >
                      {lang === 'ar' ? v.labelAr : v.labelEn}
                    </Badge>
                  ))}
              </Group>
            </Stack>
          ))}
        </Stack>
      </Group>
      <Group justify="space-between">
        <Group align="flex-end">
          <EmployeeSelect
            label={t('letters.previewWith')}
            value={previewEmp}
            onChange={setPreviewEmp}
          />
          <Button
            variant="light"
            disabled={!previewEmp || !id || isDocx}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
          >
            {t('letters.preview')}
          </Button>
        </Group>
        {canWrite && (
          <Button
            loading={save.isPending}
            disabled={!nameAr.trim() || !code.trim() || (isDocx ? !id && !file : !body.trim())}
            onClick={() => save.mutate()}
          >
            {id ? t('letters.saveVersion') : t('letters.create')}
          </Button>
        )}
      </Group>
      {previewHtml && (
        <iframe
          title={t('letters.preview')}
          sandbox=""
          srcDoc={previewHtml}
          style={{
            width: '100%',
            height: 480,
            border: '1px solid var(--mantine-color-default-border)',
            background: '#fff',
          }}
        />
      )}
      {detail.data && (
        <Stack gap="xs">
          <Text fw={600}>{t('letters.versions')}</Text>
          <Table withTableBorder>
            <Table.Tbody>
              {detail.data.versions.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td dir="ltr">v{v.versionNo}</Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={
                        v.status === 'active' ? 'teal' : v.status === 'draft' ? 'yellow' : 'gray'
                      }
                    >
                      {t(`letters.versionStatus.${v.status}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{v.note}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      {v.bodyHtml !== null ? (
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => setBody(v.bodyHtml ?? '')}
                        >
                          {t('letters.loadIntoEditor')}
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => void downloadVersion(v.id, v.versionNo)}
                        >
                          {t('letters.downloadTemplate')}
                        </Button>
                      )}
                      {canWrite && v.status !== 'active' && (
                        <Button size="xs" variant="subtle" onClick={() => activate.mutate(v.id)}>
                          {t('letters.activate')}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Stack>
  );
};

export const TemplatesPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['/letter-templates', 'list'],
    queryFn: async () => (await api.get<TemplateRow[]>('/letter-templates')).data,
    retry: false,
  });
  const rows = (q.data ?? []).filter((r) => !lang || r.language === lang);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.letterTemplates')}</Title>
        <Group>
          <Select
            aria-label={t('letters.language')}
            placeholder={t('letters.allLanguages')}
            clearable
            w={160}
            data={[
              { value: 'ar', label: t('letters.langAr') },
              { value: 'en', label: t('letters.langEn') },
            ]}
            value={lang}
            onChange={setLang}
          />
          {can('letters.template.create') && (
            <Button onClick={() => setEditing('new')}>{t('letters.newTemplate')}</Button>
          )}
        </Group>
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('letters.code')}</Table.Th>
            <Table.Th>{t('letters.nameAr')}</Table.Th>
            <Table.Th>{t('letters.language')}</Table.Th>
            <Table.Th>{t('letters.format')}</Table.Th>
            <Table.Th>{t('letters.activeVersion')}</Table.Th>
            <Table.Th>{t('attendance.status')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td dir="ltr">{r.code}</Table.Td>
              <Table.Td>{r.nameAr}</Table.Td>
              <Table.Td>{r.language === 'ar' ? t('letters.langAr') : t('letters.langEn')}</Table.Td>
              <Table.Td>
                {r.format === 'docx' ? t('letters.formatDocx') : t('letters.formatHtml')}
              </Table.Td>
              <Table.Td dir="ltr">{r.activeVersionNo ? `v${r.activeVersionNo}` : '—'}</Table.Td>
              <Table.Td>
                <Badge variant="light" color={r.isActive ? 'teal' : 'gray'}>
                  {r.isActive ? t('table.active') : t('table.inactive')}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Button size="xs" variant="subtle" onClick={() => setEditing(r.id)}>
                  {t('letters.open')}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={editing !== null}
        onClose={() => setEditing(null)}
        position="right"
        size="min(1100px, 100%)"
        title={editing === 'new' ? t('letters.newTemplate') : t('letters.editTemplate')}
      >
        {editing !== null && (
          <Editor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        )}
      </Drawer>
    </Stack>
  );
};
