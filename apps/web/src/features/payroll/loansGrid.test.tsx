import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { LoansGridPage } from './LoansGridPage';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../employees/EmployeeSelect', () => ({ EmployeeSelect: () => null }));
vi.mock('../employees/shared', () => ({ useLookup: () => ({ rows: [], options: [] }) }));
vi.mock('../../api/client', () => ({
  api: {
    get: async (path: string) => {
      if (path === '/payroll/loan-types')
        return { data: [{ id: 't1', nameAr: 'سلفة', nameEn: 'Advance', isActive: true }] };
      return {
        data: {
          days: [
            { day: 1, kind: 'work' },
            { day: 2, kind: 'weekend' },
          ],
          types: [
            { id: 't1', nameAr: 'سلفة', nameEn: 'Advance', color: '#fd7e14' },
            { id: 't2', nameAr: 'فاتورة ذمم', nameEn: 'Receivable', color: '#12b886' },
          ],
          rows: [
            {
              employeeId: 'e1',
              employeeNo: 'E-1',
              employeeName: 'أحمد',
              typeId: 't1',
              typeNameAr: 'سلفة',
              typeNameEn: 'Advance',
              color: '#fd7e14',
              currency: 'SAR',
              cells: { '1': { amount: '300.0000', refs: [] } },
              taken: '300.0000',
              due: '300.0000',
              closing: '0',
            },
            {
              employeeId: 'e1',
              employeeNo: 'E-1',
              employeeName: 'أحمد',
              typeId: 't2',
              typeNameAr: 'فاتورة ذمم',
              typeNameEn: 'Receivable',
              color: '#12b886',
              currency: 'SAR',
              cells: { '1': { amount: '85.0000', refs: ['INV-1'] } },
              taken: '85.0000',
              due: '85.0000',
              closing: '0',
            },
          ],
          totals: { SAR: { perDay: { '1': '385.0000' }, taken: '385', due: '385', closing: '0' } },
        },
      };
    },
    blob: async () => new Blob(),
  },
}));

describe('جدول السلف والذمم', () => {
  it('يدمج اسم الموظف على صفوف أنواعه ويعرض مجموع اليوم', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <LoansGridPage />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('أحمد')).toBeTruthy();
    expect(screen.getAllByText('أحمد')).toHaveLength(1);
    expect(container.querySelector('td[rowspan="2"]')).toBeTruthy();
    expect(screen.getAllByText('385').length).toBeGreaterThan(0);
    expect(screen.getAllByText('فاتورة ذمم').length).toBeGreaterThan(0);
  });
});
