import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  ColorInput,
  Group,
  Modal,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { segmentsValid } from '@hrms/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { localName } from '../../lib/names';

export type Segment = { startTime: string; endTime: string; endsNextDay: boolean };
export type ShiftRow = {
  id: string;
  version: number;
  code: string;
  nameAr: string;
  nameEn: string | null;
  color: string | null;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  isActive: boolean;
  segments: Segment[];
};

/** "08:00–16:00 | 16:00–20:00" مع علامة اليوم التالي للفترات الليلية. */
export const segmentsText = (segments: Segment[], nextDay = '+1'): string =>
  segments
    .map((s) => `${s.startTime}–${s.endTime}${s.endsNextDay ? ` ${nextDay}` : ''}`)
    .join(' | ');

type Form = {
  code: string;
  nameAr: string;
  nameEn: string;
  color: string;
  lateGraceMinutes: number | string;
  earlyLeaveGraceMinutes: number | string;
  isActive: boolean;
  segments: Segment[];
};

const EMPTY: Form = {
  code: '',
  nameAr: '',
  nameEn: '',
  color: '',
  lateGraceMinutes: 0,
  earlyLeaveGraceMinutes: 0,
  isActive: true,
  segments: [{ startTime: '08:00', endTime: '16:00', endsNextDay: false }],
};

const toForm = (s: ShiftRow): Form => ({
  code: s.code,
  nameAr: s.nameAr,
  nameEn: s.nameEn ?? '',
  color: s.color ?? '',
  lateGraceMinutes: s.lateGraceMinutes,
  earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
  isActive: s.isActive,
  segments: s.segments.map((x) => ({ ...x })),
});

const ShiftModal = ({ row, onClose }: { row: ShiftRow | null; onClose: () => void }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(row ? toForm(row) : EMPTY);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const setSeg = (i: number, patch: Partial<Segment>) =>
    set(
      'segments',
      f.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const complete = f.segments.every((s) => s.startTime && s.endTime);
  const overlapOk = complete && segmentsValid(f.segments);
  const body = () => ({
    code: f.code.trim(),
    nameAr: f.nameAr.trim(),
    nameEn: f.nameEn.trim() || null,
    color: f.color || null,
    lateGraceMinutes: Number(f.lateGraceMinutes) || 0,
    earlyLeaveGraceMinutes: Number(f.earlyLeaveGraceMinutes) || 0,
    isActive: f.isActive,
    segments: f.segments,
  });
  const save = useMutation({
    mutationFn: async () =>
      row
        ? (await api.patch(`/shifts/${row.id}`, { ...body(), version: row.version })).data
        : (await api.post('/shifts', body())).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendance.saved') });
      await qc.invalidateQueries({ queryKey: ['/shifts'] });
      onClose();
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      centered
      title={row ? t('attendanceShifts.edit') : t('attendanceShifts.add')}
    >
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput
            label={t('attendanceShifts.code')}
            required
            dir="ltr"
            value={f.code}
            onChange={(e) => set('code', e.currentTarget.value)}
          />
          <TextInput
            label={t('attendanceShifts.nameAr')}
            required
            value={f.nameAr}
            onChange={(e) => set('nameAr', e.currentTarget.value)}
          />
          <TextInput
            label={t('attendanceShifts.nameEn')}
            value={f.nameEn}
            onChange={(e) => set('nameEn', e.currentTarget.value)}
          />
          <ColorInput
            label={t('attendanceShifts.color')}
            format="hex"
            value={f.color}
            onChange={(v) => set('color', v)}
          />
          <NumberInput
            label={t('attendanceShifts.lateGrace')}
            min={0}
            max={240}
            allowDecimal={false}
            value={f.lateGraceMinutes}
            onChange={(v) => set('lateGraceMinutes', v)}
          />
          <NumberInput
            label={t('attendanceShifts.earlyGrace')}
            min={0}
            max={240}
            allowDecimal={false}
            value={f.earlyLeaveGraceMinutes}
            onChange={(v) => set('earlyLeaveGraceMinutes', v)}
          />
        </SimpleGrid>
        <Text fw={600} size="sm">
          {t('attendanceShifts.segments')}
        </Text>
        {f.segments.map((s, i) => (
          <Group key={i} align="flex-end" wrap="nowrap">
            <TextInput
              type="time"
              label={t('attendanceShifts.segStart')}
              value={s.startTime}
              onChange={(e) => setSeg(i, { startTime: e.currentTarget.value })}
            />
            <TextInput
              type="time"
              label={t('attendanceShifts.segEnd')}
              value={s.endTime}
              onChange={(e) => setSeg(i, { endTime: e.currentTarget.value })}
            />
            <Checkbox
              mb={8}
              label={t('attendanceShifts.endsNextDay')}
              checked={s.endsNextDay}
              onChange={(e) => setSeg(i, { endsNextDay: e.currentTarget.checked })}
            />
            <ActionIcon
              mb={4}
              color="red"
              variant="subtle"
              disabled={f.segments.length === 1}
              aria-label={t('attendanceShifts.removeSegment')}
              onClick={() =>
                set(
                  'segments',
                  f.segments.filter((_, j) => j !== i),
                )
              }
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        {complete && !overlapOk && (
          <Alert color="red" variant="light">
            {t('attendanceShifts.invalidSegments')}
          </Alert>
        )}
        <Group justify="space-between">
          <Button
            variant="default"
            size="xs"
            disabled={f.segments.length >= 4}
            onClick={() =>
              set('segments', [...f.segments, { startTime: '', endTime: '', endsNextDay: false }])
            }
          >
            {t('attendanceShifts.addSegment')}
          </Button>
          <Switch
            label={t('attendanceShifts.isActive')}
            checked={f.isActive}
            onChange={(e) => set('isActive', e.currentTarget.checked)}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!f.code.trim() || !f.nameAr.trim() || !overlapOk}
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

/** الورديات: فترة أو أكثر لكل وردية (مقسومة)، وتنتهي في اليوم التالي للدوام الليلي. */
export const ShiftsPage = () => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ShiftRow | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['/shifts', 'list'],
    queryFn: async () => (await api.get<ShiftRow[]>('/shifts')).data,
  });
  const del = useMutation({
    mutationFn: async (id: string) => void (await api.del(`/shifts/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/shifts'] }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const confirmDelete = (s: ShiftRow) =>
    modals.openConfirmModal({
      title: s.code,
      children: <Text size="sm">{t('attendanceShifts.deleteConfirm')}</Text>,
      labels: { confirm: t('table.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(s.id),
    });
  const rows = q.data ?? [];
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.attendanceShifts')}</Title>
        {can('attendance.shift.create') && (
          <Button onClick={() => setEditing('new')}>{t('attendanceShifts.add')}</Button>
        )}
      </Group>
      {!q.isLoading && rows.length === 0 && <Text c="dimmed">{t('attendanceShifts.none')}</Text>}
      {rows.length > 0 && (
        <Table.ScrollContainer minWidth={640}>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('attendanceShifts.code')}</Table.Th>
                <Table.Th>{t('attendanceShifts.nameAr')}</Table.Th>
                <Table.Th>{t('attendanceShifts.segments')}</Table.Th>
                <Table.Th>{t('attendanceShifts.lateGrace')}</Table.Th>
                <Table.Th>{t('attendanceShifts.earlyGrace')}</Table.Th>
                <Table.Th />
                <Table.Th w={1} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td dir="ltr" ta="start">
                    <Group gap={6} wrap="nowrap">
                      <span
                        aria-hidden
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          background: s.color ?? 'var(--mantine-color-gray-5)',
                        }}
                      />
                      {s.code}
                    </Group>
                  </Table.Td>
                  <Table.Td>{localName(s, i18n.language)}</Table.Td>
                  <Table.Td dir="ltr" ta="start">
                    {segmentsText(s.segments, t('attendanceShifts.nextDay'))}
                  </Table.Td>
                  <Table.Td dir="ltr" ta="start">
                    {s.lateGraceMinutes}
                  </Table.Td>
                  <Table.Td dir="ltr" ta="start">
                    {s.earlyLeaveGraceMinutes}
                  </Table.Td>
                  <Table.Td>
                    {!s.isActive && (
                      <Badge color="gray" variant="light">
                        {t('table.inactive')}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      {can('attendance.shift.update') && (
                        <Button size="compact-xs" variant="default" onClick={() => setEditing(s)}>
                          {t('table.edit')}
                        </Button>
                      )}
                      {can('attendance.shift.delete') && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          onClick={() => confirmDelete(s)}
                        >
                          {t('table.delete')}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {editing && (
        <ShiftModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
};
