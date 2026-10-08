import {
  ActionIcon,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { employeeUpdateInput } from '@hrms/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useList, useSave, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DynamicForm } from '../../components/DynamicForm';
import { errorMessage } from '../../lib/errors';
import { employeeFields } from './EmployeesPage';

const MASK = '••••••';

type Def = {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string | null;
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options: { value: string; labelAr: string; labelEn?: string | null }[];
  isRequired: boolean;
  isSensitive: boolean;
  isActive: boolean;
};

/** حقل مخصص واحد حسب نوعه؛ الحساس المخزّن يظهر مقنّعاً مع زر كشف مدقَّق. */
const CustomInput = ({
  def,
  value,
  stored,
  onChange,
  onReveal,
}: {
  def: Def;
  value: unknown;
  stored: boolean;
  onChange: (v: unknown) => void;
  onReveal?: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const label = i18n.language === 'en' ? def.labelEn || def.labelAr : def.labelAr;
  const common = { label, withAsterisk: def.isRequired };
  if (def.isSensitive && stored && value === MASK) {
    return (
      <TextInput
        {...common}
        value={MASK}
        readOnly
        rightSection={
          onReveal && (
            <ActionIcon variant="subtle" aria-label={t('hr.emp.custom.reveal')} onClick={onReveal}>
              <IconEye size={16} />
            </ActionIcon>
          )
        }
      />
    );
  }
  switch (def.fieldType) {
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
      return (
        <TextInput
          {...common}
          type="date"
          dir="ltr"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value || null)}
        />
      );
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
          clearable={!def.isRequired}
          data={def.options.map((o) => ({
            value: o.value,
            label: i18n.language === 'en' ? o.labelEn || o.labelAr : o.labelAr,
          }))}
          value={typeof value === 'string' ? value : null}
          onChange={(v) => onChange(v)}
        />
      );
    default:
      return (
        <TextInput
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.currentTarget.value || null)}
          rightSection={
            def.isSensitive && value !== MASK && stored ? (
              <ActionIcon
                variant="subtle"
                aria-label={t('hr.emp.custom.hide')}
                onClick={() => onChange(MASK)}
              >
                <IconEyeOff size={16} />
              </ActionIcon>
            ) : undefined
          }
        />
      );
  }
};

const CustomFieldsPanel = ({ employee }: { employee: Row }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const defsQuery = useList('/custom-field-definitions', {}, can('org.custom_field.read'));
  const defs = ((defsQuery.data?.data ?? []) as unknown as Def[]).filter((d) => d.isActive);
  const original = (employee['customFields'] as Record<string, unknown> | undefined) ?? {};
  const [values, setValues] = useState<Record<string, unknown>>(original);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const canEdit = can('employees.employee.update');
  const canReveal = can('employees.custom_field.reveal');

  if (defs.length === 0) return null;

  const set = (key: string, v: unknown) => {
    setValues((s) => ({ ...s, [key]: v }));
    setDirty((d) => new Set(d).add(key));
  };
  const reveal = async (key: string) => {
    try {
      const res = await api.post<{ key: string; value: unknown }>(
        `/employees/${employee.id}/reveal`,
        { key },
      );
      setValues((s) => ({ ...s, [key]: res.data.value }));
      notifications.show({ color: 'yellow', message: t('hr.emp.bank.revealed') });
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      // المرسَل المتغيّر فقط؛ القناع غير المعدَّل لا يُرسل أصلاً (يبقى المخزّن)
      const customFields = Object.fromEntries(
        [...dirty].filter((k) => values[k] !== MASK).map((k) => [k, values[k] ?? null]),
      );
      await api.patch(`/employees/${employee.id}`, { version: employee.version, customFields });
      await qc.invalidateQueries({ queryKey: ['/employees'] });
      setDirty(new Set());
      notifications.show({ color: 'teal', message: t('table.saved') });
    } catch (err) {
      notifications.show({ color: 'red', message: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>{t('hr.emp.overview.custom')}</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {defs.map((d) => (
            <CustomInput
              key={d.key}
              def={d}
              value={values[d.key]}
              stored={original[d.key] !== undefined}
              onChange={(v) => set(d.key, v)}
              onReveal={canReveal ? () => void reveal(d.key) : undefined}
            />
          ))}
        </SimpleGrid>
        {canEdit && (
          <Group justify="flex-end">
            <Button onClick={() => void save()} loading={saving} disabled={dirty.size === 0}>
              {t('common.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
};

/** البيانات الشخصية (تعديل بقفل متفائل) + الحقول المخصصة. */
export const OverviewTab = ({ employee }: { employee: Row }) => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const save = useSave('/employees');
  const canEdit = can('employees.employee.update');
  const fields = employeeFields(t, false, false);
  const initial = Object.fromEntries(fields.map((f) => [f.name, employee[f.name] ?? '']));

  return (
    <Stack>
      <Card withBorder>
        <Title order={4} mb="sm">
          {t('hr.emp.overview.personal')}
        </Title>
        {canEdit ? (
          <DynamicForm
            key={String(employee.version)}
            fields={fields}
            schema={employeeUpdateInput}
            initial={{ ...initial, version: employee.version }}
            editing
            submitting={save.isPending}
            onCancel={() => undefined}
            onSubmit={(values) =>
              save.mutate(
                { id: employee.id, body: { ...values, version: employee.version } },
                {
                  onSuccess: () => notifications.show({ color: 'teal', message: t('table.saved') }),
                  onError: (err) =>
                    notifications.show({ color: 'red', message: errorMessage(err, t) }),
                },
              )
            }
          />
        ) : (
          <Stack gap={4}>
            {fields.map((f) => (
              <Group key={f.name} gap="xs">
                <Text c="dimmed" size="sm" w={180}>
                  {t(`fields.${f.name}`)}
                </Text>
                <Text size="sm">{String(employee[f.name] ?? '—')}</Text>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
      <CustomFieldsPanel key={String(employee.version)} employee={employee} />
    </Stack>
  );
};
