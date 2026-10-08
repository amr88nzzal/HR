import { ActionIcon, Button, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { useList, useRemove, useSave, type Row } from '../api/hooks';
import { errorMessage } from '../lib/errors';
import { DataTable, type Column } from './DataTable';
import { DynamicForm, type FieldDef } from './DynamicForm';

/** القيم الابتدائية لنموذج: من الصف عند التعديل، وإلا الافتراضيات، مع قيم فارغة مناسبة لنوع الحقل. */
export const initialValues = (
  fields: FieldDef[],
  row: Row | null,
  defaults: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    fields.map((f) => {
      const empty =
        f.kind === 'multiselect' ? [] : f.kind === 'switch' ? false : f.kind === 'number' ? '' : '';
      const v = row ? row[f.name] : defaults[f.name];
      return [f.name, v ?? empty];
    }),
  );

type Props = {
  /** عنوان القسم (اختياري) */
  title?: string;
  /** مسار القائمة والإنشاء، مثل /employees/:id/contacts */
  path: string;
  columns: Column<Row>[];
  /** ثابتة، أو دالة بحسب حالة التعديل (الصف المعدَّل أو null عند الإنشاء) */
  fields: FieldDef[] | ((editing: Row | null) => FieldDef[]);
  schema: z.ZodType | ((editing: Row | null) => z.ZodType);
  defaults?: Record<string, unknown>;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** يُحوِّل قيم النموذج قبل الإرسال */
  toBody?: (values: Record<string, unknown>, editing: Row | null) => Record<string, unknown>;
  /** مسارات أخرى تُبطَل ذاكرتها بعد الحفظ */
  invalidate?: string[];
  extraActions?: (row: Row) => ReactNode;
  /** يحوّل صف التعديل إلى قيم النموذج (الافتراضي: حقول النموذج من الصف) */
  toInitial?: (row: Row) => Record<string, unknown>;
  /** نقر الصف (مثل فتح تفاصيله) */
  onRowClick?: (row: Row) => void;
  /** يمنع الحذف لصفوف بعينها (مثل السجلات النظامية) */
  canDeleteRow?: (row: Row) => boolean;
  /** تسمية نافذة النموذج */
  modalTitle?: string;
};

/** جدول CRUD مدمج لجداول فرعية تعيد القائمة كاملة (بلا ترقيم صفحات) ونموذج إضافة/تعديل في نافذة. */
export const EntityTable = ({
  title,
  path,
  columns,
  fields: fieldsProp,
  schema: schemaProp,
  defaults = {},
  canCreate,
  canUpdate,
  canDelete,
  toBody,
  invalidate,
  extraActions,
  toInitial,
  canDeleteRow,
  onRowClick,
  modalTitle,
}: Props) => {
  const { t } = useTranslation();
  const list = useList(path, {});
  const save = useSave(path, invalidate);
  const remove = useRemove(path);
  const [editing, setEditing] = useState<Row | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const rows = (list.data?.data ?? []) as Row[];
  const activeFields = typeof fieldsProp === 'function' ? fieldsProp(editing) : fieldsProp;
  const activeSchema = typeof schemaProp === 'function' ? schemaProp(editing) : schemaProp;

  const submit = (values: Record<string, unknown>) => {
    const body = toBody ? toBody(values, editing) : values;
    save.mutate(
      { id: editing?.id, body: editing ? { ...body, version: editing.version } : body },
      {
        onSuccess: () => {
          notifications.show({ color: 'teal', message: t('table.saved') });
          close();
        },
        onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
      },
    );
  };

  const confirmDelete = (row: Row) =>
    modals.openConfirmModal({
      title: t('table.deleteTitle'),
      children: <Text size="sm">{t('table.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        remove.mutate(row.id, {
          onSuccess: () => notifications.show({ color: 'teal', message: t('table.deleted') }),
          onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
        }),
    });

  const hasActions = canUpdate || canDelete || !!extraActions;

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        {title ? <Title order={4}>{title}</Title> : <span />}
        {canCreate && (
          <Button
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => {
              setEditing(null);
              open();
            }}
          >
            {t('table.add')}
          </Button>
        )}
      </Group>
      <DataTable
        columns={columns}
        rows={rows as never}
        loading={list.isLoading}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        total={rows.length}
        onPage={() => undefined}
        onRowClick={onRowClick as ((row: { id: string }) => void) | undefined}
        actions={
          hasActions
            ? (row) => (
                <>
                  {extraActions?.(row as Row)}
                  {canUpdate && (
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
                  )}
                  {canDelete && (canDeleteRow?.(row as Row) ?? true) && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t('table.delete')}
                      onClick={() => confirmDelete(row as Row)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </>
              )
            : undefined
        }
      />
      <Modal opened={opened} onClose={close} title={modalTitle ?? title} centered>
        {opened && (
          <DynamicForm
            key={editing?.id ?? 'new'}
            fields={activeFields}
            schema={activeSchema}
            initial={
              editing && toInitial
                ? { ...initialValues(activeFields, null, defaults), ...toInitial(editing) }
                : initialValues(activeFields, editing, defaults)
            }
            editing={!!editing}
            submitting={save.isPending}
            onSubmit={submit}
            onCancel={close}
          />
        )}
      </Modal>
    </Stack>
  );
};
