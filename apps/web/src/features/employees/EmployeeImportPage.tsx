import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Pagination,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import type { ImportReport, ImportRowResult } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { exportCsv } from '../../lib/export';

const PAGE = 50;

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const Stat = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <Card withBorder padding="sm" miw={110}>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Text fw={700} size="xl" c={color}>
      {value}
    </Text>
  </Card>
);

/** استيراد الموظفين من Excel: قالب ← تحقق (Dry Run) ← مراجعة ← تنفيذ بالملف نفسه. */
export const EmployeeImportPage = () => {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [validatedFile, setValidatedFile] = useState<File | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<'template' | 'validate' | 'run' | null>(null);

  const template = async () => {
    setBusy('template');
    try {
      download(await api.blob('/employee-import/template'), 'employees-template.xlsx');
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  };

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'validate' : 'run');
    try {
      const res = await api.upload<ImportReport>('/employee-import', file, {
        query: { dryRun, skipErrors },
      });
      setReport(res.data);
      setPage(1);
      if (dryRun) setValidatedFile(file);
      else if (res.data.committed)
        notifications.show({
          color: 'teal',
          message: t('hr.import.committed', {
            created: res.data.created,
            updated: res.data.updated,
            failed: res.data.failed,
          }),
        });
      else notifications.show({ color: 'orange', message: t('hr.import.notCommitted') });
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  };

  const rows = (report?.rows ?? []).filter((r) => !errorsOnly || r.errors.length > 0);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const sameFile = !!file && file === validatedFile;
  const canRun =
    !!report &&
    report.dryRun &&
    sameFile &&
    report.total > 0 &&
    (report.failed === 0 || skipErrors);
  const statusLabel = (a: ImportRowResult['action']) => t(`hr.import.${a}`);

  const exportErrors = () =>
    exportCsv(
      'import-errors',
      [
        { header: t('hr.import.row'), value: (r: ImportRowResult) => r.row },
        { header: t('hr.import.employeeNo'), value: (r) => r.employeeNo ?? '' },
        { header: t('hr.import.name'), value: (r) => r.name },
        { header: t('hr.import.notes'), value: (r) => [...r.errors, ...r.warnings].join(' | ') },
      ],
      (report?.rows ?? []).filter((r) => r.errors.length > 0),
    );

  return (
    <Stack>
      <Title order={2}>{t('nav.employeeImport')}</Title>
      <Alert color="blue" variant="light">
        <Stack gap={4}>
          <Text size="sm">{t('hr.import.intro')}</Text>
          <Text size="sm" c="dimmed">
            {t('hr.import.rules')}
          </Text>
        </Stack>
      </Alert>
      <Group align="flex-end">
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          loading={busy === 'template'}
          onClick={() => void template()}
        >
          {t('hr.import.template')}
        </Button>
        <FileInput
          label={t('hr.import.file')}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          value={file}
          onChange={(f) => {
            setFile(f);
            if (f !== validatedFile) setReport(null);
          }}
          clearable
          w={320}
        />
        <Button
          leftSection={<IconUpload size={16} />}
          disabled={!file}
          loading={busy === 'validate'}
          onClick={() => void send(true)}
        >
          {t('hr.import.validate')}
        </Button>
      </Group>

      {report && (
        <Stack>
          <Group>
            <Stat label={t('hr.import.total')} value={report.total} color="dark" />
            <Stat label={t('hr.import.toCreate')} value={report.created} color="teal" />
            <Stat label={t('hr.import.toUpdate')} value={report.updated} color="blue" />
            <Stat label={t('hr.import.failed')} value={report.failed} color="red" />
          </Group>
          {report.unknownColumns.length > 0 && (
            <Alert color="yellow" variant="light">
              {t('hr.import.unknownColumns', { cols: report.unknownColumns.join('، ') })}
            </Alert>
          )}
          {report.dryRun ? (
            <Alert color="gray" variant="light">
              {sameFile ? t('hr.import.validated') : t('hr.import.fileChanged')}
            </Alert>
          ) : report.committed ? (
            <Alert color="teal" variant="light">
              {t('hr.import.committed', {
                created: report.created,
                updated: report.updated,
                failed: report.failed,
              })}
            </Alert>
          ) : (
            <Alert color="orange" variant="light">
              {t('hr.import.notCommitted')}
            </Alert>
          )}
          <Group justify="space-between">
            <Group>
              <Switch
                label={t('hr.import.skipErrors')}
                checked={skipErrors}
                onChange={(e) => setSkipErrors(e.currentTarget.checked)}
              />
              <Switch
                label={t('hr.import.errorsOnly')}
                checked={errorsOnly}
                onChange={(e) => {
                  setErrorsOnly(e.currentTarget.checked);
                  setPage(1);
                }}
              />
            </Group>
            <Group>
              {report.failed > 0 && (
                <Button variant="default" size="xs" onClick={exportErrors}>
                  {t('hr.import.downloadErrors')}
                </Button>
              )}
              <Button
                color="teal"
                disabled={!canRun}
                loading={busy === 'run'}
                onClick={() => void send(false)}
              >
                {t('hr.import.run')}
              </Button>
            </Group>
          </Group>
          <Table withTableBorder striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('hr.import.row')}</Table.Th>
                <Table.Th>{t('hr.import.result')}</Table.Th>
                <Table.Th>{t('hr.import.employeeNo')}</Table.Th>
                <Table.Th>{t('hr.import.name')}</Table.Th>
                <Table.Th>{t('hr.import.notes')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((r) => (
                <Table.Tr key={r.row}>
                  <Table.Td>{r.row}</Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={r.action === 'error' ? 'red' : r.action === 'create' ? 'teal' : 'blue'}
                    >
                      {statusLabel(r.action)}
                    </Badge>
                  </Table.Td>
                  <Table.Td dir="ltr" style={{ textAlign: 'start' }}>
                    {r.employeeNo ?? '—'}
                  </Table.Td>
                  <Table.Td>{r.name || '—'}</Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      {r.errors.map((e) => (
                        <Text key={e} size="sm" c="red">
                          {e}
                        </Text>
                      ))}
                      {r.warnings.map((w) => (
                        <Text key={w} size="sm" c="orange">
                          {w}
                        </Text>
                      ))}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rows.length > PAGE && (
            <Pagination
              total={Math.ceil(rows.length / PAGE)}
              value={page}
              onChange={setPage}
              mx="auto"
            />
          )}
        </Stack>
      )}
    </Stack>
  );
};
