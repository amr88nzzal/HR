import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { EmployeeSelect } from '../employees/EmployeeSelect';
import { parsePunchPaste } from './paste';

type BulkResult = {
  inserted: number;
  duplicates: number;
  errors: { row: number; error: string }[];
};

const PasteTab = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const rows = useMemo(() => parsePunchPaste(text), [text]);
  const good = rows.filter((r) => !r.error);
  const bad = rows.length - good.length;
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post<BulkResult>('/attendance/punches/bulk', {
          rows: good.map((r) => ({
            employeeNo: r.employeeNo,
            date: r.date,
            time: r.time,
            direction: r.direction,
          })),
        })
      ).data,
    onSuccess: async (r) => {
      notifications.show({
        color: r.errors.length ? 'orange' : 'teal',
        message: t('attendance.punches.result', {
          inserted: r.inserted,
          duplicates: r.duplicates,
          errors: r.errors.length,
        }),
      });
      setText('');
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('attendance.punches.hint')}
      </Text>
      <Textarea
        aria-label={t('attendance.punches.paste')}
        placeholder={t('attendance.punches.paste')}
        minRows={6}
        rows={8}
        dir="ltr"
        styles={{ input: { fontFamily: 'monospace' } }}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      {rows.length > 0 && (
        <>
          <Group gap="xs">
            <Badge color="teal" variant="light">
              {t('attendance.punches.valid')} {good.length}
            </Badge>
            {bad > 0 && (
              <Badge color="red" variant="light">
                {t('attendance.punches.invalid')} {bad}
              </Badge>
            )}
            {bad > 0 && (
              <Text size="xs" c="dimmed">
                {t('attendance.punches.onlyValid')}
              </Text>
            )}
          </Group>
          <Paper withBorder style={{ maxHeight: 320, overflow: 'auto' }}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('attendance.punches.line')}</Table.Th>
                  <Table.Th>{t('attendance.employee')}</Table.Th>
                  <Table.Th>{t('attendance.date')}</Table.Th>
                  <Table.Th>{t('attendance.punches.time')}</Table.Th>
                  <Table.Th>{t('attendance.punches.direction')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.slice(0, 500).map((r) => (
                  <Table.Tr
                    key={r.line}
                    bg={r.error ? 'var(--mantine-color-red-light)' : undefined}
                  >
                    <Table.Td dir="ltr" ta="start">
                      {r.line}
                    </Table.Td>
                    <Table.Td dir="ltr" ta="start">
                      {r.employeeNo || '—'}
                    </Table.Td>
                    <Table.Td dir="ltr" ta="start">
                      {r.date}
                    </Table.Td>
                    <Table.Td dir="ltr" ta="start">
                      {r.time}
                    </Table.Td>
                    <Table.Td>
                      {r.direction
                        ? t(`attendance.punches.${r.direction}`)
                        : t('attendance.punches.auto')}
                    </Table.Td>
                    <Table.Td>
                      {r.error && (
                        <Text size="xs" c="red">
                          {t(`attendance.punches.errors.${r.error}`)}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </>
      )}
      <Group justify="flex-end">
        <Button variant="default" disabled={!text} onClick={() => setText('')}>
          {t('attendance.punches.clear')}
        </Button>
        <Button
          disabled={good.length === 0 || good.length > 2000}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('attendance.punches.submit')} ({good.length})
        </Button>
      </Group>
    </Stack>
  );
};

const SingleTab = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [direction, setDirection] = useState('auto');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/attendance/punches', {
          employeeId,
          date,
          time,
          direction: direction === 'auto' ? null : direction,
          note: note.trim() || null,
        })
      ).data,
    onSuccess: async () => {
      notifications.show({ color: 'teal', message: t('attendance.saved') });
      setTime('');
      setNote('');
      await qc.invalidateQueries({ queryKey: ['/attendance'] });
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e, t) }),
  });
  const ok = !!employeeId && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  return (
    <Stack maw={420}>
      <EmployeeSelect
        label={t('attendance.employee')}
        value={employeeId}
        onChange={setEmployeeId}
      />
      <Group grow>
        <TextInput
          type="date"
          label={t('attendance.date')}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <TextInput
          type="time"
          label={t('attendance.punches.time')}
          value={time}
          onChange={(e) => setTime(e.currentTarget.value)}
        />
      </Group>
      <SegmentedControl
        value={direction}
        onChange={setDirection}
        data={[
          { value: 'auto', label: t('attendance.punches.auto') },
          { value: 'in', label: t('attendance.punches.in') },
          { value: 'out', label: t('attendance.punches.out') },
        ]}
      />
      <TextInput
        label={t('attendance.punches.note')}
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        maxLength={300}
      />
      <Group justify="flex-end">
        <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>
          {t('attendance.punches.add')}
        </Button>
      </Group>
    </Stack>
  );
};

/** إدخال البصمات يدوياً: لصق جماعي من Excel بمعاينة، أو بصمة منفردة. */
export const PunchEntryPage = () => {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t('attendance.punches.title')}</Title>
      <Alert variant="light">{t('attendance.punches.hint')}</Alert>
      <Tabs defaultValue="paste">
        <Tabs.List>
          <Tabs.Tab value="paste">{t('attendance.punches.paste')}</Tabs.Tab>
          <Tabs.Tab value="single">{t('attendance.punches.single')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="paste" pt="md">
          <PasteTab />
        </Tabs.Panel>
        <Tabs.Panel value="single" pt="md">
          <SingleTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
