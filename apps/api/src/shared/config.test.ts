import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('إعدادات البريد', () => {
  it('SMTP_URL الفارغ (كما يصل من compose) يُعامل كغير مضبوط', () => {
    const c = loadConfig({ SMTP_URL: '', MAIL_FROM: '' } as NodeJS.ProcessEnv);
    expect(c.SMTP_URL).toBeUndefined();
    expect(c.MAIL_FROM).toBe('HRMS <no-reply@localhost>');
  });
  it('يقبل رابط SMTP صالحاً ويرفض الخاطئ', () => {
    expect(
      loadConfig({ SMTP_URL: 'smtp://u:p@mail.example.com:587' } as NodeJS.ProcessEnv).SMTP_URL,
    ).toContain('mail.example.com');
    expect(() => loadConfig({ SMTP_URL: 'not a url' } as NodeJS.ProcessEnv)).toThrow();
  });
});
