import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.js';

describe('سياسة كلمة المرور', () => {
  it('ترفض القصيرة والشائعة والمحتوية على البريد', () => {
    expect(checkPasswordPolicy('short')).toMatch(/10/);
    expect(checkPasswordPolicy('password123')).toMatch(/شائعة/);
    expect(checkPasswordPolicy('aaaaaaaaaaaa')).toMatch(/شائعة/);
    expect(checkPasswordPolicy('xx-ahmed.ali-xx', { email: 'ahmed.ali@firm.test' })).toMatch(
      /بريد/,
    );
  });
  it('تقبل عبارة طويلة', () => {
    expect(checkPasswordPolicy('correct-horse-battery')).toBeNull();
  });
  it('التجزئة والتحقق', async () => {
    const h = await hashPassword('correct-horse-battery');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });
});
