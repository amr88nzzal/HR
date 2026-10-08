import { Badge, Stack, Title } from '@mantine/core';
import { externalSystemInput } from '@hrms/shared';
import { useTranslation } from 'react-i18next';
import type { Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ActiveBadge, type Column } from '../../components/DataTable';
import type { FieldDef } from '../../components/DynamicForm';
import { EntityTable } from '../../components/EntityTable';
import { omit } from '../../lib/omit';
import { localName } from '../../lib/names';
import { enumLabel, enumOptions, str } from '../employees/shared';

/** الأنظمة الخارجية التي تحمل مراجع للموظفين (المحاسبة، جهاز البصمة…). */
export const ExternalSystemsPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const columns: Column<Row>[] = [
    { key: 'key', header: t('fields.key'), render: (r) => str(r['key']), ltr: true },
    {
      key: 'name',
      header: t('fields.nameAr'),
      render: (r) => (
        <>
          {localName(r, i18n.language)}{' '}
          {r['isSystem'] === true && (
            <Badge size="xs" variant="outline">
              {t('hr.sys.system')}
            </Badge>
          )}
        </>
      ),
    },
    {
      key: 'purpose',
      header: t('fields.purpose'),
      render: (r) => enumLabel(t, 'purpose', r['purpose']),
    },
    {
      key: 'scope',
      header: t('fields.refScope'),
      render: (r) => enumLabel(t, 'refScope', r['refScope']),
    },
    {
      key: 'unique',
      header: t('fields.isUnique'),
      render: (r) => (r['isUnique'] === true ? '✓' : '—'),
    },
    {
      key: 'active',
      header: t('fields.isActive'),
      render: (r) => <ActiveBadge active={r['isActive'] === true} />,
    },
  ];
  const fields: FieldDef[] = [
    { name: 'key', kind: 'text', required: true, ltr: true, lockOnEdit: true },
    { name: 'nameAr', kind: 'text', required: true },
    { name: 'nameEn', kind: 'text' },
    {
      name: 'purpose',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'purpose', ['accounting', 'attendance_device', 'other']),
    },
    {
      name: 'refScope',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'refScope', ['company', 'branch']),
    },
    { name: 'isUnique', kind: 'switch' },
    { name: 'validationRegex', kind: 'text', ltr: true },
    { name: 'isActive', kind: 'switch' },
  ];
  return (
    <Stack>
      <Title order={2}>{t('nav.externalSystems')}</Title>
      <EntityTable
        path="/external-systems"
        columns={columns}
        fields={fields}
        schema={externalSystemInput}
        defaults={{ purpose: 'other', refScope: 'company', isUnique: true, isActive: true }}
        canCreate={can('org.external_system.create')}
        canUpdate={can('org.external_system.update')}
        canDelete={can('org.external_system.delete')}
        canDeleteRow={(r) => r['isSystem'] !== true}
        // مفتاح السجل (والغرض للنظامي) لا يُرسل عند التعديل: الخادم يمنع تغييره
        toBody={(values, editing) => {
          if (!editing) return values;
          return omit(values, editing['isSystem'] === true ? ['key', 'purpose'] : ['key']);
        }}
      />
    </Stack>
  );
};
