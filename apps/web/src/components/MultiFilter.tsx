import { MultiSelect, type MultiSelectProps } from '@mantine/core';

/** فلتر قائمة متعدد الاختيار موحّد (بحث وتفريغ وقائمة لا تحجب ما اختير)؛ القيم تُرسل مفصولة بفواصل. */
export const MultiFilter = (props: MultiSelectProps) => (
  <MultiSelect
    clearable
    searchable
    hidePickedOptions={false}
    maxDropdownHeight={280}
    comboboxProps={{ withinPortal: true }}
    w={220}
    {...props}
  />
);

/** قيم الفلتر كمعامل استعلام (فارغ = بلا فلتر) */
export const csv = (v: string[]): string | undefined => (v.length ? v.join(',') : undefined);
