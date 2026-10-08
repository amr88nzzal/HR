import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { changeInput, type ChangeType } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from './EmployeeSelect';
import { enumLabel, enumOptions, str, useLookup } from './shared';

const CHANGE_TYPES: ChangeType[] = [
  'hire',
  'transfer',
  'promotion',
  'manager_change',
  'suspension',
  'reinstatement',
  'termination',
];

/** حقول التعيين التي يعرضها كل نوع تغيير */
export const FIELDS_BY_TYPE: Record<ChangeType, string[]> = {
  hire: [
    'branchId',
    'departmentId',
    'jobTitleId',
    'jobGradeId',
    'managerEmployeeId',
    'employmentType',
    'workMode',
    'workCountry',
  ],
  transfer: ['branchId', 'departmentId', 'workMode', 'workCountry'],
  promotion: ['jobTitleId', 'jobGradeId'],
  manager_change: ['managerEmployeeId'],
  suspension: [],
  reinstatement: [],
  termination: [],
};

const today = () => new Date().toISOString().slice(0, 10);

/** يبني حمولة التغيير: تُرسل حقول التعيين المعروضة والمملوءة فقط. */
export const buildChangePayload = (values: {
  changeType: ChangeType;
  effectiveDate: string;
  reasonId: string | null;
  notes: string;
  employment: Record<string, string | null>;
}) => {
  const shown = FIELDS_BY_TYPE[values.changeType];
  const employment = Object.fromEntries(
    Object.entries(values.employment).filter(([k, v]) => shown.includes(k) && v),
  );
  return {
    changeType: values.changeType,
    effectiveDate: values.effectiveDate,
    reasonId: values.reasonId || null,
    notes: values.notes.trim() || null,
    employment,
  };
};

const ChangeModal = ({
  employeeId,
  current,
  onClose,
}: {
  employeeId: string;
  current: Row | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const departments = useLookup('/departments', 'org.department.read');
  const titles = useLookup('/job-titles', 'org.job_title.read');
  const grades = useLookup('/job-grades', 'org.job_grade.read');
  const branches = useLookup('/branches', 'system.branch.read');
  const reasons = useLookup('/change-reasons', 'org.change_reason.read');
  const [saving, setSaving] = useState(false);
  const form = useForm({
    initialValues: {
      changeType: (current ? 'transfer' : 'hire') as ChangeType,
      effectiveDate: today(),
      reasonId: null as string | null,
      notes: '',
      employment: {
        branchId: str(current?.['branchId']) || null,
        departmentId: str(current?.['departmentId']) || null,
        jobTitleId: str(current?.['jobTitleId']) || null,
        jobGradeId: str(current?.['jobGradeId']) || null,
        managerEmployeeId: str(current?.['managerEmployeeId']) || null,
        employmentType: str(current?.['employmentType']) || 'full_time',
        workMode: str(current?.['workMode']) || 'onsite',
        workCountry: str(current?.['workCountry']) || null,
      } as Record<string, string | null>,
    },
  });
  const v = form.values;
  const shown = FIELDS_BY_TYPE[v.changeType];
  const set = (key: string) => (val: string | null) => form.setFieldValue(`employment.${key}`, val);
  const get = (key: string) => v.employment[key] ?? null;
  const branchDepartments = departments.rows
    .filter(
      (d) =>
        !get('branchId') ||
        ((d['branchIds'] as string[] | undefined) ?? []).includes(get('branchId') as string),
    )
    .map((d) => ({ value: d.id, label: departments.name(d.id) }));
  const reasonOptions = reasons.rows
    .filter((r) => r['changeType'] === v.changeType && r['isActive'] !== false)
    .map((r) => ({ value: r.id, label: reasons.name(r.id) }));

  const submit = async () => {
    const payload = buildChangePayload(v);
    const parsed = changeInput.safeParse(payload);
    if (!parsed.success) {
      notifications.show({
        color: 'red',
        message: parsed.error.issues[0]?.message ?? t('apiErrors.VALIDATION_ERROR'),
      });
      return;
    }
    setSaving(true);
    try {
      await api.post(`/employees/${employeeId}/changes`, parsed.data);
      await qc.invalidateQueries({ queryKey: [`/employees/${employeeId}/employments`] });
      await qc.invalidateQueries({ queryKey: [`/employees/${employeeId}/changes`] });
      await qc.invalidateQueries({ queryKey: ['/employees'] });
      notifications.show({ color: 'teal', message: t('hr.emp.employment.done') });
      onClose();
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Stack>
        <Select
          label={t('fields.changeType')}
          withAsterisk
          allowDeselect={false}
          data={enumOptions(t, 'changeType', CHANGE_TYPES)}
          value={v.changeType}
          onChange={(val) => val && form.setFieldValue('changeType', val as ChangeType)}
        />
        {v.changeType === 'hire' && !current && (
          <Text size="xs" c="dimmed">
            {t('hr.emp.employment.hireHint')}
          </Text>
        )}
        <TextInput
          label={t('fields.effectiveDate')}
          type="date"
          dir="ltr"
          withAsterisk
          {...form.getInputProps('effectiveDate')}
        />
        {reasonOptions.length > 0 && (
          <Select
            label={t('fields.reasonId')}
            clearable
            data={reasonOptions}
            {...form.getInputProps('reasonId')}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {shown.includes('branchId') && (
            <Select
              label={t('fields.branchId')}
              searchable
              data={branches.options}
              value={get('branchId')}
              onChange={set('branchId')}
            />
          )}
          {shown.includes('departmentId') && (
            <Select
              label={t('fields.departmentId')}
              searchable
              data={branchDepartments}
              value={get('departmentId')}
              onChange={set('departmentId')}
            />
          )}
          {shown.includes('jobTitleId') && (
            <Select
              label={t('fields.jobTitleId')}
              searchable
              clearable
              data={titles.options}
              value={get('jobTitleId')}
              onChange={set('jobTitleId')}
            />
          )}
          {shown.includes('jobGradeId') && (
            <Select
              label={t('fields.jobGradeId')}
              searchable
              clearable
              data={grades.options}
              value={get('jobGradeId')}
              onChange={set('jobGradeId')}
            />
          )}
          {shown.includes('managerEmployeeId') && (
            <EmployeeSelect
              label={t('fields.managerEmployeeId')}
              excludeId={undefined}
              value={get('managerEmployeeId')}
              onChange={set('managerEmployeeId')}
            />
          )}
          {shown.includes('employmentType') && (
            <Select
              label={t('fields.employmentType')}
              allowDeselect={false}
              data={enumOptions(t, 'employmentType', [
                'full_time',
                'part_time',
                'temporary',
                'contractor',
              ])}
              value={get('employmentType')}
              onChange={set('employmentType')}
            />
          )}
          {shown.includes('workMode') && (
            <Select
              label={t('fields.workMode')}
              allowDeselect={false}
              data={enumOptions(t, 'workMode', ['onsite', 'remote', 'hybrid'])}
              value={get('workMode')}
              onChange={set('workMode')}
            />
          )}
          {shown.includes('workCountry') && (
            <TextInput
              label={t('fields.workCountry')}
              dir="ltr"
              value={get('workCountry') ?? ''}
              onChange={(e) => set('workCountry')(e.currentTarget.value.toUpperCase() || null)}
            />
          )}
        </SimpleGrid>
        <Textarea label={t('fields.notes')} autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saving}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

/** التعيين الحالي + سجل التعيينات + سجل التغييرات + تسجيل تغيير جديد. */
export const EmploymentTab = ({ employeeId }: { employeeId: string }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const [opened, { open, close }] = useDisclosure(false);
  const employments = useList(`/employees/${employeeId}/employments`, {});
  const changes = useList(`/employees/${employeeId}/changes`, {});
  const rows = (employments.data?.data ?? []) as Row[];
  const now = today();
  const current =
    rows.find((r) => str(r['validFrom']) <= now && (!r['validTo'] || str(r['validTo']) >= now)) ??
    null;

  const empColumns: Column<Row>[] = [
    { key: 'from', header: t('hr.emp.employment.from'), render: (r) => fmt.date(r['validFrom']) },
    {
      key: 'to',
      header: t('hr.emp.employment.to'),
      render: (r) => (r['validTo'] ? fmt.date(r['validTo']) : t('hr.emp.employment.open')),
    },
    { key: 'branch', header: t('hr.emp.branch'), render: (r) => str(r['branchNameAr']) || '—' },
    {
      key: 'dept',
      header: t('hr.emp.department'),
      render: (r) => str(r['departmentNameAr']) || '—',
    },
    { key: 'title', header: t('hr.emp.jobTitle'), render: (r) => str(r['jobTitleNameAr']) || '—' },
    { key: 'manager', header: t('hr.emp.manager'), render: (r) => str(r['managerNameAr']) || '—' },
  ];
  const changeColumns: Column<Row>[] = [
    {
      key: 'date',
      header: t('hr.emp.employment.effective'),
      render: (r) => fmt.date(r['effectiveDate']),
    },
    {
      key: 'type',
      header: t('fields.changeType'),
      render: (r) => <Badge variant="light">{enumLabel(t, 'changeType', r['changeType'])}</Badge>,
    },
    {
      key: 'reason',
      header: t('hr.emp.employment.reason'),
      render: (r) => str(r['reasonNameAr']) || '—',
    },
    { key: 'notes', header: t('fields.notes'), render: (r) => str(r['notes']) || '—' },
    { key: 'by', header: '', render: (r) => str(r['createdByName']) || '—' },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>{t('hr.emp.employment.current')}</Title>
        {can('employees.employment.manage') && (
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={open}>
            {t('hr.emp.employment.register')}
          </Button>
        )}
      </Group>
      {current ? (
        <Card withBorder data-testid="current-employment">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Info label={t('hr.emp.branch')} value={str(current['branchNameAr'])} />
            <Info label={t('hr.emp.department')} value={str(current['departmentNameAr'])} />
            <Info label={t('hr.emp.jobTitle')} value={str(current['jobTitleNameAr'])} />
            <Info label={t('hr.emp.manager')} value={str(current['managerNameAr'])} />
            <Info
              label={t('fields.employmentType')}
              value={enumLabel(t, 'employmentType', current['employmentType'])}
            />
            <Info
              label={t('fields.workMode')}
              value={enumLabel(t, 'workMode', current['workMode'])}
            />
          </SimpleGrid>
        </Card>
      ) : (
        <Text c="dimmed">{t('hr.emp.employment.none')}</Text>
      )}
      <Title order={5}>{t('hr.emp.employment.history')}</Title>
      <DataTable
        columns={empColumns}
        rows={rows as never}
        loading={employments.isLoading}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        total={rows.length}
        onPage={() => undefined}
      />
      <Title order={5}>{t('hr.emp.employment.changes')}</Title>
      <DataTable
        columns={changeColumns}
        rows={(changes.data?.data ?? []) as never}
        loading={changes.isLoading}
        page={1}
        pageSize={Math.max(changes.data?.data.length ?? 1, 1)}
        total={changes.data?.data.length ?? 0}
        onPage={() => undefined}
      />
      <Modal
        opened={opened}
        onClose={close}
        title={t('hr.emp.employment.register')}
        centered
        size="lg"
      >
        {opened && <ChangeModal employeeId={employeeId} current={current} onClose={close} />}
      </Modal>
    </Stack>
  );
};

const Info = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Text>{value || '—'}</Text>
  </div>
);
