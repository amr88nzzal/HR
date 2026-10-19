import { Alert, Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { useFormat } from '../../lib/useFormat';
import { DetailDrawer, NewActionModal } from './AdminActionsPage';
import { categoryColor, statusColor, type ActionRow, type ActionType } from './types';

/**
 * تبويب الإجراءات الإدارية في بطاقة الموظف: سجلّه الكامل مع إضافة إجراء جديد.
 * Admin-actions tab on the employee card: full record plus adding a new action.
 */
export const EmployeeActionsPanel = ({ employeeId }: { employeeId: string }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const types = useQuery({
    queryKey: ['/admin-action-types'],
    enabled: can('admin_actions.type.read'),
    queryFn: async () => (await api.get<ActionType[]>('/admin-action-types')).data,
  });
  const q = useQuery({
    queryKey: ['/admin-actions', 'employee', employeeId],
    queryFn: async () =>
      (
        await api.get<ActionRow[]>('/admin-actions', {
          employeeId,
          pageSize: 100,
          sort: '-actionDate',
        })
      ).data,
  });
  const rows = q.data ?? [];
  const canAdd =
    (can('admin_actions.action.create') || can('admin_actions.action.propose')) &&
    can('admin_actions.type.read');
  return (
    <Stack>
      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {t('adminActions.employeeTabHint')}
        </Text>
        {canAdd && <Button onClick={() => setCreating(true)}>{t('adminActions.new')}</Button>}
      </Group>
      {q.isError && <Alert color="red">{errorMessage(q.error, t)}</Alert>}
      {!q.isLoading && rows.length === 0 && (
        <Text c="dimmed">{t('adminActions.employeeEmpty')}</Text>
      )}
      {rows.length > 0 && (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('adminActions.cols.type')}</Table.Th>
              <Table.Th>{t('adminActions.cols.title')}</Table.Th>
              <Table.Th>{t('adminActions.cols.actionDate')}</Table.Th>
              <Table.Th>{t('adminActions.cols.status')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>
                <Table.Td>
                  <Badge color={categoryColor[r.category]} variant="light">
                    {r.typeName}
                  </Badge>
                </Table.Td>
                <Table.Td>{r.title}</Table.Td>
                <Table.Td>{fmt.date(r.actionDate)}</Table.Td>
                <Table.Td>
                  <Badge color={statusColor[r.status]}>
                    {t(`adminActions.statuses.${r.status}`)}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {creating && (
        <NewActionModal
          types={types.data ?? []}
          employeeId={employeeId}
          onClose={() => setCreating(false)}
        />
      )}
      {open && <DetailDrawer id={open} onClose={() => setOpen(null)} />}
    </Stack>
  );
};
