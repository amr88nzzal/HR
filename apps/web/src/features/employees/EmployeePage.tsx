import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  FileButton,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCamera, IconTrash } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useOne } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';
import { DocumentsPanel } from '../archive/DocumentsPanel';
import { BankTab } from './BankTab';
import {
  AddressesTab,
  ContactsTab,
  ContractsTab,
  DependentsTab,
  EducationTab,
  ExperienceTab,
  ExternalRefsTab,
} from './ChildTabs';
import { EmploymentTab } from './EmploymentTab';
import { OverviewTab } from './OverviewTab';
import { StatusBadge, str } from './shared';

/** صورة الموظف المصغّرة: تُجلب بطلب موثَّق (<img> لا يحمل Authorization). */
const usePhoto = (employeeId: string, photoFileId: unknown, canRead: boolean) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!canRead || !photoFileId) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    api
      .blob(`/employees/${employeeId}/photo`)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, photoFileId, canRead]);
  return url;
};

type TabDef = { value: string; label: string; show: boolean; body: React.ReactNode };

/** بطاقة الموظف: رأس (صورة، اسم، حالة) وتبويبات تُعرض بحسب صلاحيات المستخدم. */
export const EmployeePage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { employeeId } = useParams({ strict: false }) as { employeeId: string };
  const employee = useOne('/employees', employeeId);
  const photo = usePhoto(employeeId, employee.data?.photoFileId, can('employees.employee.read'));
  const [busy, setBusy] = useState(false);

  if (employee.isLoading) return <Loader />;
  if (employee.isError || !employee.data)
    return (
      <Stack>
        <Alert color="red">{t('hr.emp.notFound')}</Alert>
        <Anchor component={Link} to="/employees">
          {t('hr.emp.backToList')}
        </Anchor>
      </Stack>
    );
  const emp = employee.data;

  const refresh = () => qc.invalidateQueries({ queryKey: ['/employees'] });
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/employees/${employeeId}/photo`, file, { method: 'PUT', name: file.name });
      notifications.show({ color: 'teal', message: t('hr.emp.photo.saved') });
      await refresh();
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };
  const removePhoto = async () => {
    setBusy(true);
    try {
      await api.del(`/employees/${employeeId}/photo`);
      notifications.show({ color: 'teal', message: t('hr.emp.photo.saved') });
      await refresh();
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };

  const tabs: TabDef[] = [
    {
      value: 'overview',
      label: t('hr.emp.tabs.overview'),
      show: true,
      body: <OverviewTab employee={emp} />,
    },
    {
      value: 'employment',
      label: t('hr.emp.tabs.employment'),
      show: can('employees.employment.read'),
      body: <EmploymentTab employeeId={employeeId} />,
    },
    {
      value: 'contacts',
      label: t('hr.emp.tabs.contacts'),
      show: true,
      body: <ContactsTab employeeId={employeeId} />,
    },
    {
      value: 'addresses',
      label: t('hr.emp.tabs.addresses'),
      show: true,
      body: <AddressesTab employeeId={employeeId} />,
    },
    {
      value: 'dependents',
      label: t('hr.emp.tabs.dependents'),
      show: true,
      body: <DependentsTab employeeId={employeeId} />,
    },
    {
      value: 'education',
      label: t('hr.emp.tabs.education'),
      show: true,
      body: <EducationTab employeeId={employeeId} />,
    },
    {
      value: 'experience',
      label: t('hr.emp.tabs.experience'),
      show: true,
      body: <ExperienceTab employeeId={employeeId} />,
    },
    {
      value: 'contracts',
      label: t('hr.emp.tabs.contracts'),
      show: can('employees.contract.read'),
      body: <ContractsTab employeeId={employeeId} />,
    },
    {
      value: 'bank',
      label: t('hr.emp.tabs.bank'),
      show: can('employees.bank_account.read'),
      body: <BankTab employeeId={employeeId} />,
    },
    {
      value: 'refs',
      label: t('hr.emp.tabs.externalRefs'),
      show: can('employees.external_ref.read'),
      body: <ExternalRefsTab employeeId={employeeId} />,
    },
    {
      value: 'documents',
      label: t('hr.emp.tabs.documents'),
      show: can('archive.document.read'),
      body: <DocumentsPanel ownerType="employee" ownerId={employeeId} />,
    },
  ];
  const visible = tabs.filter((x) => x.show);
  const name = localName({ nameAr: emp['fullNameAr'], nameEn: emp['fullNameEn'] }, i18n.language);

  return (
    <Stack>
      <Anchor component={Link} to="/employees" size="sm">
        {t('hr.emp.backToList')}
      </Anchor>
      <Group align="center" wrap="nowrap">
        <Avatar src={photo} size={72} radius="xl" alt={name}>
          {name.slice(0, 1)}
        </Avatar>
        <Stack gap={2}>
          <Group gap="xs">
            <Title order={2}>{name}</Title>
            <StatusBadge status={emp['status']} />
          </Group>
          <Text c="dimmed" size="sm" dir="ltr" style={{ textAlign: 'start' }}>
            {str(emp['employeeNo'])}
          </Text>
        </Stack>
        {can('employees.employee.update') && (
          <Group gap={4} ms="auto">
            <FileButton onChange={(f) => void upload(f)} accept="image/png,image/jpeg,image/webp">
              {(props) => (
                <ActionIcon
                  {...props}
                  variant="light"
                  loading={busy}
                  aria-label={t('hr.emp.photo.upload')}
                  title={t('hr.emp.photo.upload')}
                >
                  <IconCamera size={18} />
                </ActionIcon>
              )}
            </FileButton>
            {!!emp['photoFileId'] && (
              <ActionIcon
                variant="light"
                color="red"
                loading={busy}
                onClick={() => void removePhoto()}
                aria-label={t('hr.emp.photo.remove')}
                title={t('hr.emp.photo.remove')}
              >
                <IconTrash size={18} />
              </ActionIcon>
            )}
          </Group>
        )}
      </Group>
      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List style={{ flexWrap: 'wrap' }}>
          {visible.map((x) => (
            <Tabs.Tab key={x.value} value={x.value}>
              {x.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {visible.map((x) => (
          <Tabs.Panel key={x.value} value={x.value} pt="md">
            {x.body}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
};
