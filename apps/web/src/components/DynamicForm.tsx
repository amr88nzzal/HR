import {
  Button,
  Group,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import type { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { zodValidate } from './zodValidate';

export type Option = { value: string; label: string };

export type FieldDef = {
  name: string;
  /** مفتاح الترجمة تحت fields.* أو تسمية جاهزة */
  labelKey?: string;
  label?: string;
  kind: 'text' | 'number' | 'select' | 'multiselect' | 'switch' | 'textarea' | 'password';
  required?: boolean;
  ltr?: boolean;
  /** خيارات ثابتة أو محمّلة من الخادم */
  options?: Option[];
  /** يُعطّل عند التعديل (مثل الرمز بعد الإنشاء) */
  lockOnEdit?: boolean;
  description?: string;
  min?: number;
  max?: number;
};

type Props = {
  fields: FieldDef[];
  schema: z.ZodType;
  initial: Record<string, unknown>;
  editing: boolean;
  submitting?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
};

/** نموذج مولَّد من تعريف الحقول، يتحقق بنفس مخطط zod المشترك مع الخادم. */
export const DynamicForm = ({
  fields,
  schema,
  initial,
  editing,
  submitting,
  onSubmit,
  onCancel,
}: Props) => {
  const { t } = useTranslation();
  const validateWith = zodValidate(schema);
  const form = useForm<Record<string, unknown>>({
    initialValues: initial,
    // حقول فارغة ('') تُعامَل كغير موجودة (null) عند التحقق، مطابقةً لما يُرسل للخادم
    validate: (values) =>
      validateWith(
        Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v])),
      ),
  });

  const label = (f: FieldDef) => f.label ?? t(`fields.${f.labelKey ?? f.name}`);
  const common = (f: FieldDef) => ({
    label: label(f),
    description: f.description,
    withAsterisk: f.required,
    disabled: editing && f.lockOnEdit,
    ...form.getInputProps(f.name, f.kind === 'switch' ? { type: 'checkbox' } : undefined),
  });

  return (
    <form
      onSubmit={form.onSubmit((values) => {
        // قيم فارغة تتحول إلى null ليقبلها الخادم (اختياري)
        const cleaned = Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]),
        );
        onSubmit(cleaned);
      })}
    >
      <Stack>
        {fields.map((f) => {
          switch (f.kind) {
            case 'switch':
              return <Switch key={f.name} {...common(f)} />;
            case 'textarea':
              return <Textarea key={f.name} autosize minRows={2} {...common(f)} />;
            case 'number':
              return (
                <NumberInput
                  key={f.name}
                  min={f.min}
                  max={f.max}
                  allowDecimal={false}
                  {...common(f)}
                />
              );
            case 'password':
              return (
                <PasswordInput key={f.name} dir="ltr" autoComplete="new-password" {...common(f)} />
              );
            case 'select':
              return (
                <Select
                  key={f.name}
                  data={f.options ?? []}
                  searchable
                  clearable={!f.required}
                  nothingFoundMessage="—"
                  {...common(f)}
                  value={(form.values[f.name] as string | null) ?? null}
                />
              );
            case 'multiselect':
              return (
                <MultiSelect
                  key={f.name}
                  data={f.options ?? []}
                  searchable
                  {...common(f)}
                  value={(form.values[f.name] as string[]) ?? []}
                />
              );
            default:
              return (
                <TextInput
                  key={f.name}
                  dir={f.ltr ? 'ltr' : undefined}
                  {...common(f)}
                  value={(form.values[f.name] as string | null) ?? ''}
                />
              );
          }
        })}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
};
