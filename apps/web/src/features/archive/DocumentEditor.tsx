import {
  ActionIcon,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconEye, IconTrash, IconUpload } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useOne, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { useLookup, str } from '../employees/shared';
import { FieldInput, fieldLabel, type DocField } from './FieldInput';

const MASK = '••••••';

type FileRow = {
  id: string;
  fieldKey: string | null;
  pageNo: number;
  originalName: string;
  sizeBytes: string | number;
};
type TypeDetail = Row & { fields: DocField[]; ownerType: string };
type DocDetail = Row & {
  values: Record<string, unknown>;
  status: 'active' | 'superseded';
  versionNo: number;
  files?: FileRow[];
  reminders?: { id: string; fieldKey: string; dueDate: string; status: string }[];
};

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const kb = (n: string | number) => `${Math.max(1, Math.round(Number(n) / 1024))} KB`;

/**
 * إنشاء/عرض/تعديل وثيقة بنوعها: حقول ديناميكية، الحساس مقنّع بكشف مدقَّق،
 * ملفات (رفع/تنزيل/حذف)، واستبدال بنسخة جديدة. بعد الإنشاء تنتقل الشاشة لوضع التعديل لرفع الملفات.
 */
export const DocumentEditor = ({
  typeId,
  ownerId,
  docId,
  onSwitch,
  onClose,
}: {
  typeId: string;
  ownerId: string | null;
  /** null = وثيقة جديدة */
  docId: string | null;
  /** يفتح وثيقة أخرى (بعد الإنشاء أو الاستبدال) */
  onSwitch: (id: string) => void;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const fmt = useFormat();
  const type = useOne<TypeDetail>('/document-types', typeId);
  const detail = useOne<DocDetail>('/documents', docId);
  const currencies = useLookup('/currencies', 'system.currency.read');
  const codes = currencies.rows.map((c) => str(c['code']));

  if (type.isLoading || (docId && detail.isLoading)) return <Loader size="sm" />;
  if (!type.data) return null;
  const doc = docId ? detail.data : null;
  return (
    <EditorBody
      key={`${docId ?? 'new'}:${doc?.version ?? 0}`}
      type={type.data}
      doc={doc ?? null}
      ownerId={ownerId}
      codes={codes}
      can={can}
      fmtDate={fmt.date}
      lang={i18n.language}
      t={t}
      onSwitch={onSwitch}
      onClose={onClose}
      refresh={() => qc.invalidateQueries({ queryKey: ['/documents'] })}
    />
  );
};

type BodyProps = {
  type: TypeDetail;
  doc: DocDetail | null;
  ownerId: string | null;
  codes: string[];
  can: (code: string | undefined) => boolean;
  fmtDate: (v: unknown) => string;
  lang: string;
  t: ReturnType<typeof useTranslation>['t'];
  onSwitch: (id: string) => void;
  onClose: () => void;
  refresh: () => Promise<unknown>;
};

const EditorBody = ({
  type,
  doc,
  ownerId,
  codes,
  can,
  fmtDate,
  lang,
  t,
  onSwitch,
  onClose,
  refresh,
}: BodyProps) => {
  const fields = type.fields.filter((f) => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const dataFields = fields.filter((f) => f.dataType !== 'file');
  const fileFields = fields.filter((f) => f.dataType === 'file');
  const [vals, setVals] = useState<Record<string, unknown>>(doc?.values ?? {});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  // حقول حساسة مخزّنة ما زالت مقنّعة (لم تُكشف أو تُستبدل)
  const [masked, setMasked] = useState<Set<string>>(
    new Set(
      dataFields.filter((f) => f.isSensitive && doc?.values[f.key] === MASK).map((f) => f.key),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<FileRow[]>(doc?.files ?? []);
  const readOnly = doc ? doc.status !== 'active' || !can('archive.document.update') : false;

  const fail = (err: unknown) =>
    notifications.show({ color: 'red', message: errorMessage(err, t) });
  const set = (key: string, v: unknown) => {
    setVals((s) => ({ ...s, [key]: v }));
    setDirty((d) => new Set(d).add(key));
  };

  const payload = () =>
    Object.fromEntries([...dirty].filter((k) => !masked.has(k)).map((k) => [k, vals[k] ?? null]));

  const save = async () => {
    setSaving(true);
    try {
      if (!doc) {
        const res = await api.post<Row>('/documents', {
          documentTypeId: type.id,
          ownerId: type.ownerType === 'company' ? null : ownerId,
          values: payload(),
        });
        await refresh();
        notifications.show({ color: 'teal', message: t('table.saved') });
        onSwitch(res.data.id);
      } else {
        await api.patch(`/documents/${doc.id}`, { version: doc.version, values: payload() });
        await refresh();
        notifications.show({ color: 'teal', message: t('table.saved') });
      }
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const reveal = async (key: string) => {
    if (!doc) return;
    try {
      const res = await api.post<{ value: unknown }>(`/documents/${doc.id}/reveal`, { key });
      setVals((s) => ({ ...s, [key]: res.data.value }));
      setMasked((m) => {
        const n = new Set(m);
        n.delete(key);
        return n;
      });
      notifications.show({ color: 'yellow', message: t('hr.emp.bank.revealed') });
    } catch (err) {
      fail(err);
    }
  };
  const replace = (key: string) => {
    setMasked((m) => {
      const n = new Set(m);
      n.delete(key);
      return n;
    });
    set(key, null);
  };

  const reloadFiles = async () => {
    if (!doc) return;
    const res = await api.get<DocDetail>(`/documents/${doc.id}`);
    setFiles(res.data.files ?? []);
    await refresh();
  };
  const upload = async (file: File | null, fieldKey?: string) => {
    if (!file || !doc) return;
    try {
      await api.upload(`/documents/${doc.id}/files`, file, {
        name: file.name,
        query: { fieldKey },
      });
      notifications.show({ color: 'teal', message: t('hr.archive.uploaded') });
      await reloadFiles();
    } catch (err) {
      fail(err);
    }
  };
  const download = async (f: FileRow) => {
    if (!doc) return;
    try {
      saveBlob(await api.blob(`/documents/${doc.id}/files/${f.id}/content`), f.originalName);
    } catch (err) {
      fail(err);
    }
  };
  const removeFile = (f: FileRow) =>
    modals.openConfirmModal({
      title: t('table.deleteTitle'),
      children: <Text size="sm">{t('table.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/documents/${doc?.id}/files/${f.id}`);
          await reloadFiles();
        } catch (err) {
          fail(err);
        }
      },
    });
  const supersede = () =>
    modals.openConfirmModal({
      title: t('hr.archive.supersede'),
      children: <Text size="sm">{t('hr.archive.supersedeConfirm')}</Text>,
      labels: { confirm: t('hr.archive.supersede'), cancel: t('common.cancel') },
      onConfirm: async () => {
        try {
          const res = await api.post<Row>(`/documents/${doc?.id}/supersede`, {});
          await refresh();
          notifications.show({ color: 'teal', message: t('hr.archive.superseded') });
          onSwitch(res.data.id);
        } catch (err) {
          fail(err);
        }
      },
    });

  const canUpload = !!doc && !readOnly;
  const nameOf = (f: DocField) => fieldLabel(f, lang);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>
          {lang === 'en' ? str(type.nameEn) || str(type.nameAr) : str(type.nameAr)}
        </Title>
        {doc && (
          <Group gap="xs">
            <Badge variant="light">v{doc.versionNo}</Badge>
            {doc.status === 'superseded' && (
              <Badge color="gray">{t('hr.archive.superseded')}</Badge>
            )}
          </Group>
        )}
      </Group>

      {dataFields.map((f) =>
        masked.has(f.key) ? (
          <TextInput
            key={f.key}
            label={nameOf(f)}
            value={MASK}
            readOnly
            rightSectionWidth={64}
            rightSection={
              !readOnly || can('archive.document.reveal') ? (
                <Group gap={2} wrap="nowrap">
                  {can('archive.document.reveal') && (
                    <ActionIcon
                      variant="subtle"
                      aria-label={t('hr.archive.reveal')}
                      onClick={() => void reveal(f.key)}
                    >
                      <IconEye size={16} />
                    </ActionIcon>
                  )}
                  {!readOnly && (
                    <Button size="compact-xs" variant="subtle" onClick={() => replace(f.key)}>
                      {t('hr.archive.replaceValue')}
                    </Button>
                  )}
                </Group>
              ) : undefined
            }
          />
        ) : (
          <FieldInput
            key={f.key}
            field={f}
            value={vals[f.key]}
            onChange={(v) => set(f.key, v)}
            currencies={codes.length ? codes : ['SAR']}
            disabled={readOnly}
          />
        ),
      )}

      {!readOnly && (
        <Group justify="space-between">
          <Group>
            {doc && can('archive.document.update') && (
              <Button variant="default" onClick={supersede}>
                {t('hr.archive.supersede')}
              </Button>
            )}
          </Group>
          <Group>
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void save()}
              loading={saving}
              disabled={!!doc && dirty.size === 0}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Group>
      )}

      {doc && (
        <Card withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Title order={5}>{t('hr.archive.files')}</Title>
              {canUpload && (
                <Group gap="xs">
                  {fileFields.map((f) => (
                    <FileButton key={f.key} onChange={(file) => void upload(file, f.key)}>
                      {(props) => (
                        <Button
                          {...props}
                          size="compact-sm"
                          variant="light"
                          leftSection={<IconUpload size={14} />}
                        >
                          {nameOf(f)}
                        </Button>
                      )}
                    </FileButton>
                  ))}
                  <FileButton onChange={(file) => void upload(file)}>
                    {(props) => (
                      <Button {...props} size="compact-sm" leftSection={<IconUpload size={14} />}>
                        {t('hr.archive.upload')}
                      </Button>
                    )}
                  </FileButton>
                </Group>
              )}
            </Group>
            {canUpload && (
              <Text size="xs" c="dimmed">
                {t('hr.archive.fileTypes')}
              </Text>
            )}
            {files.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t('table.empty')}
              </Text>
            ) : (
              <Table withRowBorders={false}>
                <Table.Tbody>
                  {files.map((f) => {
                    const slot = fileFields.find((x) => x.key === f.fieldKey);
                    return (
                      <Table.Tr key={f.id}>
                        <Table.Td dir="ltr" ta="start">
                          {f.originalName}
                        </Table.Td>
                        <Table.Td>{slot ? nameOf(slot) : '—'}</Table.Td>
                        <Table.Td dir="ltr">{kb(f.sizeBytes)}</Table.Td>
                        <Table.Td w={1}>
                          <Group gap={2} wrap="nowrap">
                            <ActionIcon
                              variant="subtle"
                              aria-label={t('hr.archive.open')}
                              onClick={() => void download(f)}
                            >
                              <IconDownload size={16} />
                            </ActionIcon>
                            {canUpload && can('archive.document.update') && (
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                aria-label={t('table.delete')}
                                onClick={() => removeFile(f)}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
            {doc.reminders && doc.reminders.length > 0 && (
              <Group gap="xs">
                {doc.reminders.map((r) => (
                  <Badge
                    key={r.id}
                    variant="outline"
                    color={r.status === 'pending' ? 'orange' : 'gray'}
                  >
                    {fmtDate(r.dueDate)}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  );
};
