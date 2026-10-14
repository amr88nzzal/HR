import { ActionIcon, Button, Group, Select, Stack, TextInput } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Item } from './types';

/** صفوف (مكوّن، مبلغ مخصص، نسبة مخصصة) تُستعمل في الهياكل ورواتب الموظفين. */
export const ItemsEditor = ({
  items,
  onChange,
  options,
}: {
  items: Item[];
  onChange: (items: Item[]) => void;
  options: { value: string; label: string }[];
}) => {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<Item>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <Stack gap="xs">
      {items.map((it, i) => (
        <Group key={i} align="flex-end" wrap="nowrap">
          <Select
            style={{ flex: 2 }}
            label={i === 0 ? t('payroll.component') : undefined}
            aria-label={t('payroll.component')}
            data={options}
            searchable
            value={it.componentId || null}
            onChange={(v) => set(i, { componentId: v ?? '' })}
          />
          <TextInput
            style={{ flex: 1 }}
            dir="ltr"
            label={i === 0 ? t('payroll.amountOverride') : undefined}
            aria-label={t('payroll.amountOverride')}
            value={it.amount ?? ''}
            onChange={(e) => set(i, { amount: e.currentTarget.value || null })}
          />
          <TextInput
            style={{ flex: 1 }}
            dir="ltr"
            label={i === 0 ? t('payroll.percentOverride') : undefined}
            aria-label={t('payroll.percentOverride')}
            value={it.percent ?? ''}
            onChange={(e) => set(i, { percent: e.currentTarget.value || null })}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={t('payroll.remove')}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Button
        variant="light"
        size="xs"
        w="fit-content"
        onClick={() => onChange([...items, { componentId: '', amount: null, percent: null }])}
      >
        {t('payroll.addItem')}
      </Button>
    </Stack>
  );
};

/** يحوّل صفوف المحرر إلى جسم الطلب (يُسقط الصفوف الفارغة). */
export const itemsBody = (items: Item[]) =>
  items
    .filter((i) => i.componentId)
    .map((i) => ({
      componentId: i.componentId,
      amount: i.amount || null,
      percent: i.percent || null,
    }));
