import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { documentFieldInput, documentTypeInput } from '@hrms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../api/client';
import { useOne, useSave, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ActiveBadge, DataTable, type Column } from '../../components/DataTable';
import { DynamicForm, type FieldDef } from '../../components/DynamicForm';
import { EntityTable, initialValues } from '../../components/EntityTable';
import { parseOptions, optionsToText } from '../admin/CustomFieldsPage';
import { errorMessage } from '../../lib/errors';
import { omit } from '../../lib/omit';
import { localName } from '../../lib/names';
import { enumLabel, enumOptions, str } from '../employees/shared';

const OPTION_TYPES = ['select'];

/** نموذج الحقل: الخيارات نص (سطر لكل خيار) يُحوَّل عند الإرسال. */
const fieldFormSchema = (invalid: string) =>
  z
    .object({
      key: z.string(),
      dataType: z.string(),
      options: z.unknown().optional(),
    })
    .passthrough()
    .superRefine((v, ctx) => {
      const options = v.dataType === 'select' ? parseOptions(v.options) : [];
      if (options === null) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: invalid });
        return;
      }
      const r = documentFieldInput.safeParse({ ...v, options });
      if (!r.success)
        for (const i of r.error.issues)
          ctx.addIssue({ code: 'custom', path: i.path, message: i.message });
    });

/** حقول نوع وثيقة واحد: إضافة/تعديل/حذف. المفتاح والنوع والحساسية ثابتة بعد الإنشاء. */
const FieldsPanel = ({ typeId, canEdit }: { typeId: string; canEdit: boolean }) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const type = useOne('/document-types', typeId);
  const save = useSave(`/document-types/${typeId}/fields`, ['/document-types']);
  const [editing, setEditing] = useState<Row | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [showInactive, setShowInactive] = useState(false);
  const all = ((type.data?.fields ?? []) as Row[]).filter(
    (f) => showInactive || f['isActive'] !== false,
  );

  const fields: FieldDef[] = [
    { name: 'key', kind: 'text', required: true, ltr: true, lockOnEdit: true },
    { name: 'labelAr', kind: 'text', required: true },
    { name: 'labelEn', kind: 'text' },
    {
      name: 'dataType',
      kind: 'select',
      required: true,
      lockOnEdit: true,
      options: enumOptions(t, 'dataType', [
        'text',
        'long_text',
        'number',
        'date',
        'amount',
        'boolean',
        'select',
        'file',
        'reminder_date',
      ]),
      description: t('hr.archive.fieldLockedHint'),
    },
    { name: 'options', kind: 'textarea', description: t('hr.cf.optionsHint') },
    { name: 'isRequired', kind: 'switch' },
    { name: 'isSensitive', kind: 'switch', lockOnEdit: true },
    { name: 'isUnique', kind: 'switch' },
    { name: 'showInList', kind: 'switch' },
    { name: 'sortOrder', kind: 'number', min: 0 },
    { name: 'isActive', kind: 'switch' },
  ];
  const defaults = {
    dataType: 'text',
    isRequired: false,
    isSensitive: false,
    isUnique: false,
    showInList: false,
    sortOrder: 0,
    isActive: true,
    options: '',
  };

  const submit = (values: Record<string, unknown>) => {
    const options = values['dataType'] === 'select' ? (parseOptions(values['options']) ?? []) : [];
    let body: Record<string, unknown> = { ...values, options };
    if (editing) {
      body = { ...omit(body, ['key', 'dataType', 'isSensitive']), version: editing['version'] };
    }
    save.mutate(
      { id: editing?.id, body },
      {
        onSuccess: () => {
          notifications.show({ color: 'teal', message: t('table.saved') });
          void qc.invalidateQueries({ queryKey: ['/document-types', 'one', typeId] });
          close();
        },
        onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
      },
    );
  };

  const remove = (row: Row) =>
    modals.openConfirmModal({
      title: t('table.deleteTitle'),
      children: <Text size="sm">{t('table.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/document-types/${typeId}/fields/${row.id}`);
          notifications.show({ color: 'teal', message: t('table.deleted') });
          void qc.invalidateQueries({ queryKey: ['/document-types', 'one', typeId] });
        } catch (err) {
          notifications.show({ color: 'red', message: errorMessage(err, t) });
        }
      },
    });

  const columns: Column<Row>[] = [
    { key: 'key', header: t('fields.key'), render: (r) => str(r['key']), ltr: true },
    {
      key: 'label',
      header: t('fields.labelAr'),
      render: (r) => localName({ nameAr: r['labelAr'], nameEn: r['labelEn'] }, i18n.language),
    },
    {
      key: 'type',
      header: t('fields.dataType'),
      render: (r) => enumLabel(t, 'dataType', r['dataType']),
    },
    {
      key: 'req',
      header: t('fields.isRequired'),
      render: (r) => (r['isRequired'] === true ? '✓' : '—'),
    },
    {
      key: 'sens',
      header: t('fields.isSensitive'),
      render: (r) =>
        r['isSensitive'] === true ? (
          <Badge color="grape" variant="light">
            ✓
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'uniq',
      header: t('fields.isUnique'),
      render: (r) => (r['isUnique'] === true ? '✓' : '—'),
    },
    {
      key: 'list',
      header: t('fields.showInList'),
      render: (r) => (r['showInList'] === true ? '✓' : '—'),
    },
    {
      key: 'active',
      header: t('fields.isActive'),
      render: (r) => <ActiveBadge active={r['isActive'] === true} />,
    },
  ];

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={4}>
            {t('hr.archive.fields')}
            {type.data ? ` — ${localName(type.data, i18n.language)}` : ''}
          </Title>
          <Group>
            <Switch
              size="xs"
              label={t('hr.archive.showInactive')}
              checked={showInactive}
              onChange={(e) => setShowInactive(e.currentTarget.checked)}
            />
            {canEdit && (
              <Button
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => {
                  setEditing(null);
                  open();
                }}
              >
                {t('hr.archive.addField')}
              </Button>
            )}
          </Group>
        </Group>
        <DataTable
          columns={columns}
          rows={all as never}
          loading={type.isLoading}
          page={1}
          pageSize={Math.max(all.length, 1)}
          total={all.length}
          onPage={() => undefined}
          actions={
            canEdit
              ? (row) => (
                  <>
                    <ActionIcon
                      variant="subtle"
                      aria-label={t('table.edit')}
                      onClick={() => {
                        setEditing(row as Row);
                        open();
                      }}
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t('table.delete')}
                      onClick={() => remove(row as Row)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </>
                )
              : undefined
          }
        />
      </Stack>
      <Modal
        opened={opened}
        onClose={close}
        centered
        title={editing ? t('hr.archive.editField') : t('hr.archive.addField')}
      >
        {opened && (
          <DynamicForm
            key={editing?.id ?? 'new'}
            fields={fields}
            schema={fieldFormSchema(t('hr.cf.optionsInvalid'))}
            initial={
              editing
                ? {
                    ...initialValues(fields, editing, defaults),
                    options: OPTION_TYPES.includes(str(editing['dataType']))
                      ? optionsToText(editing['options'])
                      : '',
                  }
                : initialValues(fields, null, defaults)
            }
            editing={!!editing}
            submitting={save.isPending}
            onSubmit={submit}
            onCancel={close}
          />
        )}
      </Modal>
    </Card>
  );
};

/** أنواع الوثائق وحقولها (منشئ الأنواع): اختر نوعاً لإدارة حقوله. */
export const DocumentTypesPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('fields.nameAr'),
      render: (r) => (
        <>
          {localName(r, i18n.language)}{' '}
          {str(r['systemKey']) && (
            <Badge size="xs" variant="outline">
              {str(r['systemKey'])}
            </Badge>
          )}
        </>
      ),
    },
    { key: 'category', header: t('fields.category'), render: (r) => str(r['category']) || '—' },
    {
      key: 'owner',
      header: t('fields.ownerType'),
      render: (r) => enumLabel(t, 'ownerType', r['ownerType']),
    },
    {
      key: 'req',
      header: t('fields.isRequired'),
      render: (r) => (r['isRequired'] === true ? '✓' : '—'),
    },
    {
      key: 'active',
      header: t('fields.isActive'),
      render: (r) => <ActiveBadge active={r['isActive'] === true} />,
    },
  ];
  const fields: FieldDef[] = [
    { name: 'nameAr', kind: 'text', required: true },
    { name: 'nameEn', kind: 'text' },
    { name: 'category', kind: 'text' },
    {
      name: 'ownerType',
      kind: 'select',
      required: true,
      lockOnEdit: true,
      options: enumOptions(t, 'ownerType', ['employee', 'branch', 'company']),
    },
    { name: 'systemKey', kind: 'text', ltr: true, lockOnEdit: true },
    { name: 'isRequired', kind: 'switch' },
    { name: 'isActive', kind: 'switch' },
  ];
  return (
    <Stack>
      <Title order={2}>{t('nav.documentTypes')}</Title>
      <EntityTable
        path="/document-types"
        columns={columns}
        fields={fields}
        schema={documentTypeInput}
        defaults={{ ownerType: 'employee', isRequired: false, isActive: true }}
        canCreate={can('archive.document_type.create')}
        canUpdate={can('archive.document_type.update')}
        canDelete={can('archive.document_type.delete')}
        onRowClick={(row) => setSelected(row.id)}
        // المالك والمفتاح النظامي ثابتان بعد الإنشاء: الخادم لا يقبلهما في التعديل
        toBody={(values, editing) => {
          if (!editing) return values;
          return omit(values, ['ownerType', 'systemKey']);
        }}
      />
      {selected ? (
        <FieldsPanel
          key={selected}
          typeId={selected}
          canEdit={can('archive.document_type.update')}
        />
      ) : (
        <Text c="dimmed" size="sm">
          {t('hr.archive.selectTypeHint')}
        </Text>
      )}
    </Stack>
  );
};
