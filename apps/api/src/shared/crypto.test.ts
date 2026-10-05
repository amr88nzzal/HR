import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFieldCrypto } from './crypto.js';

const k = () => randomBytes(32).toString('base64');

describe('تشفير الحقول', () => {
  const k1 = k();
  const k2 = k();
  const digestKey = k();
  const c1 = createFieldCrypto({ keysSpec: `k1:${k1}`, currentKeyId: 'k1', digestKey });

  it('يشفّر ويفك ويختلف الناتج كل مرة', () => {
    const a = c1.encrypt('SA0380000000608010167519', 'ctx');
    const b = c1.encrypt('SA0380000000608010167519', 'ctx');
    expect(a).not.toBe(b);
    expect(a).not.toContain('SA03');
    expect(c1.decrypt(a, 'ctx')).toBe('SA0380000000608010167519');
  });
  it('يرفض فك الحمولة بسياق مختلف أو عند العبث بها', () => {
    const a = c1.encrypt('secret', 'ctx');
    expect(() => c1.decrypt(a, 'other')).toThrow();
    expect(() => c1.decrypt(a.slice(0, -2) + 'AA', 'ctx')).toThrow();
  });
  it('تدوير المفاتيح: القديم يُفك بعد إضافة مفتاح جديد حالي', () => {
    const old = c1.encrypt('x', 'ctx');
    const c2 = createFieldCrypto({ keysSpec: `k1:${k1},k2:${k2}`, currentKeyId: 'k2', digestKey });
    expect(c2.decrypt(old, 'ctx')).toBe('x');
    expect(c2.encrypt('y', 'ctx').split('.')[1]).toBe('k2');
  });
  it('البصمة ثابتة ومستقلة عن مفتاح التشفير', () => {
    const c2 = createFieldCrypto({ keysSpec: `k2:${k2}`, currentKeyId: 'k2', digestKey });
    expect(c1.digest('abc')).toBe(c2.digest('abc'));
    expect(c1.digest('abc')).not.toBe(c1.digest('abd'));
  });
  it('يرفض مفاتيح بطول خاطئ', () => {
    expect(() =>
      createFieldCrypto({ keysSpec: 'k1:AAAA', currentKeyId: 'k1', digestKey }),
    ).toThrow();
  });
});
