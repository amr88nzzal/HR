import { describe, expect, it } from 'vitest';
import { loadConfig, mailSettings } from './config.js';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('إعدادات البريد', () => {
  it('القيم الفارغة (كما تصل من compose) تعني غير مضبوط', () => {
    const c = loadConfig(
      env({
        SMTP_URL: '',
        SMTP_HOST: '',
        SMTP_PORT: '',
        SMTP_USER: '',
        SMTP_PASS: '',
        MAIL_FROM: '',
        EMAIL_FROM: '',
      }),
    );
    expect(c.SMTP_URL).toBeUndefined();
    expect(c.SMTP_PORT).toBeUndefined();
    expect(mailSettings(c)).toBeUndefined();
  });

  it('المتغيرات المنفصلة (Gmail): المنفذ رقم، والمرسِل من EMAIL_FROM', () => {
    const c = loadConfig(
      env({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '587',
        SMTP_USER: 'me@gmail.com',
        SMTP_PASS: 'p@ss word:/?#',
        EMAIL_FROM: 'me@gmail.com',
        EMAIL_ALERT_ADDRESS: 'me@gmail.com', // متغير غير مستخدم لا يكسر التحميل
      }),
    );
    expect(mailSettings(c)).toEqual({
      kind: 'host',
      host: 'smtp.gmail.com',
      port: 587,
      user: 'me@gmail.com',
      pass: 'p@ss word:/?#',
      from: 'me@gmail.com',
    });
  });

  it('المنفذ الافتراضي 587، والمرسِل يرجع إلى المستخدم ثم إلى الافتراضي', () => {
    expect(mailSettings(loadConfig(env({ SMTP_HOST: 'h', SMTP_USER: 'u@x.com' })))).toMatchObject({
      port: 587,
      from: 'u@x.com',
    });
    expect(mailSettings(loadConfig(env({ SMTP_HOST: 'h' })))).toMatchObject({
      from: 'HRMS <no-reply@localhost>',
    });
  });

  it('MAIL_FROM يسبق EMAIL_FROM، وSMTP_URL يسبق المضيف', () => {
    const c = loadConfig(
      env({
        SMTP_URL: 'smtp://u:p@mail.example.com:587',
        SMTP_HOST: 'ignored',
        MAIL_FROM: 'A <a@x.com>',
        EMAIL_FROM: 'b@x.com',
      }),
    );
    expect(mailSettings(c)).toEqual({
      kind: 'url',
      url: 'smtp://u:p@mail.example.com:587',
      from: 'A <a@x.com>',
    });
  });

  it('يرفض رابطاً خاطئاً ومنفذاً خارج النطاق', () => {
    expect(() => loadConfig(env({ SMTP_URL: 'not a url' }))).toThrow();
    expect(() => loadConfig(env({ SMTP_HOST: 'h', SMTP_PORT: '70000' }))).toThrow();
  });
});
