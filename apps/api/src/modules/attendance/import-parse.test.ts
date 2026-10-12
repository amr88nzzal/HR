import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, decodeText, parseCsv, parseDateTime, splitLine } from './import-parse.js';

describe('تحليل ملف البصمات', () => {
  it('الصيغ الثلاث للتاريخ والأرقام العربية وتاريخ مستحيل', () => {
    expect(parseDateTime('2026-09-06 08:05:30', 'auto')).toEqual({
      date: '2026-09-06',
      time: '08:05',
    });
    expect(parseDateTime('06/09/2026 8:05', 'auto')).toEqual({ date: '2026-09-06', time: '08:05' });
    expect(parseDateTime('2026/09/06 08:05', 'auto')).toEqual({
      date: '2026-09-06',
      time: '08:05',
    });
    expect(parseDateTime('٢٠٢٦-٠٩-٠٦ ٠٨:٠٥', 'auto')).toEqual({
      date: '2026-09-06',
      time: '08:05',
    });
    expect(parseDateTime('09/06/2026 08:05', 'mdy')).toEqual({ date: '2026-09-06', time: '08:05' });
    expect(parseDateTime('31/02/2026 08:05', 'auto')).toBeNull();
    expect(parseDateTime('2026-09-06 25:00', 'auto')).toBeNull();
    expect(parseDateTime('خطأ', 'auto')).toBeNull();
  });

  it('الاقتباس والفاصل', () => {
    expect(splitLine('a;"b;c";d', ';')).toEqual(['a', 'b;c', 'd']);
    expect(splitLine('a,"x ""y"""', ',')).toEqual(['a', 'x "y"']);
  });

  it('ترميز Windows-1256 يُكتشف عند فشل UTF-8، وBOM يُزال', () => {
    const win = Buffer.from([0xc7, 0xe1, 0xd3, 0xdf]); // "السك" في 1256
    expect(decodeText(win, 'auto').encoding).toBe('windows-1256');
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('abc')]);
    expect(decodeText(bom, 'auto')).toEqual({ text: 'abc', encoding: 'utf-8' });
    expect(() => decodeText(win, 'utf-8')).toThrow();
  });

  it('ملف كامل: ترويسة تلقائية، النوع، أصفار بادئة، أخطاء بأرقام الأسطر', () => {
    const csv = [
      'branch_id;department_id;empl_id;date_time;type',
      '1;2;0042;2026-09-06 08:01:00;0',
      '1;2;٠٠٤٢;2026-09-06 16:02:00;O',
      '1;2;0043;2026-09-06 08:00:00;',
      '1;2;;2026-09-06 08:00:00;0',
      '1;2;0044;غلط;0',
      '',
    ].join('\r\n');
    const r = parseCsv(Buffer.from(csv), DEFAULT_PROFILE);
    expect(r.hasHeader).toBe(true);
    expect(r.rows.map((x) => [x.employee, x.time, x.direction])).toEqual([
      ['0042', '08:01', 'in'],
      ['0042', '16:02', 'out'],
      ['0043', '08:00', null],
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([5, 6]);
  });

  it('بلا ترويسة، وتجاهل النوع، وربط الأعمدة بالأسماء', () => {
    const noHeader = parseCsv(Buffer.from('1;2;7;2026-09-06 08:00:00;0'), {
      ...DEFAULT_PROFILE,
      directionMode: 'ignore',
    });
    expect(noHeader.hasHeader).toBe(false);
    expect(noHeader.rows[0]?.direction).toBeNull();
    const named = parseCsv(Buffer.from('Company_ID,Trx_Date\n9,2026-09-06 08:00:00'), {
      ...DEFAULT_PROFILE,
      delimiter: ',',
      columns: {
        branch: null,
        department: null,
        employee: 'company_id',
        datetime: 'trx_date',
        type: null,
      },
    });
    expect(named.rows[0]).toMatchObject({ employee: '9', date: '2026-09-06', time: '08:00' });
    expect(() =>
      parseCsv(Buffer.from('x,y\n1,2'), {
        ...DEFAULT_PROFILE,
        delimiter: ',',
        columns: { ...DEFAULT_PROFILE.columns, employee: 'nope' },
      }),
    ).toThrow();
  });
});
