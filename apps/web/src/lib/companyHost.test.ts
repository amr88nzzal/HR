import { describe, expect, it } from 'vitest';
import { companyFromHost } from './companyHost';

describe('companyFromHost', () => {
  const base = 'hr.amrodev.com';
  it('يستخرج رمز الشركة', () => {
    expect(companyFromHost('acme.hr.amrodev.com', base)).toBe('acme');
    expect(companyFromHost('ACME.hr.amrodev.com', base)).toBe('acme');
  });
  it('يتجاهل النطاق الأساسي وغيره', () => {
    expect(companyFromHost('hr.amrodev.com', base)).toBeUndefined();
    expect(companyFromHost('localhost', base)).toBeUndefined();
    expect(companyFromHost('evilhr.amrodev.com', base)).toBeUndefined();
    expect(companyFromHost('a.b.hr.amrodev.com', base)).toBeUndefined();
  });
});
