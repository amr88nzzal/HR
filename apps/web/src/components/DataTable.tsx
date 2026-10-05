import { Badge, Center, Group, Loader, Pagination, Table, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** قيمة التصدير (افتراضياً نص العرض إن كان نصاً) */
  exportValue?: (row: T) => string | number | boolean | null;
  align?: 'start' | 'end';
  ltr?: boolean;
};

type Props<T extends { id: string }> = {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  actions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
};

export const ActiveBadge = ({ active }: { active: boolean }) => {
  const { t } = useTranslation();
  return (
    <Badge color={active ? 'teal' : 'gray'} variant="light">
      {active ? t('table.active') : t('table.inactive')}
    </Badge>
  );
};

export const DataTable = <T extends { id: string }>({
  columns,
  rows,
  loading,
  page,
  pageSize,
  total,
  onPage,
  actions,
  onRowClick,
}: Props<T>) => {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <Table.ScrollContainer minWidth={600}>
        <Table striped highlightOnHover={!!onRowClick} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c.key} ta={c.align}>
                  {c.header}
                </Table.Th>
              ))}
              {actions && <Table.Th w={1}>{t('table.actions')}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((c) => (
                  <Table.Td
                    key={c.key}
                    ta={c.align}
                    dir={c.ltr ? 'ltr' : undefined}
                    style={c.ltr ? { textAlign: 'start' } : undefined}
                  >
                    {c.render(row)}
                  </Table.Td>
                ))}
                {actions && (
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Group gap={4} wrap="nowrap">
                      {actions(row)}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {loading && rows.length === 0 && (
        <Center p="md">
          <Loader size="sm" />
        </Center>
      )}
      {!loading && rows.length === 0 && (
        <Text c="dimmed" ta="center" p="md">
          {t('table.empty')}
        </Text>
      )}
      <Group justify="space-between" mt="sm">
        <Text size="sm" c="dimmed">
          {t('table.total', { count: total })}
        </Text>
        {pages > 1 && <Pagination value={page} onChange={onPage} total={pages} size="sm" />}
      </Group>
    </>
  );
};
