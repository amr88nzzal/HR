import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { departmentInput } from '@hrms/shared';
import '../i18n';
import { DynamicForm, type FieldDef } from './DynamicForm';

const fields: FieldDef[] = [
  { name: 'code', kind: 'text', required: true },
  { name: 'nameAr', kind: 'text', required: true },
  { name: 'nameEn', kind: 'text' },
  { name: 'parentId', kind: 'select', options: [] },
  {
    name: 'branchIds',
    kind: 'multiselect',
    required: true,
    options: [{ value: '0197a000-0000-7000-8000-000000000001', label: 'الرياض' }],
  },
];

const renderForm = (onSubmit = vi.fn()) => {
  render(
    <MantineProvider>
      <DynamicForm
        fields={fields}
        schema={departmentInput}
        initial={{
          code: '',
          nameAr: '',
          nameEn: '',
          parentId: '',
          branchIds: ['0197a000-0000-7000-8000-000000000001'],
        }}
        editing={false}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />
    </MantineProvider>,
  );
  return onSubmit;
};

describe('النموذج الديناميكي', () => {
  it('الحقول الفارغة الاختيارية تُرسل null وتجتاز التحقق', async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText(/الرمز/), 'HR');
    await userEvent.type(screen.getByLabelText(/الاسم \(عربي\)/), 'الموارد');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      code: 'HR',
      nameAr: 'الموارد',
      nameEn: null,
      parentId: null,
    });
  });

  it('لا يرسل عند حقل مطلوب فارغ ويعرض الخطأ', async () => {
    const onSubmit = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(document.querySelector('[data-error], .mantine-InputWrapper-error')).not.toBeNull(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
