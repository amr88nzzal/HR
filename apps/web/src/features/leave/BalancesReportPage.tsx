import { csv, MultiFilter } from '../../components/MultiFilter';
import { Button, Group, Menu, Stack, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList } from '../../api/hooks';
import { DataTable, type Column } from '../../components/DataTable';
import { errorMessage } from '../../lib/errors';
import { exportCsv, exportXlsx, fetchAllRows, type ExportColumn } from '../../lib/export';
import { localName } from '../../lib/names';
import type { LeaveTypeRow } from './types';

type ReportRow = {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentNameAr: string | null;
  departmentNameEn: string | null;
  leaveTypeId: string;
  balance: string;
  taken: string;
  pending: string;
};
type Named = { id: string; nameAr: string; nameEn: string | null };
const PAGE_SIZE = 25;

/** تقرير أرصدة الإجازات لكل موظف ونوع (الرصيد، المستهلك هذه السنة، المحجوز المعلّق) مع تصدير. */
export const BalancesReportPage = () => {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [typeId, setTypeId] = useState<string[]>([]);
  const [deptId, setDeptId] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [exporting, setExporting] = useState(false);
  const types = useList<LeaveTypeRow>('/leave-types', { pageSize: 200 });
  const depts = useList<Named>('/departments', { pageSize: 200 });
  const query = {
    leaveTypeId: csv(typeId),
    departmentId: csv(deptId),
    q: debounced || undefined,
  };
  const list = useList<ReportRow>('/leave-balances/report', {
    ...query,
    page,
    pageSize: PAGE_SIZE,
  });
  const typeName = (id: string) => {
    const ty = types.data?.data.find((x) => x.id === id);
    return ty ? localName(ty, i18n.language) : '—';
  };
  const dept = (r: ReportRow) =>
    localName({ nameAr: r.departmentNameAr ?? '', nameEn: r.departmentNameEn }, i18n.language) ||
    '—';
  // لا معرّف في الصف: المفتاح مركّب (الموظف + النوع)
  const rows = (list.data?.data ?? []).map((r) => ({
    ...r,
    id: `${r.employeeId}:${r.leaveTypeId}`,
  }));
  const columns: Column<ReportRow>[] = [
    { key: 'no', header: t('fields.employeeNo'), ltr: true, render: (r) => r.employeeNo },
    { key: 'name', header: t('leave.employee'), render: (r) => r.employeeName },
    { key: 'dept', header: t('leave.department'), render: dept },
    { key: 'type', header: t('leave.type'), render: (r) => typeName(r.leaveTypeId) },
    { key: 'bal', header: t('leave.balance'), ltr: true, render: (r) => r.balance },
    { key: 'taken', header: t('leave.takenThisYear'), ltr: true, render: (r) => r.taken },
    { key: 'pend', header: t('leave.pendingHeld'), ltr: true, render: (r) => r.pending },
  ];
  const exportCols: ExportColumn<ReportRow>[] = [
    { header: columns[0]?.header ?? '', value: (r) => r.employeeNo },
    { header: columns[1]?.header ?? '', value: (r) => r.employeeName },
    { header: columns[2]?.header ?? '', value: dept },
    { header: columns[3]?.header ?? '', value: (r) => typeName(r.leaveTypeId) },
    { header: columns[4]?.header ?? '', value: (r) => Number(r.balance) },
    { header: columns[5]?.header ?? '', value: (r) => Number(r.taken) },
    { header: columns[6]?.header ?? '', value: (r) => Number(r.pending) },
  ];
  const doExport = async (kind: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const all = await fetchAllRows<ReportRow>('/leave-balances/report', query);
      const name = t('nav.leaveReport');
      if (kind === 'csv') exportCsv(name, exportCols, all);
      else await exportXlsx(name, exportCols, all, i18n.language === 'ar');
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setExporting(false);
    }
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('nav.leaveReport')}</Title>
        <Menu withinPortal>
          <Menu.Target>
            <Button variant="default" leftSection={<IconDownload size={16} />} loading={exporting}>
              {t('table.export')}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => void doExport('csv')}>{t('table.exportCsv')}</Menu.Item>
            <Menu.Item onClick={() => void doExport('xlsx')}>{t('table.exportXlsx')}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <Group>
        <TextInput
          placeholder={t('table.search')}
          w={240}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
        />
        <MultiFilter
          placeholder={t('leave.allTypes')}
          w={200}
          data={(types.data?.data ?? [])
            .filter((x) => x.isPaid)
            .map((x) => ({ value: x.id, label: localName(x, i18n.language) }))}
          value={typeId}
          onChange={(v) => {
            setTypeId(v);
            setPage(1);
          }}
        />
        <MultiFilter
          placeholder={t('leave.allDepartments')}
          w={200}
          data={(depts.data?.data ?? []).map((d) => ({
            value: d.id,
            label: localName(d, i18n.language),
          }))}
          value={deptId}
          onChange={(v) => {
            setDeptId(v);
            setPage(1);
          }}
        />
      </Group>
      <DataTable
        tableId="leave.report"
        columns={columns}
        rows={rows}
        loading={list.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={list.data?.meta?.total ?? 0}
        onPage={setPage}
      />
    </Stack>
  );
};
