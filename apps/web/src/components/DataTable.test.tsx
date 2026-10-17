import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { DataTable, type Column } from './DataTable';

const saved: unknown[] = [];
vi.mock('../api/client', () => ({
  api: {
    get: async () => ({ data: { order: [], hidden: [] } }),
    put: async (_p: string, body: unknown) => (saved.push(body), { data: body }),
    del: async () => undefined,
  },
}));

type R = { id: string; name: string; net: string };
const rows: R[] = [
  { id: '1', name: 'سامر', net: '3,000.00' },
  { id: '2', name: 'باسل', net: '12,000.00' },
  { id: '3', name: 'ليث', net: '4,000.00' },
];
const columns: Column<R>[] = [
  { key: 'name', header: 'الاسم', render: (r) => r.name },
  { key: 'net', header: 'الصافي', render: (r) => r.net, ltr: true },
];

const mount = (props: Partial<React.ComponentProps<typeof DataTable<R>>> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <DataTable<R>
          columns={columns}
          rows={rows}
          page={1}
          pageSize={50}
          total={rows.length}
          onPage={() => undefined}
          tableId="t1"
          {...props}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );
const order = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.textContent);

describe('DataTable: الفرز', () => {
  it('جدول كامل: الفرز من الواجهة تصاعدياً ثم تنازلياً ثم يُلغى، والأرقام كأرقام', async () => {
    mount();
    const net = screen.getByRole('button', { name: /الصافي/ });
    await userEvent.click(net);
    expect(order()).toEqual(['سامر', 'ليث', 'باسل']);
    await userEvent.click(net);
    expect(order()).toEqual(['باسل', 'ليث', 'سامر']);
    await userEvent.click(net);
    expect(order()).toEqual(['سامر', 'باسل', 'ليث']);
    await userEvent.click(screen.getByRole('button', { name: /الاسم/ }));
    expect(order()).toEqual(['باسل', 'سامر', 'ليث']);
  });

  it('جدول مرقَّم بلا فرز خادم: لا ترويسات قابلة للفرز (حتى لا يُفرز جزء من الصفوف فقط)', () => {
    mount({ total: 100 });
    expect(screen.queryByRole('button', { name: /الصافي/ })).toBeNull();
  });

  it('فرز الخادم: يستدعي onSort بالمفتاح ثم - ثم يلغي، ويعيد الصفحة 1', async () => {
    const onSort = vi.fn();
    const onPage = vi.fn();
    const cols = columns.map((c) => ({ ...c, sortKey: c.key }));
    const { rerender } = mount({ columns: cols, onSort, onPage, total: 100, page: 3 });
    await userEvent.click(screen.getByRole('button', { name: /الصافي/ }));
    expect(onSort).toHaveBeenLastCalledWith('net');
    expect(onPage).toHaveBeenLastCalledWith(1);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <DataTable<R>
            columns={cols}
            rows={rows}
            page={1}
            pageSize={50}
            total={100}
            onPage={onPage}
            onSort={onSort}
            sort="net"
            tableId="t1"
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: /الصافي/ })[0]!);
    expect(onSort).toHaveBeenLastCalledWith('-net');
  });
});

describe('DataTable: الأعمدة', () => {
  it('إخفاء عمود من القائمة يحفظ التفضيل ويزيل العمود', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'الأعمدة' }));
    await userEvent.click(await screen.findByLabelText('الصافي'));
    expect(saved.at(-1)).toEqual({ order: ['name', 'net'], hidden: ['net'] });
    expect(screen.queryByRole('columnheader', { name: /الصافي/ })).toBeNull();
  });

  it('تقديم/تأخير عمود يحفظ الترتيب الجديد', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'الأعمدة' }));
    const down = await screen.findAllByRole('button', { name: 'تأخير' });
    await userEvent.click(down[0]!);
    expect(saved.at(-1)).toEqual({ order: ['net', 'name'], hidden: [] });
  });

  it('بلا tableId لا يظهر شريط الأدوات', () => {
    mount({ tableId: undefined });
    expect(screen.queryByRole('button', { name: 'الأعمدة' })).toBeNull();
  });
});
