import { describe, expect, it } from 'vitest';
import { parsePunchPaste } from './paste';

describe('لصق البصمات من Excel', () => {
  it('أعمدة منفصلة وعمود تاريخ+وقت واتجاه اختياري وأرقام عربية', () => {
    const r = parsePunchPaste(
      ['E001\t2026-09-06\t8:05', 'E002\t06/09/2026 16:00\tخروج', '٠٠٣\t2026-09-06\t٠٨:٣٠\tin'].join(
        '\n',
      ),
    );
    expect(r.map((x) => [x.employeeNo, x.date, x.time, x.direction, x.error])).toEqual([
      ['E001', '2026-09-06', '08:05', null, undefined],
      ['E002', '2026-09-06', '16:00', 'out', undefined],
      ['003', '2026-09-06', '08:30', 'in', undefined],
    ]);
  });

  it('الترويسة تُتخطى والأخطاء تُعلَّم بنوعها ورقم السطر', () => {
    const r = parsePunchPaste(
      [
        'الرقم\tالتاريخ\tالوقت',
        'E1\t2026-13-40\t08:00',
        'E2\t2026-09-06\t25:00',
        'E3\t2026-09-06\t08:00\tx',
        '\t2026-09-06\t08:00',
      ].join('\n'),
    );
    expect(r.map((x) => [x.line, x.error])).toEqual([
      [2, 'date'],
      [3, 'time'],
      [4, 'direction'],
      [5, 'employeeNo'],
    ]);
  });

  it('فاصل ; و, وأسطر فارغة', () => {
    const r = parsePunchPaste('E1;2026-09-06;08:00\n\nE2,2026-09-06,09:00');
    expect(r).toHaveLength(2);
    expect(r.every((x) => !x.error)).toBe(true);
  });
});
