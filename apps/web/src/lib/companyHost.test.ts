import { describe, expect, it } from 'vitest';
import { companyFromHost } from './companyHost';

describe('companyFromHost', () => {
  it('قالب لاحقة: {company}-hr', () => {
    const p = '{company}-hr.amrodev.com';
    expect(companyFromHost('abc-hr.amrodev.com', p)).toBe('abc');
    expect(companyFromHost('ABC-hr.amrodev.com', p)).toBe('abc');
    expect(companyFromHost('my-co-hr.amrodev.com', p)).toBe('my-co');
  });
  it('قالب بادئة: hr-{company}', () => {
    expect(companyFromHost('hr-xyz.amrodev.com', 'hr-{company}.amrodev.com')).toBe('xyz');
  });
  it('يتجاهل المضيفات الأخرى', () => {
    const p = '{company}-hr.amrodev.com';
    expect(companyFromHost('hr.amrodev.com', p)).toBeUndefined();
    expect(companyFromHost('localhost', p)).toBeUndefined();
    expect(companyFromHost('abc-hr.amrodev.com.evil.io', p)).toBeUndefined();
    expect(companyFromHost('a.b-hr.amrodev.com', p)).toBeUndefined();
    expect(companyFromHost('abc-hr.amrodev.com', 'no-placeholder.com')).toBeUndefined();
  });
});
