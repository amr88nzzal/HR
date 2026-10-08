import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useState } from 'react';
import { useList, useOne, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import type { Option } from '../../components/DynamicForm';
import { str } from './shared';

const label = (r: Row) => `${str(r['employeeNo'])} — ${str(r['fullNameAr'])}`;

/** اختيار موظف ببحث من الخادم (الاسم/الرقم) دون تحميل القائمة كاملة. */
export const EmployeeSelect = ({
  value,
  onChange,
  label: title,
  excludeId,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  excludeId?: string;
  disabled?: boolean;
}) => {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const enabled = can('employees.employee.read');
  const list = useList('/employees', { q: debounced || undefined, pageSize: 20 }, enabled);
  const selected = useOne<Row>('/employees', enabled ? value : null);
  const options = new Map<string, Option>();
  if (selected.data)
    options.set(selected.data.id, { value: selected.data.id, label: label(selected.data) });
  for (const r of (list.data?.data ?? []) as Row[])
    if (r.id !== excludeId) options.set(r.id, { value: r.id, label: label(r) });
  return (
    <Select
      label={title}
      searchable
      clearable
      disabled={disabled}
      data={[...options.values()]}
      value={value}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: o }) => o}
      onChange={onChange}
      nothingFoundMessage="—"
    />
  );
};
