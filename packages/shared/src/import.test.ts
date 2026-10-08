import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  mapHeaders,
  parseEmploymentType,
  parseGender,
  parseImportDate,
  parseMarital,
} from './import.js';

describe('ترويسة ملف الاستيراد', () => {
  it('تقبل العربية والإنجليزية والمفتاح ويُبلَّغ عن غير المعروف والناقص', () => {
    const r = mapHeaders(['الاسم الأول (عربي)', 'FAMILY_NAME_AR', 'عمود غريب', 'birthDate', null]);
    expect(r.keys).toEqual(['firstNameAr', 'familyNameAr', null, 'birthDate', null]);
    expect(r.unknown).toEqual(['عمود غريب']);
    expect(r.missing).toEqual([]);
    expect(mapHeaders(['الجوال']).missing).toEqual(['firstNameAr', 'familyNameAr']);
  });
  it('مفاتيح الأعمدة فريدة', () => {
    expect(new Set(IMPORT_COLUMNS.map((c) => c.key)).size).toBe(IMPORT_COLUMNS.length);
  });
});

describe('قيم الخلايا', () => {
  it('الجنس والحالة الاجتماعية ونوع التوظيف بالعربية والإنجليزية وبتطبيع الهمزات', () => {
    expect(parseGender('ذكر')).toBe('male');
    expect(parseGender('أنثى')).toBe('female');
    expect(parseGender('F')).toBe('female');
    expect(parseGender('؟')).toBeUndefined();
    expect(parseMarital('متزوجة')).toBe('married');
    expect(parseMarital('أعزب')).toBe('single');
    expect(parseEmploymentType('مؤقت')).toBe('temporary');
    expect(parseEmploymentType('دوام كامل')).toBe('full_time');
    expect(parseEmploymentType('Full_Time')).toBe('full_time');
  });
  it('التاريخ: خلية تاريخ أو ISO فقط', () => {
    expect(parseImportDate(new Date('2024-03-05T00:00:00Z'))).toBe('2024-03-05');
    expect(parseImportDate('2024-3-5')).toBe('2024-03-05');
    expect(parseImportDate('٢٠٢٤-٠٣-٠٥')).toBe('2024-03-05');
    expect(parseImportDate('05/03/2024')).toBeNull();
    expect(parseImportDate('2024-02-30')).toBeNull();
    expect(parseImportDate(45000)).toBeNull();
  });
});
