import { Group, NumberInput, Select, Switch, Textarea, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export type DocField = {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string | null;
  dataType:
    | 'text'
    | 'long_text'
    | 'number'
    | 'date'
    | 'amount'
    | 'boolean'
    | 'select'
    | 'file'
    | 'reminder_date';
  isRequired: boolean;
  isSensitive: boolean;
  isUnique: boolean;
  options: unknown;
  sortOrder: number;
  showInList: boolean;
  isActive: boolean;
  version: number;
};

export type SelectOpt = { value: string; labelAr: string; labelEn?: string | null };
export type Amount = { amount: string; currency: string };

export const fieldLabel = (f: Pick<DocField, 'labelAr' | 'labelEn'>, lang: string): string =>
  lang === 'en' ? f.labelEn || f.labelAr : f.labelAr;

export const selectOptions = (f: DocField): SelectOpt[] =>
  Array.isArray(f.options) ? (f.options as SelectOpt[]) : [];

/** أداة إدخال حقل وثيقة حسب نوع بياناته (الملفات تُدار خارجها). */
export const FieldInput = ({
  field,
  value,
  onChange,
  currencies,
  disabled,
}: {
  field: DocField;
  value: unknown;
  onChange: (v: unknown) => void;
  currencies: string[];
  disabled?: boolean;
}) => {
  const { i18n } = useTranslation();
  const common = {
    label: fieldLabel(field, i18n.language),
    withAsterisk: field.isRequired,
    disabled,
  };
  switch (field.dataType) {
    case 'long_text':
      return (
        <Textarea
          {...common}
          autosize
          minRows={2}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    case 'number':
      return (
        <NumberInput
          {...common}
          allowDecimal
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v === '' ? null : v)}
        />
      );
    case 'date':
    case 'reminder_date':
      return (
        <TextInput
          {...common}
          type="date"
          dir="ltr"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value || null)}
        />
      );
    case 'amount': {
      const a = (value as Partial<Amount> | null) ?? {};
      return (
        <Group grow align="flex-end" wrap="nowrap">
          <NumberInput
            {...common}
            allowDecimal
            decimalScale={4}
            value={a.amount ?? ''}
            onChange={(v) =>
              onChange(
                v === '' ? null : { amount: String(v), currency: a.currency ?? currencies[0] },
              )
            }
          />
          <Select
            aria-label="currency"
            data={currencies}
            allowDeselect={false}
            disabled={disabled}
            value={a.currency ?? currencies[0] ?? null}
            onChange={(c) => c && onChange({ amount: a.amount ?? '0', currency: c })}
            maw={110}
          />
        </Group>
      );
    }
    case 'boolean':
      return (
        <Switch
          {...common}
          checked={value === true}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case 'select':
      return (
        <Select
          {...common}
          clearable={!field.isRequired}
          data={selectOptions(field).map((o) => ({
            value: o.value,
            label: i18n.language === 'en' ? o.labelEn || o.labelAr : o.labelAr,
          }))}
          value={typeof value === 'string' ? value : null}
          onChange={(v) => onChange(v)}
        />
      );
    case 'file':
      return null;
    default:
      return (
        <TextInput
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
  }
};

/** نص عرض قيمة (للقوائم والمعاينة). */
export const displayValue = (
  f: DocField,
  v: unknown,
  lang: string,
  yes: string,
  no: string,
): string => {
  if (v === undefined || v === null || v === '') return '—';
  switch (f.dataType) {
    case 'boolean':
      return v === true ? yes : no;
    case 'amount': {
      const a = v as Partial<Amount>;
      return `${a.amount ?? ''} ${a.currency ?? ''}`.trim();
    }
    case 'select': {
      const o = selectOptions(f).find((x) => x.value === v);
      return o ? (lang === 'en' ? o.labelEn || o.labelAr : o.labelAr) : String(v);
    }
    default:
      return String(v);
  }
};
