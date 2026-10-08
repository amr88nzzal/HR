import { Badge } from '@mantine/core';
import {
  addressInput,
  contactInput,
  contractInput,
  dependentInput,
  educationInput,
  experienceInput,
  externalRefInput,
} from '@hrms/shared';
import { useTranslation } from 'react-i18next';
import type { Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import type { Column } from '../../components/DataTable';
import type { FieldDef } from '../../components/DynamicForm';
import { EntityTable } from '../../components/EntityTable';
import { useFormat } from '../../lib/useFormat';
import { enumLabel, enumOptions, str, useLookup } from './shared';

type Props = { employeeId: string };
const yes = (v: unknown) => (v === true ? '✓' : '—');

/** الجداول الفرعية: القراءة بصلاحية الموظف، والكتابة بصلاحية تعديل الموظف. */
const useWrite = () => {
  const { can } = useAuth();
  const w = can('employees.employee.update');
  return { canCreate: w, canUpdate: w, canDelete: w };
};

export const ContactsTab = ({ employeeId }: Props) => {
  const { t } = useTranslation();
  const columns: Column<Row>[] = [
    {
      key: 'type',
      header: t('fields.type'),
      render: (r) => enumLabel(t, 'contactType', r['type']),
    },
    { key: 'value', header: t('fields.value'), render: (r) => str(r['value']), ltr: true },
    {
      key: 'contactName',
      header: t('fields.contactName'),
      render: (r) => str(r['contactName']) || '—',
    },
    { key: 'relation', header: t('fields.relation'), render: (r) => str(r['relation']) || '—' },
    { key: 'primary', header: t('fields.isPrimary'), render: (r) => yes(r['isPrimary']) },
  ];
  const fields: FieldDef[] = [
    {
      name: 'type',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'contactType', ['mobile', 'phone', 'email', 'emergency']),
    },
    { name: 'value', kind: 'text', required: true, ltr: true },
    { name: 'contactName', kind: 'text' },
    { name: 'relation', kind: 'text' },
    { name: 'isPrimary', kind: 'switch' },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/contacts`}
      columns={columns}
      fields={fields}
      schema={contactInput}
      defaults={{ type: 'mobile', isPrimary: false }}
      {...useWrite()}
    />
  );
};

export const AddressesTab = ({ employeeId }: Props) => {
  const { t } = useTranslation();
  const columns: Column<Row>[] = [
    {
      key: 'type',
      header: t('fields.type'),
      render: (r) => enumLabel(t, 'addressType', r['type']),
    },
    { key: 'country', header: t('fields.country'), render: (r) => str(r['country']) || '—' },
    { key: 'city', header: t('fields.city'), render: (r) => str(r['city']) || '—' },
    { key: 'line1', header: t('fields.line1'), render: (r) => str(r['line1']) || '—' },
    { key: 'primary', header: t('fields.isPrimary'), render: (r) => yes(r['isPrimary']) },
  ];
  const fields: FieldDef[] = [
    {
      name: 'type',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'addressType', ['home', 'work', 'other']),
    },
    { name: 'country', kind: 'text' },
    { name: 'city', kind: 'text' },
    { name: 'line1', kind: 'text' },
    { name: 'line2', kind: 'text' },
    { name: 'postalCode', kind: 'text', ltr: true },
    { name: 'isPrimary', kind: 'switch' },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/addresses`}
      columns={columns}
      fields={fields}
      schema={addressInput}
      defaults={{ type: 'home', isPrimary: false }}
      {...useWrite()}
    />
  );
};

export const DependentsTab = ({ employeeId }: Props) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const columns: Column<Row>[] = [
    { key: 'name', header: t('fields.name'), render: (r) => str(r['name']) },
    {
      key: 'relation',
      header: t('fields.relation'),
      render: (r) => enumLabel(t, 'relation', r['relation']),
    },
    { key: 'birthDate', header: t('fields.birthDate'), render: (r) => fmt.date(r['birthDate']) },
    { key: 'covered', header: t('fields.isCovered'), render: (r) => yes(r['isCovered']) },
  ];
  const fields: FieldDef[] = [
    { name: 'name', kind: 'text', required: true },
    {
      name: 'relation',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'relation', ['spouse', 'child', 'parent', 'other']),
    },
    { name: 'birthDate', kind: 'date' },
    { name: 'gender', kind: 'select', options: enumOptions(t, 'gender', ['male', 'female']) },
    { name: 'isCovered', kind: 'switch' },
    { name: 'notes', kind: 'textarea' },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/dependents`}
      columns={columns}
      fields={fields}
      schema={dependentInput}
      defaults={{ relation: 'child', isCovered: false }}
      {...useWrite()}
    />
  );
};

export const EducationTab = ({ employeeId }: Props) => {
  const { t } = useTranslation();
  const columns: Column<Row>[] = [
    { key: 'degree', header: t('fields.degree'), render: (r) => str(r['degree']) },
    { key: 'field', header: t('fields.field'), render: (r) => str(r['field']) || '—' },
    {
      key: 'institution',
      header: t('fields.institution'),
      render: (r) => str(r['institution']) || '—',
    },
    {
      key: 'endYear',
      header: t('fields.endYear'),
      render: (r) => (r['endYear'] ? String(r['endYear']) : '—'),
      ltr: true,
    },
    { key: 'grade', header: t('fields.grade'), render: (r) => str(r['grade']) || '—' },
  ];
  const fields: FieldDef[] = [
    { name: 'degree', kind: 'text', required: true },
    { name: 'field', kind: 'text' },
    { name: 'institution', kind: 'text' },
    { name: 'country', kind: 'text' },
    { name: 'startYear', kind: 'number', min: 1940, max: 2100 },
    { name: 'endYear', kind: 'number', min: 1940, max: 2100 },
    { name: 'grade', kind: 'text' },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/education`}
      columns={columns}
      fields={fields}
      schema={educationInput}
      {...useWrite()}
    />
  );
};

export const ExperienceTab = ({ employeeId }: Props) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const columns: Column<Row>[] = [
    { key: 'employer', header: t('fields.employer'), render: (r) => str(r['employer']) },
    { key: 'title', header: t('fields.title'), render: (r) => str(r['title']) || '—' },
    { key: 'startDate', header: t('fields.startDate'), render: (r) => fmt.date(r['startDate']) },
    { key: 'endDate', header: t('fields.endDate'), render: (r) => fmt.date(r['endDate']) },
  ];
  const fields: FieldDef[] = [
    { name: 'employer', kind: 'text', required: true },
    { name: 'title', kind: 'text' },
    { name: 'startDate', kind: 'date' },
    { name: 'endDate', kind: 'date' },
    { name: 'notes', kind: 'textarea' },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/experience`}
      columns={columns}
      fields={fields}
      schema={experienceInput}
      {...useWrite()}
    />
  );
};

export const ContractsTab = ({ employeeId }: Props) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const manage = can('employees.contract.manage');
  const columns: Column<Row>[] = [
    {
      key: 'contractType',
      header: t('fields.contractType'),
      render: (r) => enumLabel(t, 'contractType', r['contractType']),
    },
    { key: 'startDate', header: t('fields.startDate'), render: (r) => fmt.date(r['startDate']) },
    { key: 'endDate', header: t('fields.endDate'), render: (r) => fmt.date(r['endDate']) },
    {
      key: 'status',
      header: t('fields.status'),
      render: (r) => (
        <Badge variant="light" color={r['status'] === 'active' ? 'teal' : 'gray'}>
          {enumLabel(t, 'contractStatus', r['status'])}
        </Badge>
      ),
    },
  ];
  const fields: FieldDef[] = [
    {
      name: 'contractType',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'contractType', [
        'permanent',
        'fixed_term',
        'temporary',
        'part_time',
        'internship',
        'contractor',
      ]),
    },
    { name: 'startDate', kind: 'date', required: true },
    { name: 'endDate', kind: 'date' },
    { name: 'probationEndDate', kind: 'date' },
    { name: 'noticeDays', kind: 'number', min: 0, max: 365 },
    {
      name: 'status',
      kind: 'select',
      required: true,
      options: enumOptions(t, 'contractStatus', ['draft', 'active', 'ended', 'terminated']),
    },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/contracts`}
      invalidate={[`/employees/${employeeId}/employments`]}
      columns={columns}
      fields={fields}
      schema={contractInput}
      defaults={{ contractType: 'permanent', status: 'active' }}
      canCreate={manage}
      canUpdate={manage}
      canDelete={manage}
    />
  );
};

export const ExternalRefsTab = ({ employeeId }: Props) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const systems = useLookup('/external-systems', 'org.external_system.read');
  const branches = useLookup('/branches', 'system.branch.read');
  const manage = can('employees.external_ref.manage');
  const columns: Column<Row>[] = [
    {
      key: 'system',
      header: t('hr.emp.refs.system'),
      render: (r) =>
        i18n.language === 'en'
          ? str(r['systemNameEn']) || str(r['systemNameAr'])
          : str(r['systemNameAr']),
    },
    { key: 'value', header: t('hr.emp.refs.value'), render: (r) => str(r['value']), ltr: true },
    {
      key: 'branch',
      header: t('fields.branchId'),
      render: (r) => (r['branchId'] ? branches.name(r['branchId']) : '—'),
    },
    { key: 'validFrom', header: t('fields.validFrom'), render: (r) => fmt.date(r['validFrom']) },
    { key: 'validTo', header: t('fields.validTo'), render: (r) => fmt.date(r['validTo']) },
    { key: 'primary', header: t('fields.isPrimary'), render: (r) => yes(r['isPrimary']) },
  ];
  const fields: FieldDef[] = [
    {
      name: 'systemId',
      kind: 'select',
      required: true,
      lockOnEdit: true,
      options: systems.rows
        .filter((s) => s['isActive'] !== false)
        .map((s) => ({ value: s.id, label: systems.name(s.id) })),
    },
    { name: 'value', kind: 'text', required: true, ltr: true },
    {
      name: 'branchId',
      kind: 'select',
      options: branches.options,
      description: t('hr.emp.refs.branchHint'),
    },
    { name: 'validFrom', kind: 'date' },
    { name: 'validTo', kind: 'date' },
    { name: 'isPrimary', kind: 'switch' },
    { name: 'notes', kind: 'textarea' },
  ];
  return (
    <EntityTable
      path={`/employees/${employeeId}/external-refs`}
      columns={columns}
      fields={fields}
      schema={externalRefInput}
      defaults={{ isPrimary: true }}
      canCreate={manage}
      canUpdate={manage}
      canDelete={manage}
    />
  );
};
