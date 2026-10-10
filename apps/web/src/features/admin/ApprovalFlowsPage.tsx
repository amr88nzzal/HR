import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPROVER_TYPES, type Condition } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';

type ApproverType = (typeof APPROVER_TYPES)[number];
type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
const OPS: Op[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];

type StepDraft = {
  key: number;
  nameAr: string;
  nameEn: string;
  approverType: ApproverType;
  approverRef: string | null;
  mode: 'any' | 'all';
  /** شرط بسيط قابل للتحرير، أو raw لشرط مركّب يُحفظ كما هو */
  cond: { field: string; op: Op; value: string } | null;
  raw: Condition | null;
};
type FlowRow = {
  id: string;
  code: string;
  requestType: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
  version: number;
  stepCount: number;
};
type FlowFull = FlowRow & {
  steps: {
    nameAr: string;
    nameEn: string | null;
    approverType: ApproverType;
    approverRef: string | null;
    mode: 'any' | 'all';
    condition: Condition | null;
  }[];
};
type Options = {
  roles: { id: string; code: string; nameAr: string; nameEn: string | null }[];
  users: { id: string; displayName: string; email: string }[];
};

let seq = 0;
const blankStep = (): StepDraft => ({
  key: (seq += 1),
  nameAr: '',
  nameEn: '',
  approverType: 'direct_manager',
  approverRef: null,
  mode: 'any',
  cond: null,
  raw: null,
});

const parseValue = (v: string): string | number | boolean => {
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
};

const fromFlow = (s: FlowFull['steps'][number]): StepDraft => {
  const c = s.condition;
  const simple = c && 'field' in c && !Array.isArray(c.value) && c.op !== 'in';
  return {
    key: (seq += 1),
    nameAr: s.nameAr,
    nameEn: s.nameEn ?? '',
    approverType: s.approverType,
    approverRef: s.approverRef,
    mode: s.mode,
    cond: simple ? { field: c.field, op: c.op as Op, value: String(c.value) } : null,
    raw: c && !simple ? c : null,
  };
};

const Editor = ({ flowId, onClose }: { flowId: string | 'new'; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ['/approval-flows', 'one', flowId],
    queryFn: async () => (await api.get<FlowFull>(`/approval-flows/${flowId}`)).data,
    enabled: flowId !== 'new',
  });
  const options = useQuery({
    queryKey: ['/approval-flows', 'options'],
    queryFn: async () => (await api.get<Options>('/approval-flows/options')).data,
  });
  const types = useQuery({
    queryKey: ['/approval-flows', 'request-types'],
    queryFn: async () =>
      (
        await api.get<{ key: string; nameAr: string; nameEn: string | null }[]>(
          '/approval-flows/request-types',
        )
      ).data,
  });
  const [form, setForm] = useState<{
    code: string;
    requestType: string;
    nameAr: string;
    nameEn: string;
    isActive: boolean;
    steps: StepDraft[];
  }>();
  const base =
    form ??
    (flowId === 'new'
      ? {
          code: '',
          requestType: 'general',
          nameAr: '',
          nameEn: '',
          isActive: true,
          steps: [blankStep()],
        }
      : existing.data
        ? {
            code: existing.data.code,
            requestType: existing.data.requestType,
            nameAr: existing.data.nameAr,
            nameEn: existing.data.nameEn ?? '',
            isActive: existing.data.isActive,
            steps: existing.data.steps.map(fromFlow),
          }
        : undefined);
  const edit = (patch: Partial<NonNullable<typeof base>>) => base && setForm({ ...base, ...patch });
  const setStep = (key: number, patch: Partial<StepDraft>) =>
    base && edit({ steps: base.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => {
    if (!base) return;
    const steps = [...base.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j] as StepDraft, steps[i] as StepDraft];
    edit({ steps });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!base) return;
      const steps = base.steps.map((s) => ({
        nameAr: s.nameAr,
        nameEn: s.nameEn || null,
        approverType: s.approverType,
        approverRef: s.approverType === 'role' || s.approverType === 'user' ? s.approverRef : null,
        mode: s.mode,
        condition: s.cond
          ? { field: s.cond.field, op: s.cond.op, value: parseValue(s.cond.value) }
          : s.raw,
      }));
      const common = {
        requestType: base.requestType,
        nameAr: base.nameAr,
        nameEn: base.nameEn || null,
        isActive: base.isActive,
        steps,
      };
      if (flowId === 'new') await api.post('/approval-flows', { code: base.code, ...common });
      else
        await api.put(`/approval-flows/${flowId}`, { ...common, version: existing.data?.version });
    },
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('approvalFlows.saved') });
      await qc.invalidateQueries({ queryKey: ['/approval-flows'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });

  const valid =
    !!base &&
    !!base.nameAr.trim() &&
    (flowId !== 'new' || !!base.code.trim()) &&
    base.steps.length > 0 &&
    base.steps.every(
      (s) =>
        s.nameAr.trim() &&
        (!['role', 'user'].includes(s.approverType) || s.approverRef) &&
        (!s.cond || s.cond.field.trim()),
    );

  return (
    <Modal
      opened
      onClose={onClose}
      title={flowId === 'new' ? t('approvalFlows.new') : t('approvalFlows.edit')}
      size="xl"
      centered
    >
      {base && (
        <Stack>
          <Group grow align="flex-start">
            <TextInput
              label={t('approvalFlows.code')}
              value={base.code}
              disabled={flowId !== 'new'}
              onChange={(e) => edit({ code: e.currentTarget.value })}
              dir="ltr"
            />
            <Select
              label={t('approvalFlows.requestType')}
              value={base.requestType}
              onChange={(v) => v && edit({ requestType: v })}
              data={(types.data ?? []).map((x) => ({
                value: x.key,
                label: `${x.nameAr} (${x.key})`,
              }))}
              allowDeselect={false}
            />
          </Group>
          <Group grow>
            <TextInput
              label={t('approvalFlows.nameAr')}
              value={base.nameAr}
              onChange={(e) => edit({ nameAr: e.currentTarget.value })}
            />
            <TextInput
              label={t('approvalFlows.nameEn')}
              value={base.nameEn}
              onChange={(e) => edit({ nameEn: e.currentTarget.value })}
            />
          </Group>
          <Switch
            label={t('approvalFlows.active')}
            checked={base.isActive}
            onChange={(e) => edit({ isActive: e.currentTarget.checked })}
          />
          <Text fw={600}>{t('approvalFlows.steps')}</Text>
          {base.steps.map((s, i) => (
            <Card key={s.key} withBorder padding="sm">
              <Stack gap="xs">
                <Group align="flex-end">
                  <Badge>{i + 1}</Badge>
                  <TextInput
                    style={{ flex: 1 }}
                    label={t('approvalFlows.stepName')}
                    value={s.nameAr}
                    onChange={(e) => setStep(s.key, { nameAr: e.currentTarget.value })}
                  />
                  <ActionIcon
                    variant="subtle"
                    aria-label={t('approvalFlows.moveUp')}
                    onClick={() => move(i, -1)}
                  >
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    aria-label={t('approvalFlows.moveDown')}
                    onClick={() => move(i, 1)}
                  >
                    <IconArrowDown size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={t('approvalFlows.removeStep')}
                    disabled={base.steps.length === 1}
                    onClick={() => edit({ steps: base.steps.filter((x) => x.key !== s.key) })}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
                <Group grow align="flex-end">
                  <Select
                    label={t('approvalFlows.approverType')}
                    value={s.approverType}
                    allowDeselect={false}
                    onChange={(v) =>
                      v && setStep(s.key, { approverType: v as ApproverType, approverRef: null })
                    }
                    data={APPROVER_TYPES.map((x) => ({
                      value: x,
                      label: t(`approvalFlows.types.${x}`),
                    }))}
                  />
                  {s.approverType === 'role' && (
                    <Select
                      label={t('approvalFlows.approver')}
                      value={s.approverRef}
                      onChange={(v) => setStep(s.key, { approverRef: v })}
                      data={(options.data?.roles ?? []).map((r) => ({
                        value: r.id,
                        label: r.nameAr,
                      }))}
                    />
                  )}
                  {s.approverType === 'user' && (
                    <Select
                      label={t('approvalFlows.approver')}
                      value={s.approverRef}
                      searchable
                      onChange={(v) => setStep(s.key, { approverRef: v })}
                      data={(options.data?.users ?? []).map((u) => ({
                        value: u.id,
                        label: u.displayName,
                      }))}
                    />
                  )}
                  <Select
                    label={t('approvalFlows.mode')}
                    value={s.mode}
                    allowDeselect={false}
                    onChange={(v) => v && setStep(s.key, { mode: v as 'any' | 'all' })}
                    data={(['any', 'all'] as const).map((m) => ({
                      value: m,
                      label: t(`approvalFlows.modes.${m}`),
                    }))}
                  />
                </Group>
                <Group align="flex-end" gap="xs">
                  <Text size="sm" fw={500}>
                    {t('approvalFlows.condition')}:
                  </Text>
                  {s.raw ? (
                    <Code>{JSON.stringify(s.raw)}</Code>
                  ) : s.cond ? (
                    <>
                      <TextInput
                        aria-label={t('approvalFlows.field')}
                        placeholder={t('approvalFlows.field')}
                        value={s.cond.field}
                        dir="ltr"
                        w={140}
                        onChange={(e) =>
                          setStep(s.key, {
                            cond: {
                              ...(s.cond as NonNullable<StepDraft['cond']>),
                              field: e.currentTarget.value,
                            },
                          })
                        }
                      />
                      <Select
                        aria-label={t('approvalFlows.op')}
                        value={s.cond.op}
                        allowDeselect={false}
                        w={150}
                        onChange={(v) =>
                          v &&
                          setStep(s.key, {
                            cond: { ...(s.cond as NonNullable<StepDraft['cond']>), op: v as Op },
                          })
                        }
                        data={OPS.map((o) => ({ value: o, label: t(`approvalFlows.ops.${o}`) }))}
                      />
                      <TextInput
                        aria-label={t('approvalFlows.value')}
                        placeholder={t('approvalFlows.value')}
                        value={s.cond.value}
                        dir="ltr"
                        w={120}
                        onChange={(e) =>
                          setStep(s.key, {
                            cond: {
                              ...(s.cond as NonNullable<StepDraft['cond']>),
                              value: e.currentTarget.value,
                            },
                          })
                        }
                      />
                    </>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {t('approvalFlows.noCondition')}
                    </Text>
                  )}
                  {!s.raw && (
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() =>
                        setStep(s.key, {
                          cond: s.cond ? null : { field: 'amount', op: 'gte', value: '' },
                        })
                      }
                    >
                      {s.cond ? t('approvalFlows.noCondition') : t('approvalFlows.condition')}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Card>
          ))}
          <Text size="xs" c="dimmed">
            {t('approvalFlows.conditionHint')}
          </Text>
          <Group justify="space-between">
            <Button
              variant="light"
              onClick={() => edit({ steps: [...base.steps, blankStep()] })}
              disabled={base.steps.length >= 10}
            >
              {t('approvalFlows.addStep')}
            </Button>
            <Group>
              <Button variant="default" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

export const ApprovalFlowsPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('approvals.flow.manage');
  const [editing, setEditing] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['/approval-flows', 'list'],
    queryFn: async () => (await api.get<FlowRow[]>('/approval-flows')).data,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/approval-flows/${id}`)),
    onSuccess: async () => {
      notifications.show({ color: 'green', message: t('approvalFlows.deleted') });
      await qc.invalidateQueries({ queryKey: ['/approval-flows'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('approvalFlows.title')}</Title>
        {canManage && <Button onClick={() => setEditing('new')}>{t('approvalFlows.new')}</Button>}
      </Group>
      <Table.ScrollContainer minWidth={600}>
        <Table withTableBorder striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('approvalFlows.code')}</Table.Th>
              <Table.Th>{t('approvalFlows.nameAr')}</Table.Th>
              <Table.Th>{t('approvalFlows.requestType')}</Table.Th>
              <Table.Th>{t('approvalFlows.stepCount')}</Table.Th>
              <Table.Th />
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(list.data ?? []).map((f) => (
              <Table.Tr
                key={f.id}
                style={{ cursor: canManage ? 'pointer' : undefined }}
                onClick={() => canManage && setEditing(f.id)}
              >
                <Table.Td dir="ltr">{f.code}</Table.Td>
                <Table.Td>{f.nameAr}</Table.Td>
                <Table.Td dir="ltr">{f.requestType}</Table.Td>
                <Table.Td>{f.stepCount}</Table.Td>
                <Table.Td>
                  <Badge color={f.isActive ? 'teal' : 'gray'} variant="light">
                    {f.isActive ? t('approvalFlows.active') : '—'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {canManage && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t('approvalFlows.delete')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(t('approvalFlows.confirmDelete'))) remove.mutate(f.id);
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {editing && <Editor flowId={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
};
