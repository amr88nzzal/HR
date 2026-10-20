import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkAccountStatus } from '@hrms/shared';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type Result = {
  employeeId: string;
  employeeNo: string | null;
  name: string | null;
  email: string | null;
  status: BulkAccountStatus;
  reason?: string;
};
type Meta = { dryRun: boolean; total: number; created: number; ok: number };

const color: Record<BulkAccountStatus, string> = {
  created: 'teal',
  ok: 'blue',
  has_account: 'gray',
  no_email: 'orange',
  email_taken: 'red',
  duplicate_email: 'red',
  not_visible: 'gray',
  error: 'red',
};

/**
 * إنشاء حسابات بالجملة للموظفين المحدّدين: معاينة لكل موظف ثم تنفيذ (دعوة بالبريد المسجَّل).
 * Bulk account creation for the selected employees: per-employee preview, then run (email invite).
 */
export const BulkAccountsModal = ({
  ids,
  onClose,
  onDone,
}: {
  ids: string[];
  onClose: () => void;
  onDone: () => void;
}) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canRoles = can('identity.role.read');
  const roles = useList('/roles', {}, canRoles);
  const [roleId, setRoleId] = useState('');
  const [out, setOut] = useState<{ rows: Result[]; meta: Meta } | null>(null);
  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const r = await api.post<Result[]>('/employees/accounts/bulk', {
        employeeIds: ids,
        dryRun,
        ...(roleId ? { roleId } : {}),
      });
      return { rows: r.data, meta: r.meta as unknown as Meta };
    },
    onSuccess: async (r) => {
      setOut(r);
      if (!r.meta.dryRun) {
        notifications.show({
          color: 'teal',
          message: t('account.bulk.done', { count: r.meta.created }),
        });
        await qc.invalidateQueries({ queryKey: ['/employees'] });
        onDone();
      }
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const roleRows = (roles.data?.data ?? []) as { id: string; code: string; nameAr: string }[];
  // بعد التنفيذ الفعلي لا يعاد التنفيذ على النتيجة نفسها / no re-run after a real execution
  const executed = !!out && !out.meta.dryRun;
  return (
    <Modal
      opened
      onClose={onClose}
      title={t('account.bulk.title', { count: ids.length })}
      size="lg"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {t('account.bulk.hint')}
        </Text>
        {canRoles && roleRows.length > 0 && (
          <NativeSelect
            label={t('account.bulk.role')}
            description={t('account.bulk.roleHint')}
            value={roleId}
            onChange={(e) => {
              setRoleId(e.currentTarget.value);
              setOut(null);
            }}
            data={[
              { value: '', label: t('account.bulk.defaultRole') },
              ...roleRows.map((r) => ({ value: r.id, label: r.nameAr })),
            ]}
          />
        )}
        {out && (
          <>
            <Alert color={out.meta.dryRun ? 'blue' : 'teal'}>
              {out.meta.dryRun
                ? t('account.bulk.previewSummary', { ok: out.meta.ok, total: out.meta.total })
                : t('account.bulk.runSummary', {
                    created: out.meta.created,
                    total: out.meta.total,
                  })}
            </Alert>
            <Table withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('fields.employeeNo')}</Table.Th>
                  <Table.Th>{t('hr.emp.name')}</Table.Th>
                  <Table.Th>{t('account.email')}</Table.Th>
                  <Table.Th>{t('account.bulk.result')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {out.rows.map((r) => (
                  <Table.Tr key={r.employeeId}>
                    <Table.Td dir="ltr">{r.employeeNo ?? '—'}</Table.Td>
                    <Table.Td>{r.name ?? '—'}</Table.Td>
                    <Table.Td dir="ltr">{r.email ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={color[r.status]} variant="light">
                        {t(`account.bulk.statuses.${r.status}`)}
                      </Badge>
                      {r.reason && (
                        <Text size="xs" c="dimmed">
                          {r.reason}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {executed ? t('account.bulk.close') : t('common.cancel')}
          </Button>
          {!executed && (
            <>
              <Button
                variant="light"
                loading={run.isPending && run.variables === true}
                onClick={() => run.mutate(true)}
              >
                {t('account.bulk.preview')}
              </Button>
              <Button
                loading={run.isPending && run.variables === false}
                disabled={!out || out.meta.ok === 0}
                onClick={() => run.mutate(false)}
              >
                {t('account.bulk.run')}
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </Modal>
  );
};
