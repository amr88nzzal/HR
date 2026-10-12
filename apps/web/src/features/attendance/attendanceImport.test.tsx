import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ImportPage, type ImportReport } from './ImportPage';
import { colRef } from './ImportProfilesPage';

const state = vi.hoisted(() => ({
  uploads: [] as { path: string; query: unknown }[],
  posts: [] as { path: string; body: unknown }[],
  report: null as unknown,
}));
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/attendance-import/profiles')
        return {
          data: [{ id: 'p1', code: 'DEV', nameAr: 'جهاز', isDefault: true, isActive: true }],
        };
      if (path === '/attendance-import/held/summary')
        return {
          data: [
            {
              deviceCode: '9999',
              reason: 'unmatched',
              rows: 2,
              firstAt: '2026-09-06T05:00:00Z',
              lastAt: '2026-09-07T05:00:00Z',
              branches: ['RUH'],
            },
          ],
        };
      return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
    },
    post: async (path: string, body: unknown) => {
      state.posts.push({ path, body });
      return { data: { resolved: 2 } };
    },
    upload: async (path: string, _f: Blob, o: { query: Record<string, unknown> }) => {
      state.uploads.push({ path, query: o.query });
      return { data: { ...(state.report as object), applied: o.query['dryRun'] === false } };
    },
  },
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../lib/useFormat', () => ({
  useFormat: () => ({ date: (v: string) => v, dateTime: (v: string) => v, time: (v: string) => v }),
}));
vi.mock('../employees/EmployeeSelect', () => ({
  EmployeeSelect: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button onClick={() => onChange('emp-1')}>pick-employee</button>
  ),
}));

const report: ImportReport = {
  fileHash: 'h',
  encoding: 'windows-1256',
  hasHeader: true,
  alreadyImportedBatchId: null,
  total: 10,
  toInsert: 6,
  duplicatesInFile: 1,
  alreadyExisting: 0,
  held: 2,
  heldCodes: [{ code: '9999', reason: 'unmatched', count: 2 }],
  errorCount: 1,
  errors: [{ line: 11, message: 'تاريخ/وقت غير صالح' }],
  employees: 3,
  dateFrom: '2026-09-06',
  dateTo: '2026-09-06',
  sample: [],
  applied: false,
};

const pickFile = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );

describe('استيراد البصمات (الواجهة)', () => {
  beforeEach(() => {
    state.uploads.length = 0;
    state.posts.length = 0;
    state.report = report;
  });

  it('معاينة ثم تأكيد: التأكيد معطّل قبل المعاينة ويُرسل dryRun=false بعدها', async () => {
    wrap(<ImportPage />);
    const file = new File(['a;b'], 'punches.csv', { type: 'text/csv' });
    await screen.findByText('ملف البصمات (CSV)');
    pickFile(file);
    await userEvent.click(screen.getByRole('button', { name: 'معاينة' }));
    expect(await screen.findByText('رموز لم تُطابَق (تُحجز لقرار الموارد البشرية)')).toBeTruthy();
    expect(screen.getByText('windows-1256', { exact: false })).toBeTruthy();
    expect(state.uploads[0]?.query).toMatchObject({ dryRun: true, fileName: 'punches.csv' });
    const confirm = screen.getByRole('button', { name: 'تأكيد الاستيراد' });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(confirm);
    await waitFor(() => expect(state.uploads).toHaveLength(2));
    expect(state.uploads[1]?.query).toMatchObject({ dryRun: false });
  });

  it('ملف سبق استيراده: التأكيد معطّل مع تنبيه', async () => {
    state.report = { ...report, alreadyImportedBatchId: 'b1' };
    wrap(<ImportPage />);
    await screen.findByText('ملف البصمات (CSV)');
    pickFile(new File(['x'], 'a.csv'));
    await userEvent.click(screen.getByRole('button', { name: 'معاينة' }));
    expect(await screen.findByText(/استُورد سابقاً بالإعدادات نفسها/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'تأكيد الاستيراد' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('المحجوز: ربط الرمز بموظف يرسل الرمز والموظف وحفظ المرجع', async () => {
    wrap(<ImportPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'المحجوز' }));
    await userEvent.click(await screen.findByRole('button', { name: 'ربط بموظف' }));
    await userEvent.click(await screen.findByText('pick-employee'));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'ربط بموظف' });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(submit);
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toEqual({
      path: '/attendance-import/held/resolve',
      body: { deviceCode: '9999', employeeId: 'emp-1', createRef: true },
    });
  });

  it('رقم العمود أو اسمه أو فارغ', () => {
    expect(colRef('2')).toBe(2);
    expect(colRef(' Trx_Date ')).toBe('Trx_Date');
    expect(colRef('')).toBeNull();
  });
});
