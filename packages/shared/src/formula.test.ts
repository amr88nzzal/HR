import { describe, expect, it } from 'vitest';
import {
  FormulaError,
  applyRateTable,
  evalFormula,
  formulaRefs,
  num,
  parseFormula,
  type FormulaEnv,
} from './formula.js';

const env = (vars: Record<string, string> = {}): FormulaEnv => ({
  variable: (n) => (Object.hasOwn(vars, n) ? num(vars[n] as string) : undefined),
  base: (c) => num(c === 'ins' ? '1500' : '0'),
  table: (_c, v) => v.times('0.1'),
});
const ev = (src: string, vars?: Record<string, string>) =>
  evalFormula(parseFormula(src), env(vars)).toString();

describe('مفسّر الصيغ', () => {
  it('حساب عشري دقيق وأسبقية العمليات', () => {
    expect(ev('0.1 + 0.2')).toBe('0.3');
    expect(ev('2 + 3 * 4')).toBe('14');
    expect(ev('(2 + 3) * 4')).toBe('20');
    expect(ev('-basic * 0.25', { basic: '1000.50' })).toBe('-250.125');
    expect(ev('10 % 4')).toBe('2');
  });
  it('المقارنات والشرط والدوال', () => {
    expect(
      ev('if(absent_days > 3, basic / 30 * absent_days, 0)', { absent_days: '5', basic: '3000' }),
    ).toBe('500');
    expect(ev('min(basic, 2000)', { basic: '3000' })).toBe('2000');
    expect(ev('max(1, 5, 3)')).toBe('5');
    expect(ev('round(basic / 3, 2)', { basic: '100' })).toBe('33.33');
    expect(ev('round(2.5)')).toBe('3');
    expect(ev('floor(2.9) + ceil(2.1) + abs(-1)')).toBe('6');
  });
  it('base وtable', () => {
    expect(ev("base('ins') * 0.0975")).toBe('146.25');
    expect(ev("table('tax', 2000)")).toBe('200');
  });
  it('يرفض الخطر: دوال غير مسموحة وأكواد وقسمة على صفر ومتغير مجهول', () => {
    for (const bad of [
      'process.exit()',
      'constructor',
      '1 +',
      'eval(1)',
      '1 / 0 ; 2',
      '`x`',
      '"a"+1',
      'a.b',
      'base(basic)',
      'round(1,2,3)',
    ])
      expect(() => evalFormula(parseFormula(bad), env({ basic: '1' }))).toThrow(FormulaError);
    expect(() => ev('1 / (basic - basic)', { basic: '5' })).toThrow('القسمة على صفر');
    expect(() => ev('unknown + 1')).toThrow('متغير غير معروف');
    expect(() => parseFormula('1'.repeat(501))).toThrow('طويلة');
    expect(() => parseFormula('('.repeat(40) + '1' + ')'.repeat(40))).toThrow('متداخلة');
  });
  it('يستخرج المراجع', () => {
    const r = formulaRefs(parseFormula("base('ins') * 0.1 + table('tax', basic) + housing"));
    expect([...r.vars].sort()).toEqual(['basic', 'housing']);
    expect([...r.bases]).toEqual(['ins']);
    expect([...r.tables]).toEqual(['tax']);
  });
});

describe('جداول النسب', () => {
  const br = [
    { from: '0', to: '1000', rate: '0', fixed: '0' },
    { from: '1000', to: '3000', rate: '10', fixed: '0' },
    { from: '3000', to: null, rate: '20', fixed: '0' },
  ];
  it('تصاعدي: كل شريحة على جزئها', () => {
    expect(applyRateTable('progressive', br, num(500)).toString()).toBe('0');
    expect(applyRateTable('progressive', br, num(2000)).toString()).toBe('100');
    expect(applyRateTable('progressive', br, num(4000)).toString()).toBe('400');
  });
  it('شريحة كاملة: نسبة الشريحة على المبلغ كله', () => {
    expect(applyRateTable('slab', br, num(2000)).toString()).toBe('200');
    expect(applyRateTable('slab', br, num(4000)).toString()).toBe('800');
    expect(applyRateTable('slab', br, num(0)).toString()).toBe('0');
  });
});
