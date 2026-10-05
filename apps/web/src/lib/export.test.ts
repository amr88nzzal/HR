import { describe, expect, it } from 'vitest';
import { toCsv } from './export';

describe('تصدير CSV', () => {
  const cols = [
    { header: 'الاسم', value: (r: { n: string; v: number | null }) => r.n },
    { header: 'القيمة', value: (r: { n: string; v: number | null }) => r.v },
  ];
  it('BOM وفاصل أسطر وتهريب الفواصل والاقتباس', () => {
    const csv = toCsv(cols, [
      { n: 'أ, "ب"', v: 3 },
      { n: 'ج', v: null },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿الاسم,القيمة\r\n"أ, ""ب""",3\r\nج,');
  });
  it('يحمي من حقن الصيغ لكن يترك الأرقام السالبة', () => {
    const csv = toCsv(cols, [{ n: '=HYPERLINK("x")', v: -5 }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")",-5`);
  });
});
