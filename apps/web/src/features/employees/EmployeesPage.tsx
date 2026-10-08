import { Button, Group, Modal, Select, Stack, TextInput, Title } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { employeeInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, useSave, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { DynamicForm, type FieldDef } from '../../components/DynamicForm';
import { errorMessage } from '../../lib/errors';
import { exportCsv, exportXlsx, fetchAllRows, type ExportColumn } from '../../lib/export';
import { enumLabel, enumOptions, StatusBadge, str, useOrgLookups } from './shared';

const PAGE_SIZE = 25;

/** حقول إنشاء موظف جديد؛ الرقم الوظيفي يظهر فقط لمن يملك صلاحية تحديده. */
export const employeeFields = (
  t: ReturnType<typeof useTranslation>['t'],
  canSetNumber: boolean,
  creating: boolean,
): FieldDef[] => [
  ...(creating && canSetNumber
    ? [
        {
          name: 'employeeNo',
          kind: 'text',
          ltr: true,
          description: t('hr.emp.numberAutoHint'),
        } satisfies FieldDef,
      ]
    : []),
  { name: 'firstNameAr', kind: 'text', required: true },
  { name: 'fatherNameAr', kind: 'text' },
  { name: 'grandfatherNameAr', kind: 'text' },
  { name: 'familyNameAr', kind: 'text', required: true },
  { name: 'firstNameEn', kind: 'text', ltr: true },
  { name: 'fatherNameEn', kind: 'text', ltr: true },
  { name: 'grandfatherNameEn', kind: 'text', ltr: true },
  { name: 'familyNameEn', kind: 'text', ltr: true },
  { name: 'birthDate', kind: 'date' },
  { name: 'gender', kind: 'select', options: enumOptions(t, 'gender', ['male', 'female']) },
  {
    name: 'maritalStatus',
    kind: 'select',
    options: enumOptions(t, 'marital', ['single', 'married', 'divorced', 'widowed']),
  },
  { name: 'nationality', kind: 'text', ltr: true },
  { name: 'firstHireDate', kind: 'date' },
];

export const EmployeesPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useOrgLookups();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [exporting, setExporting] = useState(false);

  const filters = {
    q: debounced || undefined,
    status: status ?? undefined,
    branchId: branchId ?? undefined,
    departmentId: departmentId ?? undefined,
  };
  const list = useList('/employees', { page, pageSize: PAGE_SIZE, ...filters });
  const save = useSave('/employees');
  const reset =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  const columns: Column<Row>[] = [
    {
      key: 'employeeNo',
      header: t('fields.employeeNo'),
      render: (r) => str(r['employeeNo']),
      exportValue: (r) => str(r['employeeNo']),
      ltr: true,
    },
    {
      key: 'name',
      header: t('hr.emp.name'),
      render: (r) =>
        i18n.language === 'en'
          ? str(r['fullNameEn']) || str(r['fullNameAr'])
          : str(r['fullNameAr']),
      exportValue: (r) => str(r['fullNameAr']),
    },
    {
      key: 'status',
      header: t('hr.emp.status'),
      render: (r) => <StatusBadge status={r['status']} />,
      exportValue: (r) => enumLabel(t, 'empStatus', r['status']),
    },
    {
      key: 'branch',
      header: t('hr.emp.branch'),
      render: (r) => lookups.branches.name(r['currentBranchId']),
      exportValue: (r) => lookups.branches.name(r['currentBranchId']),
    },
    {
      key: 'department',
      header: t('hr.emp.department'),
      render: (r) => lookups.departments.name(r['currentDepartmentId']),
      exportValue: (r) => lookups.departments.name(r['currentDepartmentId']),
    },
    {
      key: 'jobTitle',
      header: t('hr.emp.jobTitle'),
      render: (r) => lookups.jobTitles.name(r['currentJobTitleId']),
      exportValue: (r) => lookups.jobTitles.name(r['currentJobTitleId']),
    },
  ];

  const doExport = async (kind: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const all = await fetchAllRows<Row>('/employees', filters);
      const cols: ExportColumn<Row>[] = columns.map((c) => ({
        header: c.header,
        value: (r) => c.exportValue?.(r) ?? '',
      }));
      const name = t('nav.employees');
      if (kind === 'csv') exportCsv(name, cols, all);
      else await exportXlsx(name, cols, all, i18n.language === 'ar');
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setExporting(false);
    }
  };

  const create = (values: Record<string, unknown>) =>
    save.mutate(
      { body: values },
      {
        onSuccess: (row) => {
          notifications.show({ color: 'teal', message: t('hr.emp.created') });
          close();
          void navigate({ to: '/employees/$employeeId', params: { employeeId: row.id } });
        },
        onError: (err) => notifications.show({ color: 'red', message: errorMessage(err, t) }),
      },
    );

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('hr.emp.title')}</Title>
        <Group>
          <Button
            variant="default"
            leftSection={<IconDownload size={16} />}
            loading={exporting}
            onClick={() => void doExport('xlsx')}
          >
            {t('table.exportXlsx')}
          </Button>
          <Button variant="default" onClick={() => void doExport('csv')} loading={exporting}>
            {t('table.exportCsv')}
          </Button>
          {can('employees.employee.create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={open}>
              {t('hr.emp.add')}
            </Button>
          )}
        </Group>
      </Group>
      <Group>
        <TextInput
          placeholder={t('hr.emp.searchPlaceholder')}
          value={search}
          onChange={(e) => reset(setSearch)(e.currentTarget.value)}
          w={340}
        />
        <Select
          placeholder={t('hr.emp.status')}
          clearable
          value={status}
          onChange={reset(setStatus)}
          data={enumOptions(t, 'empStatus', ['active', 'suspended', 'terminated'])}
          w={170}
        />
        {lookups.branches.rows.length > 0 && (
          <Select
            placeholder={t('hr.emp.branch')}
            clearable
            searchable
            value={branchId}
            onChange={reset(setBranchId)}
            data={lookups.branches.options}
            w={180}
          />
        )}
        {lookups.departments.rows.length > 0 && (
          <Select
            placeholder={t('hr.emp.department')}
            clearable
            searchable
            value={departmentId}
            onChange={reset(setDepartmentId)}
            data={lookups.departments.options}
            w={200}
          />
        )}
      </Group>
      <DataTable
        columns={columns}
        rows={(list.data?.data ?? []) as Row[]}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        onRowClick={(row) =>
          void navigate({ to: '/employees/$employeeId', params: { employeeId: row.id } })
        }
      />
      <Modal opened={opened} onClose={close} title={t('hr.emp.add')} centered size="lg">
        {opened && (
          <DynamicForm
            fields={employeeFields(t, can('employees.employee.set_number'), true)}
            schema={employeeInput}
            initial={Object.fromEntries(
              employeeFields(t, can('employees.employee.set_number'), true).map((f) => [
                f.name,
                '',
              ]),
            )}
            editing={false}
            submitting={save.isPending}
            onSubmit={create}
            onCancel={close}
          />
        )}
      </Modal>
    </Stack>
  );
};
