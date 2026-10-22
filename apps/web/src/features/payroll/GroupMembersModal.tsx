import { Alert, Badge, Button, Group, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { EmployeeSelect } from '../employees/EmployeeSelect';

type Member = {
  id: string;
  employeeNo: string | null;
  employeeName: string;
  validFrom: string;
  validTo: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * أعضاء مجموعة الدفع: من لا تعيين له يدخل المجموعة الافتراضية تلقائياً.
 * التعيين الجديد يُنهي تعيين الموظف السابق قبل تاريخه بيوم.
 * Pay group members: employees without an assignment fall into the default group.
 * A new assignment ends the employee's previous one the day before its start.
 */
export const GroupMembersModal = ({
  groupId,
  groupName,
  isDefault,
  canEdit,
  onClose,
}: {
  groupId: string;
  groupName: string;
  isDefault: boolean;
  canEdit: boolean;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['/payroll', 'groups', groupId, 'assignments'];
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [validFrom, setValidFrom] = useState(today());
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<Member[]>(`/payroll/groups/${groupId}/assignments`)).data,
  });
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e, t) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['/payroll', 'groups'] });
  const add = useMutation({
    mutationFn: async () =>
      api.post(`/payroll/groups/${groupId}/assignments`, { employeeId, validFrom }),
    onSuccess: async () => {
      setEmployeeId(null);
      notifications.show({ color: 'teal', message: t('payroll.groupMembers.added') });
      await refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.del(`/payroll/groups/${groupId}/assignments/${id}`),
    onSuccess: refresh,
    onError: fail,
  });
  const now = today();
  const isCurrent = (m: Member) => m.validFrom <= now && (!m.validTo || m.validTo >= now);
  return (
    <Modal
      opened
      onClose={onClose}
      title={`${t('payroll.groupMembers.title')}: ${groupName}`}
      size="lg"
    >
      <Stack>
        {isDefault && <Alert color="blue">{t('payroll.groupMembers.defaultHint')}</Alert>}
        {canEdit && (
          <Group align="flex-end" wrap="nowrap">
            <div style={{ flex: 1 }}>
              <EmployeeSelect
                label={t('payroll.groupMembers.employee')}
                value={employeeId}
                onChange={setEmployeeId}
              />
            </div>
            <TextInput
              type="date"
              label={t('payroll.groupMembers.from')}
              value={validFrom}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setValidFrom(value);
              }}
            />
            <Button
              disabled={!employeeId || !validFrom}
              loading={add.isPending}
              onClick={() => add.mutate()}
            >
              {t('payroll.groupMembers.add')}
            </Button>
          </Group>
        )}
        <Table withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('payroll.groupMembers.employee')}</Table.Th>
              <Table.Th>{t('payroll.groupMembers.from')}</Table.Th>
              <Table.Th>{t('payroll.groupMembers.to')}</Table.Th>
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(list.data ?? []).map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  {m.employeeNo} {m.employeeName}{' '}
                  {isCurrent(m) && (
                    <Badge size="xs" color="teal" variant="light">
                      {t('payroll.groupMembers.current')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td dir="ltr">{m.validFrom}</Table.Td>
                <Table.Td dir="ltr">{m.validTo ?? '—'}</Table.Td>
                <Table.Td>
                  {canEdit && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      loading={remove.isPending && remove.variables === m.id}
                      onClick={() => remove.mutate(m.id)}
                    >
                      {t('payroll.remove')}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {list.data?.length === 0 && (
          <Text size="sm" c="dimmed">
            {t('payroll.groupMembers.empty')}
          </Text>
        )}
      </Stack>
    </Modal>
  );
};
