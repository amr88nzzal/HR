import { Button, Group, Modal, Select, Stack, Table, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';
import { useFormat } from '../../lib/useFormat';
import { EmployeeSelect } from '../employees/EmployeeSelect';

type Assignment = {
  id: string;
  policyId: string;
  scope: 'company' | 'branch' | 'department' | 'employee';
  scopeRef: string | null;
  validFrom: string;
};
type Named = { id: string; nameAr: string; nameEn: string | null };
const SCOPES = ['company', 'branch', 'department', 'employee'] as const;

const AddModal = ({ policies, onClose }: { policies: Named[]; onClose: () => void }) => {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('company');
  const [ref, setRef] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const branches = useList<Named>('/branches', { pageSize: 200 }, scope === 'branch');
  const depts = useList<Named>('/departments', { pageSize: 200 }, scope === 'department');
  const refOptions = (scope === 'branch' ? branches : depts).data?.data ?? [];
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/leave-policy-assignments', {
          policyId,
          scope,
          ...(scope !== 'company' ? { scopeRef: ref } : {}),
          ...(from ? { validFrom: from } : {}),
        })
      ).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('table.saved') });
      await qc.invalidateQueries({ queryKey: ['/leave-policy-assignments'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal opened onClose={onClose} title={t('leave.addAssignment')} centered>
      <Stack>
        <Select
          label={t('leave.policy')}
          required
          data={policies.map((p) => ({ value: p.id, label: localName(p, i18n.language) }))}
          value={policyId}
          onChange={setPolicyId}
        />
        <Select
          label={t('leave.scope')}
          allowDeselect={false}
          data={SCOPES.map((s) => ({ value: s, label: t(`leave.scopes.${s}`) }))}
          value={scope}
          onChange={(v) => {
            setScope((v as (typeof SCOPES)[number]) ?? 'company');
            setRef(null);
          }}
        />
        {(scope === 'branch' || scope === 'department') && (
          <Select
            label={t('leave.scopeRef')}
            required
            data={refOptions.map((r) => ({ value: r.id, label: localName(r, i18n.language) }))}
            value={ref}
            onChange={setRef}
          />
        )}
        {scope === 'employee' && (
          <EmployeeSelect label={t('leave.employee')} value={ref} onChange={setRef} />
        )}
        <TextInput
          type="date"
          dir="ltr"
          label={t('leave.validFrom')}
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!policyId || (scope !== 'company' && !ref)}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

/** ربط السياسات بنطاقها (شركة/فرع/قسم/موظف)؛ الأخص يغلب. */
export const AssignmentsPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const policies = useList<Named>('/leave-policies', { pageSize: 200 });
  const branches = useList<Named>('/branches', { pageSize: 200 });
  const depts = useList<Named>('/departments', { pageSize: 200 });
  const list = useQuery({
    queryKey: ['/leave-policy-assignments', 'list'],
    queryFn: async () => (await api.get<Assignment[]>('/leave-policy-assignments')).data,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/leave-policy-assignments/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/leave-policy-assignments'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const find = (rows: Named[] | undefined, id: string | null) => {
    const r = rows?.find((x) => x.id === id);
    return r ? localName(r, i18n.language) : '—';
  };
  const refName = (a: Assignment) =>
    a.scope === 'company'
      ? t('leave.scopes.company')
      : a.scope === 'branch'
        ? find(branches.data?.data, a.scopeRef)
        : a.scope === 'department'
          ? find(depts.data?.data, a.scopeRef)
          : (a.scopeRef ?? '—').slice(0, 8);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.leaveAssignments')}</Title>
        {can('leave.policy.create') && (
          <Button onClick={() => setAdding(true)}>{t('leave.addAssignment')}</Button>
        )}
      </Group>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('leave.policy')}</Table.Th>
            <Table.Th>{t('leave.scope')}</Table.Th>
            <Table.Th>{t('leave.scopeRef')}</Table.Th>
            <Table.Th>{t('leave.validFrom')}</Table.Th>
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>{find(policies.data?.data, a.policyId)}</Table.Td>
              <Table.Td>{t(`leave.scopes.${a.scope}`)}</Table.Td>
              <Table.Td>{refName(a)}</Table.Td>
              <Table.Td>{fmt.date(a.validFrom)}</Table.Td>
              <Table.Td>
                {can('leave.policy.delete') && (
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="light"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: t('table.delete'),
                        labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
                        confirmProps: { color: 'red' },
                        onConfirm: () => remove.mutate(a.id),
                      })
                    }
                  >
                    {t('table.delete')}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {adding && <AddModal policies={policies.data?.data ?? []} onClose={() => setAdding(false)} />}
    </Stack>
  );
};
