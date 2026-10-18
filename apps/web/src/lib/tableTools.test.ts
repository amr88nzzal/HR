import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { applyPrefs, compareValues, moveKey, nodeText, printHtml } from './tableTools';

describe('أدوات الجداول', () => {
  it('نص العقدة: نصوص متداخلة وأرقام، وتُهمل الأيقونات الفارغة', () => {
    expect(nodeText(createElement('b', null, 'أحمد', ' ', createElement('i')))).toBe('أحمد');
    expect(nodeText([1, 'x', null, false])).toBe('1 x');
  });

  it('المقارنة: أرقام (مع فواصل) كأرقام لا نصوص، والعربية أبجدياً، والفارغ أخيراً', () => {
    const sort = (xs: string[]) => [...xs].sort((a, b) => compareValues(a, b));
    expect(sort(['9', '10', '1,500.50', '2'])).toEqual(['2', '9', '10', '1,500.50']);
    expect(sort(['ليث', 'باسل', 'سامر', 'أحمد'])).toEqual(['أحمد', 'باسل', 'سامر', 'ليث']);
    expect(sort(['—', 'ب', '', 'أ'])).toEqual(['أ', 'ب', '—', '']);
    expect(sort(['E10', 'E2', 'E1'])).toEqual(['E1', 'E2', 'E10']);
  });

  it('تفضيل الأعمدة: ترتيب وإخفاء وتجاهل المفاتيح القديمة، وعمود واحد على الأقل', () => {
    const cols = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
    const keys = (p: { order: string[]; hidden: string[] }) =>
      applyPrefs(cols, p).map((c) => c.key);
    expect(keys({ order: [], hidden: [] })).toEqual(['a', 'b', 'c', 'd']);
    expect(keys({ order: ['c', 'a'], hidden: [] })).toEqual(['c', 'a', 'b', 'd']);
    expect(keys({ order: ['d', 'zzz'], hidden: ['b'] })).toEqual(['d', 'a', 'c']);
    expect(keys({ order: [], hidden: ['a', 'b', 'c', 'd'] })).toEqual(['a']);
  });

  it('نقل عمود', () => {
    expect(moveKey(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveKey(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveKey(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('HTML الطباعة يعقّم النصوص ويضبط الاتجاه', () => {
    const html = printHtml('<كشف>', ['س&'], [['<script>alert(1)</script>']], {
      rtl: true,
      date: 'اليوم',
    });
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('س&amp;');
  });

  it('ترويسة الشركة في الطباعة: شعار واسم وأسطر تواصل معقَّمة، وبدونها لا شيء', () => {
    const base = { rtl: true, date: 'اليوم' };
    const html = printHtml('كشف', ['س'], [['ص']], {
      ...base,
      header: {
        name: 'شركة <نكسن>',
        lines: ['عمّان', '+962 6 000'],
        logo: 'data:image/png;base64,AAAA',
      },
    });
    expect(html).toContain('class="brand"');
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain('شركة &lt;نكسن&gt;');
    expect(html).toContain('+962 6 000');
    expect(html.indexOf('class="brand"')).toBeLessThan(html.indexOf('<h1>'));
    expect(printHtml('كشف', ['س'], [['ص']], base)).not.toContain('class="brand"');
    expect(printHtml('كشف', ['س'], [['ص']], { ...base, header: null })).not.toContain(
      '<div class="brand">',
    );
  });
});
