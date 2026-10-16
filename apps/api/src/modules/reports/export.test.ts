import { describe, expect, it } from 'vitest';
import { buildExport, cellText, MAX_ROWS } from './export.js';
import type { ReportColumn, Row } from './types.js';

const cols: ReportColumn[] = [
  { key: 'no', labelAr: 'الرقم', labelEn: 'No.', type: 'text' },
  { key: 'name', labelAr: 'الاسم', labelEn: 'Name', type: 'text' },
  {
    key: 'status',
    labelAr: 'الحالة',
    labelEn: 'Status',
    type: 'enum',
    options: [{ value: 'active', labelAr: 'على رأس العمل', labelEn: 'Active' }],
  },
  { key: 'amount', labelAr: 'المبلغ', labelEn: 'Amount', type: 'money' },
];
const meta = { title: 'تقرير', lang: 'ar' as const, filtersText: '' };

const gen = async function* (total: number, batch = 1000, name = (i: number) => `موظف ${i}`) {
  for (let i = 0; i < total; i += batch) {
    const rows: Row[] = [];
    for (let j = i; j < Math.min(total, i + batch); j++)
      rows.push({ no: `E-${j}`, name: name(j), status: 'active', amount: '1234.50' });
    yield rows;
  }
};

describe('تصدير التقارير', () => {
  it('50 ألف صف CSV وXLSX دفعات دون تحميل المصدر كله', async () => {
    let produced = 0;
    const counted = async function* () {
      for await (const b of gen(50_000)) {
        produced += b.length;
        yield b;
      }
    };
    const csv = await buildExport('csv', cols, counted(), meta);
    expect(csv.rows).toBe(50_000);
    expect(produced).toBe(50_000);
    expect(csv.buffer.toString('utf8').split('\r\n').length).toBe(50_002);
    const x = await buildExport('xlsx', cols, gen(50_000), meta);
    expect(x.rows).toBe(50_000);
    expect(x.buffer.subarray(0, 2).toString()).toBe('PK');
  }, 60_000);

  it('حقن الصيغ يُعطَّل في CSV، والـ enum يظهر بتسميته، والاقتباس سليم', async () => {
    const out = await buildExport(
      'csv',
      cols,
      gen(1, 1, () => '=HYPERLINK("http://x")'),
      meta,
    );
    const text = out.buffer.toString('utf8');
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain('على رأس العمل');
    expect(cellText(cols[2]!, 'active', 'en')).toBe('Active');
    expect(cellText(cols[2]!, 'unknown', 'en')).toBe('unknown');
  });

  it('الحدود: PDF وHTML أصغر من CSV وXLSX، وتجاوز الحد 413', async () => {
    expect(MAX_ROWS.pdf).toBeLessThan(MAX_ROWS.html);
    expect(MAX_ROWS.html).toBeLessThan(MAX_ROWS.csv);
    await expect(buildExport('html', cols, gen(MAX_ROWS.html + 1), meta)).rejects.toMatchObject({
      status: 413,
    });
    await expect(buildExport('pdf', cols, gen(3), meta)).rejects.toMatchObject({ status: 503 });
  }, 30_000);
});
