import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { gridHtml, gridWorkbook, mergeEmployees } from './loans-grid.routes.js';

const row = (typeId: string, color: string, name: string, amount: string, refs: string[]) => ({
  employeeId: 'e1',
  employeeNo: 'E-1',
  employeeName: 'أحمد',
  typeId,
  typeCode: typeId,
  typeNameAr: name,
  typeNameEn: name,
  color,
  currency: 'SAR',
  cells: { '3': { amount, refs } },
  taken: amount,
  due: amount,
  closing: '0',
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const grid: any = {
  year: 2026,
  month: 10,
  days: [1, 2, 3, 4].map((day) => ({ day, kind: 'work' })),
  types: [
    { id: 't1', nameAr: 'سلفة', nameEn: 'Advance', color: '#fd7e14' },
    { id: 't2', nameAr: 'ذمم', nameEn: 'Receivable', color: '#12b886' },
  ],
  rows: [row('t1', '#fd7e14', 'سلفة', '300', []), row('t2', '#12b886', 'ذمم', '85', ['INV-1'])],
  totals: { SAR: { perDay: { '3': '385' }, taken: '385', due: '385', closing: '0' } },
};

describe('تصدير شبكة السلف بالتخطيط الجديد', () => {
  it('يدمج أنواع الموظف في صف واحد', () => {
    const rows = mergeEmployees(grid);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.days['3']).toHaveLength(2);
    expect(rows[0]?.taken.toNumber()).toBe(385);
  });
  it('PDF: خلية اليوم مجموع بخلفية مقسَّمة', () => {
    const html = gridHtml(grid, 'ar');
    expect(html).toContain('linear-gradient(to right');
    expect(html).toContain('385');
    expect((html.match(/<tr>/g) ?? []).length).toBe(1); // صف موظف واحد
  });
  it('Excel: صف واحد ومجموع اليوم وملاحظة بالتفصيل', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gridWorkbook(grid, 'ar')) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const c = ws.getRow(2).getCell(4); // اليوم 3
    expect(c.value).toBe(385);
    expect(JSON.stringify(c.note)).toContain('INV-1');
    expect(ws.getRow(2).getCell(1).value).toContain('أحمد');
  });
});
