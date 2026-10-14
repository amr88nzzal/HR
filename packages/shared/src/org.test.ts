import { describe, expect, it } from 'vitest';
import { branchInput, withVersion } from './org.js';

describe('withVersion', () => {
  it('التعديل الجزئي لا يعيد الحقول غير المرسلة إلى قيمها الافتراضية', () => {
    expect(withVersion(branchInput.shape).parse({ version: 1, nameAr: 'x' })).toEqual({
      nameAr: 'x',
      version: 1,
    });
  });
});
