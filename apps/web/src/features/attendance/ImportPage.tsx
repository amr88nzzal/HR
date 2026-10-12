import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from '../employees/EmployeeSelect';

export type ImportReport = {
  fileHash: string;
  encoding: string;
  hasHeader: boolean;
  alreadyImportedBatchId: string | null;
  total: number;
  toInsert: number;
  duplicatesInFile: number;
  alreadyExisting: number;
  held: number;
  heldCodes: { code: string; reason: 'unmatched' | 'ambiguous'; count: number }[];
  errorCount: number;
  errors: { line: number; message: string }[];
  employees: number;
  dateFrom: string | null;
  dateTo: string | null;
  sample: { line: number; code: string; date: string; time: string; direction: string | null }[];
  applied: boolean;
  batchId?: string;
  inserted?: number;
};

type ProfileRow = {
  id: string;
  code: string;
  nameAr: string;
  isDefault: boolean;
  isActive: boolean;
};
type BatchRow = {
  id: string;
  fileName: string | null;
  status: 'applied' | 'reverted';
  totalRows: number;
  inserted: number;
  duplicates: number;
  held: number;
  errors: number;
  employees: number;
  dateFrom: string | null;
  dateTo: string | null;
  createdAt: string;
  profileCode: string | null;
  heldOpen: number;
};
type HeldRow = {
  deviceCode: string;
  reason: 'unmatched' | 'ambiguous';
  rows: number;
  firstAt: string;
  lastAt: string;
  branches: string[] | null;
};

const Stat = ({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) => (
  <Card withBorder padding="sm" miw={120}>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Text fw={700} size="xl" c={color} dir="ltr" ta="start">
      {value}
    </Text>
  </Card>
);

const UploadTab = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fmt = useFormat();
  const [file, setFile] = useState<File | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [signature, setSignature] = useState('');
  const profiles = useQuery({
    queryKey: ['/attendance-import', 'profiles'],
    queryFn: async () => (await api.get<ProfileRow[]>('/attendance-import/profiles')).data,
    retry: false,
  });
  const sig = `${file?.name}|${file?.size}|${file?.lastModified}|${profileId}`;
  const send = useMutation({
    mutationFn: async (dryRun: boolean) =>
      (
        await api.upload<ImportReport>('/attendance-import', file as File, {
          query: { dryRun, profileId: profileId ?? undefined, fileName: file?.name },
        })
      ).data,
    onSuccess: async (r, dryRun) => {
      setReport(r);
      if (dryRun) setSignature(sig);
      else {
        notifications.show({
          color: 'teal',
          message: t('attendanceImport.applied', { inserted: r.inserted ?? 0, held: r.held }),
        });
        await qc.invalidateQueries({ queryKey: ['/attendance'] });
        await qc.invalidateQueries({ queryKey: ['/attendance-import'] });
      }
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const previewed = !!report && !report.applied && signature === sig;
  const canConfirm =
    previewed && report.toInsert + report.held > 0 && !report.alreadyImportedBatchId;

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label={t('attendanceImport.profile')}
          w={260}
          clearable
          placeholder={t('attendanceImport.defaultProfile')}
          data={(profiles.data ?? [])
            .filter((p) => p.isActive)
            .map((p) => ({ value: p.id, label: `${p.code} — ${p.nameAr}` }))}
          value={profileId}
          onChange={(v) => {
            setProfileId(v);
            setReport(null);
          }}
        />
        <FileInput
          label={t('attendanceImport.file')}
          accept=".csv,.txt,text/csv,text/plain"
          value={file}
          onChange={(f) => {
            setFile(f);
            setReport(null);
          }}
          clearable
          w={320}
        />
        <Button
          leftSection={<IconUpload size={16} />}
          disabled={!file}
          loading={send.isPending && send.variables === true}
          onClick={() => send.mutate(true)}
        >
          {t('attendanceImport.preview')}
        </Button>
      </Group>

      {report && (
        <Stack>
          <Group>
            <Stat label={t('attendanceImport.stats.total')} value={report.total} />
            <Stat
              label={t('attendanceImport.stats.toInsert')}
              value={report.toInsert}
              color="teal"
            />
            <Stat
              label={t('attendanceImport.stats.duplicatesInFile')}
              value={report.duplicatesInFile}
            />
            <Stat
              label={t('attendanceImport.stats.alreadyExisting')}
              value={report.alreadyExisting}
            />
            <Stat label={t('attendanceImport.stats.held')} value={report.held} color="orange" />
            <Stat
              label={t('attendanceImport.stats.errors')}
              value={report.errorCount}
              color="red"
            />
            <Stat label={t('attendanceImport.stats.employees')} value={report.employees} />
          </Group>
          <Text size="sm" c="dimmed">
            {t('attendanceImport.period')}:{' '}
            {report.dateFrom ? `${fmt.date(report.dateFrom)} → ${fmt.date(report.dateTo)}` : '—'} ·{' '}
            {t('attendanceImport.encoding')}: {report.encoding}
          </Text>
          {report.alreadyImportedBatchId && !report.applied && (
            <Alert color="orange" variant="light">
              {t('attendanceImport.alreadyImported')}
            </Alert>
          )}
          {!report.applied && !report.alreadyImportedBatchId && (
            <Alert color="gray" variant="light">
              {previewed ? t('attendanceImport.previewed') : t('attendanceImport.fileChanged')}
            </Alert>
          )}
          {report.applied && (
            <Alert color="teal" variant="light">
              {t('attendanceImport.applied', { inserted: report.inserted ?? 0, held: report.held })}
            </Alert>
          )}
          {report.heldCodes.length > 0 && (
            <Stack gap={4}>
              <Text fw={600} size="sm">
                {t('attendanceImport.heldCodes')}
              </Text>
              <Table withTableBorder w="auto">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('attendanceImport.code')}</Table.Th>
                    <Table.Th>{t('attendanceImport.reason')}</Table.Th>
                    <Table.Th>{t('attendanceImport.count')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {report.heldCodes.map((h) => (
                    <Table.Tr key={`${h.code}|${h.reason}`}>
                      <Table.Td dir="ltr" ta="start">
                        {h.code}
                      </Table.Td>
                      <Table.Td>{t(`attendanceImport.reasons.${h.reason}`)}</Table.Td>
                      <Table.Td dir="ltr" ta="start">
                        {h.count}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
          {report.errors.length > 0 && (
            <Stack gap={4}>
              <Text fw={600} size="sm">
                {t('attendanceImport.errorsList')}
              </Text>
              <Table withTableBorder w="auto">
                <Table.Tbody>
                  {report.errors.slice(0, 20).map((e) => (
                    <Table.Tr key={e.line}>
                      <Table.Td dir="ltr" ta="start">
                        {t('attendanceImport.line')} {e.line}
                      </Table.Td>
                      <Table.Td>{e.message}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
          {report.sample.length > 0 && !report.applied && (
            <Stack gap={4}>
              <Text fw={600} size="sm">
                {t('attendanceImport.sample')}
              </Text>
              <Table withTableBorder w="auto">
                <Table.Tbody>
                  {report.sample.slice(0, 8).map((s) => (
                    <Table.Tr key={s.line}>
                      <Table.Td dir="ltr" ta="start">
                        {s.line}
                      </Table.Td>
                      <Table.Td dir="ltr" ta="start">
                        {s.code}
                      </Table.Td>
                      <Table.Td dir="ltr" ta="start">
                        {s.date} {s.time}
                      </Table.Td>
                      <Table.Td>
                        {s.direction ? t(`attendance.punches.${s.direction}`) : '—'}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
          <Group>
            <Button
              disabled={!canConfirm}
              loading={send.isPending && send.variables === false}
              onClick={() => send.mutate(false)}
            >
              {t('attendanceImport.confirm')}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
};

const BatchesTab = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['/attendance-import', 'batches'],
    queryFn: async () => (await api.get<BatchRow[]>('/attendance-import/batches')).data,
  });
  const revert = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ removed: number }>(`/attendance-import/batches/${id}/revert`, {})).data,
    onSuccess: async (r) => {
      notifications.show({
        color: 'teal',
        message: t('attendanceImport.reverted', { n: r.removed }),
      });
      await qc.invalidateQueries({ queryKey: ['/attendance-import'] });
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirm = (b: BatchRow) =>
    modals.openConfirmModal({
      title: t('attendanceImport.revertTitle'),
      children: <Text size="sm">{t('attendanceImport.revertConfirm')}</Text>,
      labels: { confirm: t('attendanceImport.revert'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => revert.mutate(b.id),
    });
  const rows = q.data ?? [];
  if (!q.isLoading && rows.length === 0)
    return <Text c="dimmed">{t('attendanceImport.noBatches')}</Text>;
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('attendanceImport.cols.file')}</Table.Th>
            <Table.Th>{t('attendanceImport.cols.createdAt')}</Table.Th>
            <Table.Th>{t('attendanceImport.period')}</Table.Th>
            <Table.Th>{t('attendanceImport.cols.rows')}</Table.Th>
            <Table.Th>{t('attendanceImport.cols.inserted')}</Table.Th>
            <Table.Th>{t('attendanceImport.cols.duplicates')}</Table.Th>
            <Table.Th>{t('attendanceImport.cols.heldOpen')}</Table.Th>
            <Table.Th>{t('attendanceImport.cols.status')}</Table.Th>
            {can('attendance.import.manage') && <Table.Th w={1} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((b) => (
            <Table.Tr key={b.id}>
              <Table.Td>
                <Text size="sm">{b.fileName ?? '—'}</Text>
                <Text size="xs" c="dimmed">
                  {b.profileCode ?? ''}
                </Text>
              </Table.Td>
              <Table.Td>{fmt.dateTime(b.createdAt)}</Table.Td>
              <Table.Td>
                {b.dateFrom ? `${fmt.date(b.dateFrom)} → ${fmt.date(b.dateTo)}` : '—'}
              </Table.Td>
              <Table.Td dir="ltr" ta="start">
                {b.totalRows}
              </Table.Td>
              <Table.Td dir="ltr" ta="start">
                {b.inserted}
              </Table.Td>
              <Table.Td dir="ltr" ta="start">
                {b.duplicates}
              </Table.Td>
              <Table.Td dir="ltr" ta="start">
                {b.heldOpen}
              </Table.Td>
              <Table.Td>
                <Badge color={b.status === 'applied' ? 'teal' : 'gray'} variant="light">
                  {t(`attendanceImport.status.${b.status}`)}
                </Badge>
              </Table.Td>
              {can('attendance.import.manage') && (
                <Table.Td>
                  {b.status === 'applied' && (
                    <Button
                      size="compact-xs"
                      color="red"
                      variant="light"
                      onClick={() => confirm(b)}
                    >
                      {t('attendanceImport.revert')}
                    </Button>
                  )}
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
};

const ResolveModal = ({ row, onClose }: { row: HeldRow; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [createRef, setCreateRef] = useState(true);
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ resolved: number }>('/attendance-import/held/resolve', {
          deviceCode: row.deviceCode,
          employeeId,
          createRef,
        })
      ).data,
    onSuccess: async (r) => {
      notifications.show({
        color: 'teal',
        message: t('attendanceImport.resolved', { n: r.resolved }),
      });
      await qc.invalidateQueries({ queryKey: ['/attendance-import'] });
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal
      opened
      onClose={onClose}
      title={`${t('attendanceImport.resolveTitle')}: ${row.deviceCode}`}
      centered
    >
      <Stack>
        <EmployeeSelect
          label={t('attendance.employee')}
          value={employeeId}
          onChange={setEmployeeId}
        />
        <Checkbox
          label={t('attendanceImport.createRef')}
          checked={createRef}
          onChange={(e) => setCreateRef(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!employeeId} loading={save.isPending} onClick={() => save.mutate()}>
            {t('attendanceImport.resolve')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const HeldTab = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<HeldRow | null>(null);
  const q = useQuery({
    queryKey: ['/attendance-import', 'held'],
    queryFn: async () => (await api.get<HeldRow[]>('/attendance-import/held/summary')).data,
  });
  const discard = useMutation({
    mutationFn: async (deviceCode: string) =>
      (await api.post('/attendance-import/held/discard', { deviceCode })).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendanceImport.discarded') });
      await qc.invalidateQueries({ queryKey: ['/attendance-import'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirmDiscard = (h: HeldRow) =>
    modals.openConfirmModal({
      title: `${t('attendanceImport.discardTitle')}: ${h.deviceCode}`,
      children: <Text size="sm">{t('attendanceImport.discardConfirm')}</Text>,
      labels: { confirm: t('attendanceImport.discard'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => discard.mutate(h.deviceCode),
    });
  const rows = q.data ?? [];
  if (!q.isLoading && rows.length === 0)
    return <Text c="dimmed">{t('attendanceImport.noHeld')}</Text>;
  const manage = can('attendance.import.manage');
  return (
    <>
      <Table.ScrollContainer minWidth={640}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('attendanceImport.code')}</Table.Th>
              <Table.Th>{t('attendanceImport.reason')}</Table.Th>
              <Table.Th>{t('attendanceImport.count')}</Table.Th>
              <Table.Th>{t('attendanceImport.period')}</Table.Th>
              <Table.Th>{t('attendanceImport.branches')}</Table.Th>
              {manage && <Table.Th w={1} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((h) => (
              <Table.Tr key={`${h.deviceCode}|${h.reason}`}>
                <Table.Td dir="ltr" ta="start">
                  {h.deviceCode}
                </Table.Td>
                <Table.Td>
                  <Badge color={h.reason === 'ambiguous' ? 'orange' : 'yellow'} variant="light">
                    {t(`attendanceImport.reasons.${h.reason}`)}
                  </Badge>
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {h.rows}
                </Table.Td>
                <Table.Td>
                  {fmt.date(h.firstAt)} → {fmt.date(h.lastAt)}
                </Table.Td>
                <Table.Td dir="ltr" ta="start">
                  {(h.branches ?? []).join(', ') || '—'}
                </Table.Td>
                {manage && (
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button size="compact-xs" variant="default" onClick={() => setResolving(h)}>
                        {t('attendanceImport.resolve')}
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => confirmDiscard(h)}
                      >
                        {t('attendanceImport.discard')}
                      </Button>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {resolving && <ResolveModal row={resolving} onClose={() => setResolving(null)} />}
    </>
  );
};

/** مركز استيراد البصمات: رفع ← معاينة ← تأكيد، والدفعات (مع التراجع)، والمحجوز (ربط أو تجاهل). */
export const ImportPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canUpload = can('attendance.import.create');
  return (
    <Stack>
      <Title order={2}>{t('nav.attendanceImport')}</Title>
      <Tabs defaultValue={canUpload ? 'upload' : 'batches'}>
        <Tabs.List>
          {canUpload && <Tabs.Tab value="upload">{t('attendanceImport.tabs.upload')}</Tabs.Tab>}
          <Tabs.Tab value="batches">{t('attendanceImport.tabs.batches')}</Tabs.Tab>
          <Tabs.Tab value="held">{t('attendanceImport.tabs.held')}</Tabs.Tab>
        </Tabs.List>
        {canUpload && (
          <Tabs.Panel value="upload" pt="md">
            <UploadTab />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="batches" pt="md">
          <BatchesTab />
        </Tabs.Panel>
        <Tabs.Panel value="held" pt="md">
          <HeldTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
