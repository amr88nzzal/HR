import { describe, expect, it } from 'vitest';
import { PAYSLIP_PRESETS, payslipConfigSchema, payslipTemplateInput } from './payslip-template.js';

describe('قالب القسيمة', () => {
  it('القيم الافتراضية صالحة والتصاميم الجاهزة تجتاز التحقق', () => {
    expect(payslipConfigSchema.safeParse({}).success).toBe(true);
    for (const p of Object.values(PAYSLIP_PRESETS))
      expect(payslipConfigSchema.safeParse(p).success).toBe(true);
    expect(PAYSLIP_PRESETS.stacked.sections).toContain('lines');
    expect(PAYSLIP_PRESETS.detailed.sections).toContain('qr');
    expect(PAYSLIP_PRESETS.side_by_side.sections).toContain('qr');
  });

  it('يرفض الأقسام والحقول المكررة وغياب البنود واللون الخاطئ', () => {
    const bad = (c: object) => payslipConfigSchema.safeParse(c).success;
    expect(bad({ sections: ['header'] })).toBe(false);
    expect(bad({ sections: ['lines', 'lines'] })).toBe(false);
    expect(bad({ headerFields: [] })).toBe(false);
    expect(bad({ headerFields: ['month', 'month'] })).toBe(false);
    expect(bad({ accent: 'teal' })).toBe(false);
    expect(bad({ fontSize: 20 })).toBe(false);
  });

  it('الاسم الإنجليزي الفارغ يصير null', () => {
    const r = payslipTemplateInput.parse({ nameAr: 'س', nameEn: '  ', config: {} });
    expect(r.nameEn).toBeNull();
  });
});
