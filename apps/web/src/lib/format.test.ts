import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, formatDate, formatDateTime, formatNumber } from './format';

const s = DEFAULT_FORMAT;

describe('التنسيق حسب الإعدادات', () => {
  it('تواريخ ميلادية بالصيغ الثلاث وبمنطقة الشركة الزمنية', () => {
    const d = '2026-03-05T21:30:00Z'; // الرياض UTC+3 → 6 مارس 00:30
    expect(formatDate(d, s)).toBe('06/03/2026');
    expect(formatDate(d, { ...s, dateFormat: 'YYYY-MM-DD' })).toBe('2026-03-06');
    expect(formatDate(d, { ...s, dateFormat: 'MM/DD/YYYY' })).toBe('03/06/2026');
  });
  it('تقويم هجري وأرقام عربية', () => {
    const out = formatDate('2026-03-06T12:00:00Z', {
      ...s,
      calendar: 'hijri',
      numberDigits: 'arabic',
    });
    expect(out).toMatch(/^[٠-٩]{2}\/[٠-٩]{2}\/١٤٤٧$/);
  });
  it('الوقت 12 و24 ساعة', () => {
    const d = '2026-03-05T21:30:00Z';
    expect(formatDateTime(d, { ...s, timeFormat: '24h' })).toBe('06/03/2026 00:30');
    expect(formatDateTime(d, s)).toBe('06/03/2026 12:30 ص');
    expect(formatDateTime(d, { ...s, locale: 'en' })).toBe('06/03/2026 12:30 AM');
  });
  it('الأرقام: فواصل، تقريب نصي دقيق، وأرقام عربية', () => {
    expect(formatNumber('1234567.891', 2, s)).toBe('1,234,567.89');
    expect(formatNumber('0.005', 2, s)).toBe('0.01');
    expect(formatNumber('99999999999999999.995', 2, s)).toBe('100,000,000,000,000,000.00');
    expect(formatNumber('-1500', 2, { ...s, decimalSeparator: ',', thousandsSeparator: '.' })).toBe(
      '-1.500,00',
    );
    expect(formatNumber(1234.5, 1, { ...s, numberDigits: 'arabic' })).toBe('١,٢٣٤.٥');
  });
  it('قيم فارغة', () => {
    expect(formatDate(null)).toBe('');
    expect(formatNumber(undefined, 2)).toBe('');
  });
});
