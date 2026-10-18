import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { employeeInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useList, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { DynamicForm, type FieldDef } from '../../components/DynamicForm';
import { csv, MultiFilter } from '../../components/MultiFilter';
import { errorMessage } from '../../lib/errors';
import { fetchAllRows } from '../../lib/export';
import {
  AccountResultModal,
  stateColor,
  type AccountResult,
  type AccountState,
} from './AccountPanel';
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
  const [status, setStatus] = useState<string[]>([]);
  const [branchId, setBranchId] = useState<string[]>([]);
  const [departmentId, setDepartmentId] = useState<string[]>([]);
  const [jobTitleId, setJobTitleId] = useState<string[]>([]);
  const [account, setAccount] = useState<string[]>([]);
  const [opened, { open, close }] = useDisclosure(false);
  const [sort, setSort] = useState<string | undefined>(undefined);

  const filters = {
    q: debounced || undefined,
    status: csv(status),
    branchId: csv(branchId),
    departmentId: csv(departmentId),
    jobTitleId: csv(jobTitleId),
    account: csv(account),
  };
  const list = useList('/employees', { page, pageSize: PAGE_SIZE, ...filters, sort });
  const qc = useQueryClient();
  const defaults = useQuery({
    queryKey: ['/settings', 'effective'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/settings/effective')).data,
    staleTime: 60_000,
  });
  const [acct, setAcct] = useState<{ on: boolean; email: string; delivery: string } | null>(null);
  const [acctResult, setAcctResult] = useState<AccountResult | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canAccount = can('identity.user.create_from_employee');
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
      sortKey: 'employeeNo',
    },
    {
      key: 'name',
      header: t('hr.emp.name'),
      render: (r) =>
        i18n.language === 'en'
          ? str(r['fullNameEn']) || str(r['fullNameAr'])
          : str(r['fullNameAr']),
      exportValue: (r) => str(r['fullNameAr']),
      sortKey: 'name',
    },
    {
      key: 'status',
      header: t('hr.emp.status'),
      render: (r) => <StatusBadge status={r['status']} />,
      exportValue: (r) => enumLabel(t, 'empStatus', r['status']),
      sortKey: 'status',
    },
    ...(can('identity.user.read')
      ? [
          {
            key: 'account',
            header: t('account.column'),
            render: (r: Row) => {
              const st = (str(r['accountStatus']) || 'none') as AccountState;
              return (
                <Badge variant="light" color={stateColor[st]}>
                  {t(`account.states.${st}`)}
                </Badge>
              );
            },
            exportValue: (r: Row) => t(`account.states.${str(r['accountStatus']) || 'none'}`),
            sortKey: 'account',
          } satisfies Column<Row>,
        ]
      : []),
    {
      key: 'branch',
      header: t('hr.emp.branch'),
      render: (r) => lookups.branches.name(r['currentBranchId']),
      exportValue: (r) => lookups.branches.name(r['currentBranchId']),
      sortKey: 'branch',
    },
    {
      key: 'department',
      header: t('hr.emp.department'),
      render: (r) => lookups.departments.name(r['currentDepartmentId']),
      exportValue: (r) => lookups.departments.name(r['currentDepartmentId']),
      sortKey: 'department',
    },
    {
      key: 'jobTitle',
      header: t('hr.emp.jobTitle'),
      render: (r) => lookups.jobTitles.name(r['currentJobTitleId']),
      exportValue: (r) => lookups.jobTitles.name(r['currentJobTitleId']),
      sortKey: 'jobTitle',
    },
  ];

  const create = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await api.request<Row>('/employees', {
        method: 'POST',
        body: {
          ...values,
          ...(acct?.on
            ? { account: { delivery: acct.delivery, ...(acct.email ? { email: acct.email } : {}) } }
            : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: ['/employees'] });
      notifications.show({ color: 'teal', message: t('hr.emp.created') });
      close();
      const account = (res.meta as { account?: AccountResult } | undefined)?.account;
      if (account) {
        setCreatedId(res.data.id);
        setAcctResult(account);
      } else {
        void navigate({ to: '/employees/$employeeId', params: { employeeId: res.data.id } });
      }
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('hr.emp.title')}</Title>
        <Group>
          {can('employees.employee.create') && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setAcct({
                  on: canAccount && defaults.data?.['createAccountOnHire'] === true,
                  email: '',
                  delivery: 'invite',
                });
                open();
              }}
            >
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
        <MultiFilter
          placeholder={t('hr.emp.status')}
          value={status}
          onChange={reset(setStatus)}
          data={enumOptions(t, 'empStatus', ['active', 'suspended', 'terminated'])}
        />
        {lookups.branches.rows.length > 0 && (
          <MultiFilter
            placeholder={t('hr.emp.branch')}
            value={branchId}
            onChange={reset(setBranchId)}
            data={lookups.branches.options}
          />
        )}
        {lookups.departments.rows.length > 0 && (
          <MultiFilter
            placeholder={t('hr.emp.department')}
            value={departmentId}
            onChange={reset(setDepartmentId)}
            data={lookups.departments.options}
          />
        )}
        {lookups.jobTitles.rows.length > 0 && (
          <MultiFilter
            placeholder={t('hr.emp.jobTitle')}
            value={jobTitleId}
            onChange={reset(setJobTitleId)}
            data={lookups.jobTitles.options}
          />
        )}
        {can('identity.user.read') && (
          <MultiFilter
            placeholder={t('account.column')}
            value={account}
            onChange={reset(setAccount)}
            data={(['none', 'invited', 'active', 'disabled'] as const).map((st) => ({
              value: st,
              label: t(`account.states.${st}`),
            }))}
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
        tableId="employees"
        title={t('nav.employees')}
        sort={sort}
        onSort={setSort}
        fetchAll={() => fetchAllRows<Row>('/employees', { ...filters, sort })}
      />
      <Modal opened={opened} onClose={close} title={t('hr.emp.add')} centered size="lg">
        {opened && canAccount && acct && (
          <Stack mb="md" gap="xs">
            <Switch
              label={t('account.createOnHire')}
              checked={acct.on}
              onChange={(e) => setAcct({ ...acct, on: e.currentTarget.checked })}
            />
            {acct.on && (
              <Group grow align="flex-start">
                <TextInput
                  label={t('account.email')}
                  description={t('account.emailHint')}
                  dir="ltr"
                  value={acct.email}
                  onChange={(e) => setAcct({ ...acct, email: e.currentTarget.value })}
                />
                <Select
                  label={t('account.delivery')}
                  allowDeselect={false}
                  value={acct.delivery}
                  data={[
                    { value: 'invite', label: t('account.deliveries.invite') },
                    { value: 'temp', label: t('account.deliveries.temp') },
                  ]}
                  onChange={(x) => setAcct({ ...acct, delivery: x ?? 'invite' })}
                />
              </Group>
            )}
          </Stack>
        )}
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
            submitting={saving}
            onSubmit={(v) => void create(v)}
            onCancel={close}
          />
        )}
      </Modal>
      <AccountResultModal
        result={acctResult}
        onClose={() => {
          setAcctResult(null);
          if (createdId)
            void navigate({ to: '/employees/$employeeId', params: { employeeId: createdId } });
        }}
      />
    </Stack>
  );
};
