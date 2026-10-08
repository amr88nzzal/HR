import { Badge, Stack, Title } from '@mantine/core';
import { customFieldDefinitionInput } from '@hrms/shared';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ActiveBadge, type Column } from '../../components/DataTable';
import type { FieldDef } from '../../components/DynamicForm';
import { EntityTable } from '../../components/EntityTable';
import { omit } from '../../lib/omit';
import { localName } from '../../lib/names';
import { enumLabel, enumOptions, str } from '../employees/shared';

type Option = { value: string; labelAr: string; labelEn?: string };

/** «القيمة|التسمية» في كل سطر ← مصفوفة خيارات؛ null عند سطر غير صالح. */
export const parseOptions = (text: unknown): Option[] | null => {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const out: Option[] = [];
  for (const line of text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const [value, ...rest] = line.split('|');
    const label = rest.join('|').trim();
    if (!value?.trim() || !label) return null;
    out.push({ value: value.trim(), labelAr: label });
  }
  return out;
};
export const optionsToText = (options: unknown): string =>
  Array.isArray(options) ? options.map((o: Option) => `${o.value}|${o.labelAr}`).join('\n') : '';

/** مخطط النموذج: نص الخيارات يتحول إلى مصفوفة ثم يُتحقق بمخطط الخادم المشترك. */
const formSchema = (invalid: string) =>
  z.any().superRefine((v, ctx) => {
    const options = parseOptions((v as Record<string, unknown>)['options']);
    if (options === null) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: invalid });
      return;
    }
    const r = customFieldDefinitionInput.safeParse({ ...(v as object), options });
    if (!r.success)
      for (const i of r.error.issues)
        ctx.addIssue({ code: 'custom', path: i.path, message: i.message });
  });

export const CustomFieldsPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const columns: Column<Row>[] = [
    { key: 'key', header: t('fields.key'), render: (r) => str(r['key']), ltr: true },
    {
      key: 'label',
      header: t('fields.labelAr'),
      render: (r) => localName({ nameAr: r['labelAr'], nameEn: r['labelEn'] }, i18n.language),
    },
    {
      key: 'type',
      header: t('fields.fieldType'),
      render: (r) => enumLabel(t, 'fieldType', r['fieldType']),
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
      key: 'active',
      header: t('fields.isActive'),
      render: (r) => <ActiveBadge active={r['isActive'] === true} />,
    },
  ];
  const fields: FieldDef[] = [
    { name: 'key', kind: 'text', required: true, ltr: true, lockOnEdit: true },
    { name: 'labelAr', kind: 'text', required: true },
    { name: 'labelEn', kind: 'text' },
    {
      name: 'fieldType',
      kind: 'select',
      required: true,
      lockOnEdit: true,
      options: enumOptions(t, 'fieldType', ['text', 'number', 'date', 'boolean', 'select']),
      description: t('hr.cf.lockedHint'),
    },
    { name: 'options', kind: 'textarea', description: t('hr.cf.optionsHint') },
    { name: 'isRequired', kind: 'switch' },
    { name: 'isSensitive', kind: 'switch', lockOnEdit: true },
    { name: 'sortOrder', kind: 'number', min: 0 },
    { name: 'isActive', kind: 'switch' },
  ];
  return (
    <Stack>
      <Title order={2}>{t('nav.customFields')}</Title>
      <EntityTable
        path="/custom-field-definitions"
        columns={columns}
        fields={fields}
        schema={formSchema(t('hr.cf.optionsInvalid'))}
        defaults={{
          fieldType: 'text',
          sortOrder: 0,
          isRequired: false,
          isSensitive: false,
          isActive: true,
          options: '',
        }}
        canCreate={can('org.custom_field.create')}
        canUpdate={can('org.custom_field.update')}
        canDelete={can('org.custom_field.delete')}
        toInitial={(row) => ({ options: optionsToText(row['options']) })}
        toBody={(values, editing) => {
          const options = parseOptions(values['options']) ?? [];
          if (!editing) return { ...values, options };
          // المفتاح والنوع والحساسية ثابتة بعد الإنشاء
          return { ...omit(values, ['key', 'fieldType', 'isSensitive']), options };
        }}
      />
    </Stack>
  );
};
