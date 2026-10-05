import { Code, Group, Modal, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, type Row } from '../api/hooks';
import { DataTable, type Column } from '../components/DataTable';

const PAGE_SIZE = 50;
const ACTIONS = [
  'insert',
  'update',
  'delete',
  'login',
  'login_failed',
  'logout',
  'replace',
  'password_reset',
  'password_changed',
  'account_locked',
  'refresh_reuse_detected',
];

type Diff = Record<string, { old: unknown; new: unknown }>;
const isDiff = (v: unknown): v is Diff =>
  typeof v === 'object' &&
  v !== null &&
  Object.values(v).every((x) => typeof x === 'object' && x !== null && 'old' in x && 'new' in x);
const show = (v: unknown) =>
  v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);

const Details = ({ row, onClose }: { row: Row; onClose: () => void }) => {
  const { t } = useTranslation();
  const changes = row['changes'];
  return (
    <Modal
      opened
      onClose={onClose}
      title={`${String(row['entityType'])} · ${String(row['action'])}`}
      size="lg"
      centered
    >
      {isDiff(changes) ? (
        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>{t('auditPage.old')}</Table.Th>
              <Table.Th>{t('auditPage.new')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(changes).map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td fw={600} dir="ltr">
                  {k}
                </Table.Td>
                <Table.Td dir="auto">{show(v.old)}</Table.Td>
                <Table.Td dir="auto">{show(v.new)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Code block dir="ltr">
          {JSON.stringify(changes, null, 2)}
        </Code>
      )}
    </Modal>
  );
};

export const AuditPage = () => {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);

  const list = useList('/audit-logs', {
    page,
    pageSize: PAGE_SIZE,
    entityType: entityType || undefined,
    action: action ?? undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => (set(v), setPage(1));

  const columns: Column<Row>[] = [
    {
      key: 'when',
      header: t('auditPage.when'),
      render: (r) => new Date(String(r['occurredAt'])).toLocaleString(i18n.language),
    },
    {
      key: 'user',
      header: t('auditPage.user'),
      render: (r) => String(r['userName'] ?? t('auditPage.system')),
    },
    {
      key: 'entity',
      header: t('auditPage.entity'),
      render: (r) => String(r['entityType']),
      ltr: true,
    },
    {
      key: 'action',
      header: t('auditPage.action'),
      render: (r) =>
        t(`auditPage.actions.${String(r['action'])}`, { defaultValue: String(r['action']) }),
    },
  ];

  return (
    <Stack>
      <Title order={2}>{t('auditPage.title')}</Title>
      <Group align="flex-end">
        <TextInput
          label={t('auditPage.entity')}
          value={entityType}
          onChange={(e) => reset(setEntityType)(e.currentTarget.value)}
          dir="ltr"
          w={200}
        />
        <Select
          label={t('auditPage.action')}
          value={action}
          onChange={reset(setAction)}
          clearable
          placeholder={t('table.all')}
          data={ACTIONS.map((a) => ({ value: a, label: t(`auditPage.actions.${a}`) }))}
          w={200}
        />
        <TextInput
          type="date"
          label={t('auditPage.from')}
          value={from}
          onChange={(e) => reset(setFrom)(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label={t('auditPage.to')}
          value={to}
          onChange={(e) => reset(setTo)(e.currentTarget.value)}
        />
      </Group>
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
        onRowClick={(r) => r['changes'] && setDetail(r)}
      />
      {detail && <Details row={detail} onClose={() => setDetail(null)} />}
      <Text size="xs" c="dimmed">
        {t('auditPage.details')}: {t('table.edit')}
      </Text>
    </Stack>
  );
};
