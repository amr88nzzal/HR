import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import { Badge, Button, Checkbox, DirectionProvider, Group, MantineProvider, Modal, NumberInput, Select, Table, Tabs, Textarea, TextInput, Title, Paper, Stack, createTheme } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import 'dayjs/locale/ar';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { departments, employees } from '../../data';

const theme = createTheme({ fontFamily: 'Amiri, "Noto Naskh Arabic", system-ui, sans-serif' });

const App = () => {
  const [opened, { open, close }] = useDisclosure(false);
  const [sel, setSel] = useState<number[]>([2]);
  const [date, setDate] = useState<string | null>('2019-03-01');
  return (
    <Stack p="md" maw={1100} mx="auto">
      <Group justify="space-between">
        <Title order={2}>الموظفون</Title>
        <Button onClick={open}>إضافة موظف</Button>
      </Group>
      <Tabs defaultValue="list">
        <Tabs.List><Tabs.Tab value="list">القائمة</Tabs.Tab><Tabs.Tab value="org">الهيكل</Tabs.Tab><Tabs.Tab value="docs">الأرشيف</Tabs.Tab></Tabs.List>
      </Tabs>
      <Paper withBorder p="md">
        <Group mb="sm" grow>
          <TextInput label="بحث" placeholder="الاسم أو الرقم الوظيفي" />
          <Select label="القسم" data={departments} clearable placeholder="الكل" />
          <DatePickerInput label="تاريخ التعيين من" locale="ar" value={date} onChange={setDate} valueFormat="YYYY-MM-DD" />
        </Group>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead><Table.Tr><Table.Th /><Table.Th>الرقم</Table.Th><Table.Th>الاسم</Table.Th><Table.Th>القسم</Table.Th><Table.Th>المسمى</Table.Th><Table.Th>التعيين</Table.Th><Table.Th ta="end">الراتب</Table.Th><Table.Th>الحالة</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {employees.map((e) => (
              <Table.Tr key={e.id} bg={sel.includes(e.id) ? 'var(--mantine-color-blue-light)' : undefined}>
                <Table.Td><Checkbox checked={sel.includes(e.id)} onChange={(ev) => setSel(ev.currentTarget.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} aria-label="تحديد" /></Table.Td>
                <Table.Td dir="ltr">{e.no}</Table.Td><Table.Td>{e.name}</Table.Td><Table.Td>{e.dept}</Table.Td><Table.Td>{e.title}</Table.Td>
                <Table.Td dir="ltr">{e.hired}</Table.Td><Table.Td ta="end" dir="ltr">{e.salary}</Table.Td>
                <Table.Td><Badge color={e.status === 'نشط' ? 'green' : e.status === 'إجازة' ? 'yellow' : 'gray'}>{e.status}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={opened} onClose={close} title="موظف جديد" size="lg">
        <Stack>
          <Group grow><TextInput label="الاسم الكامل" required /><TextInput label="الرقم الوطني" required error="الرقم الوطني مطلوب" /></Group>
          <Group grow><Select label="القسم" data={departments} searchable /><DatePickerInput label="تاريخ التعيين" locale="ar" valueFormat="YYYY-MM-DD" /></Group>
          <NumberInput label="الراتب الأساسي" decimalScale={3} fixedDecimalScale thousandSeparator="," />
          <Textarea label="ملاحظات" />
          <Group justify="flex-start"><Button>حفظ</Button><Button variant="default" onClick={close}>إلغاء</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DirectionProvider initialDirection="rtl">
      <MantineProvider theme={theme}><App /></MantineProvider>
    </DirectionProvider>
  </StrictMode>,
);
