import { describe, expect, it } from 'vitest';
import { computePayslip, EngineError, type EmpComp, type EngineInput } from './engine.js';

const comp = (o: Partial<EmpComp> & Pick<EmpComp, 'code' | 'calcType' | 'kind'>): EmpComp => ({
  id: `id-${o.code}`,
  nameAr: o.code,
  nameEn: null,
  fixedAmount: null,
  percent: null,
  baseCode: null,
  formula: null,
  rateTableCode: null,
  roundingDecimals: 3,
  displayOrder: 100,
  prorate: true,
  amount: null,
  percentOverride: null,
  ...o,
});

const base = (over: Partial<EngineInput> = {}): EngineInput => {
  const components = [
    comp({
      code: 'housing',
      calcType: 'fixed',
      kind: 'earning',
      fixedAmount: '100',
      displayOrder: 10,
    }),
    comp({
      code: 'transport',
      calcType: 'fixed',
      kind: 'earning',
      fixedAmount: '40',
      displayOrder: 20,
    }),
    comp({
      code: 'social',
      calcType: 'percent',
      kind: 'deduction',
      percent: '7.5',
      baseCode: 'ins',
      displayOrder: 40,
    }),
    comp({
      code: 'tax',
      calcType: 'rate_table',
      kind: 'deduction',
      rateTableCode: 'TAX',
      baseCode: 'taxable',
      displayOrder: 50,
    }),
    comp({
      code: 'absence',
      calcType: 'formula',
      kind: 'deduction',
      formula: 'round(basic / days_in_period * absent_days, 3)',
      displayOrder: 60,
    }),
    comp({
      code: 'er',
      calcType: 'percent',
      kind: 'employer',
      percent: '14.25',
      baseCode: 'ins',
      displayOrder: 70,
    }),
  ];
  return {
    basic: '900',
    factor: '1',
    variables: { days_in_period: '30', absent_days: '2', overtime_hours: '0' },
    components,
    allCodes: ['housing', 'transport', 'social', 'tax', 'absence', 'er', 'other'],
    bases: [
      { code: 'ins', includesBasic: true, memberCodes: ['housing'] },
      { code: 'taxable', includesBasic: true, memberCodes: ['housing', 'transport'] },
    ],
    tables: [
      {
        code: 'TAX',
        mode: 'progressive',
        brackets: [
          { from: '0', to: '1000', rate: '0', fixed: '0' },
          { from: '1000', to: null, rate: '10', fixed: '0' },
        ],
      },
    ],
    manual: {},
    added: [],
    ...over,
  };
};
const line = (r: ReturnType<typeof computePayslip>, code: string) =>
  r.lines.find((l) => l.code === code);

describe('محرك الرواتب (نواة نقية)', () => {
  it('حساب مرجعي بالفلس: استحقاقات واستقطاعات وضريبة تصاعدية وتحمّل الشركة', () => {
    const r = computePayslip(base());
    // ins = 900+100 = 1000 ؛ taxable = 1040 ؛ ضريبة = (1040-1000)*10% = 4
    expect(line(r, 'social')?.amount).toBe('75.0000');
    expect(line(r, 'tax')?.amount).toBe('4.0000');
    expect(line(r, 'absence')?.amount).toBe('60.0000');
    expect(line(r, 'er')?.amount).toBe('142.5000');
    expect(r.totals).toEqual({
      basic: '900.0000',
      gross: '1040.0000',
      deductions: '139.0000',
      net: '901.0000',
      employer: '142.5000',
    });
    expect(r.warnings).toEqual([]);
  });

  it('الترتيب بالاعتماديات لا بالـ displayOrder: النسبة بعد أعضاء أساسها', () => {
    const input = base();
    input.components[0] = { ...input.components[0]!, displayOrder: 999 };
    const r = computePayslip(input);
    expect(line(r, 'social')?.amount).toBe('75.0000'); // ما زال يرى السكن
  });

  it('التناسب: الأساسي والثابت يُضربان بالنسبة، والمعطَّل لا يُضرب، والصيغة تقرأ الأساسي كاملاً', () => {
    const input = base({ factor: '0.5' });
    input.components[1] = { ...input.components[1]!, prorate: false };
    const r = computePayslip(input);
    expect(line(r, 'basic')?.amount).toBe('450.0000');
    expect(line(r, 'housing')?.amount).toBe('50.0000');
    expect(line(r, 'transport')?.amount).toBe('40.0000');
    expect(line(r, 'absence')?.amount).toBe('60.0000'); // basic الكامل 900/30*2
    expect(line(r, 'social')?.amount).toBe('37.5000');
  });

  it('تخصيص المبلغ والنسبة للموظف', () => {
    const input = base();
    input.components[0] = { ...input.components[0]!, amount: '250' };
    input.components[2] = { ...input.components[2]!, percentOverride: '10' };
    const r = computePayslip(input);
    expect(line(r, 'housing')?.amount).toBe('250.0000');
    expect(line(r, 'social')?.amount).toBe('115.0000'); // (900+250)*10%
  });

  it('مكوّن غير مُسند للموظف يُقرأ صفراً في الصيغة، ومتغير مجهول خطأ', () => {
    const input = base();
    input.components.push(
      comp({ code: 'x1', calcType: 'formula', kind: 'earning', formula: 'other + 5' }),
    );
    expect(line(computePayslip(input), 'x1')?.amount).toBe('5.0000');
    input.components.push(
      comp({ code: 'x2', calcType: 'formula', kind: 'earning', formula: 'nope' }),
    );
    expect(() => computePayslip(input)).toThrow('متغير غير معروف');
  });

  it('التجاوز اليدوي: يُحفظ الآلي، ويُعاد حساب التابع والمجاميع', () => {
    const r = computePayslip(base({ manual: { housing: '300' } }));
    const h = line(r, 'housing');
    expect(h).toMatchObject({ amount: '300.0000', autoAmount: '100.0000', isManual: true });
    // الضمان يتبع السكن اليدوي: (900+300)*7.5% = 90
    expect(line(r, 'social')?.amount).toBe('90.0000');
    expect(line(r, 'social')?.isManual).toBe(false);
    expect(r.totals.gross).toBe('1240.0000');
    const b = computePayslip(base({ manual: { basic: '1000' } }));
    expect(line(b, 'basic')).toMatchObject({ amount: '1000.0000', autoAmount: '900.0000' });
  });

  it('بنود مضافة يدوياً تدخل المجاميع ولا تدخل الأسس', () => {
    const r = computePayslip(
      base({
        added: [
          { code: 'manual_1', nameAr: 'مكافأة', nameEn: null, kind: 'earning', amount: '50' },
          { code: 'manual_2', nameAr: 'سلفة', nameEn: null, kind: 'deduction', amount: '20' },
        ],
      }),
    );
    expect(r.totals.gross).toBe('1090.0000');
    expect(r.totals.net).toBe('931.0000');
    expect(line(r, 'social')?.amount).toBe('75.0000');
    expect(line(r, 'manual_1')).toMatchObject({ isAdded: true, isManual: true });
  });

  it('تحذير الصافي السالب، وكشف الحلقة، والتقريب نصف للأعلى', () => {
    const neg = computePayslip(base({ variables: { days_in_period: '30', absent_days: '60' } }));
    expect(neg.warnings).toContain('NEGATIVE_NET');
    const cyc = base();
    cyc.components.push(
      comp({ code: 'a', calcType: 'formula', kind: 'earning', formula: 'b + 1' }),
      comp({ code: 'b', calcType: 'formula', kind: 'earning', formula: 'a + 1' }),
    );
    cyc.allCodes.push('a', 'b');
    expect(() => computePayslip(cyc)).toThrow(EngineError);
    const r = computePayslip(
      base({
        components: [
          comp({
            code: 'p',
            calcType: 'formula',
            kind: 'earning',
            formula: '2.5',
            roundingDecimals: 0,
          }),
        ],
        allCodes: ['p'],
      }),
    );
    expect(line(r, 'p')?.amount).toBe('3.0000');
  });

  it('شرح «كيف حُسب؟» لكل بند', () => {
    const r = computePayslip(base());
    expect(line(r, 'social')?.explain).toMatchObject({
      type: 'percent',
      percent: '7.5',
      base: 'ins',
      baseAmount: '1000.0000',
    });
    expect(line(r, 'absence')?.explain).toMatchObject({
      type: 'formula',
      inputs: { basic: '900.0000', days_in_period: '30.0000', absent_days: '2.0000' },
    });
    expect(line(r, 'tax')?.explain).toMatchObject({
      type: 'rate_table',
      table: 'TAX',
      input: '1040.0000',
    });
  });
});
