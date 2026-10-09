import nodemailer from 'nodemailer';
import type { MailSettings } from '../shared/config.js';

export type MailMessage = { to: string; subject: string; text: string; html: string };

/** وسيط إرسال البريد: يمكن استبداله (SMTP الآن، ومزوّد API لاحقاً) */
export type MailTransport = { send: (msg: MailMessage) => Promise<void> };

/**
 * SMTP عام: إما رابط (smtp://user:pass@host:587) أو مضيف ومنفذ وحساب.
 * المنفذ 465 = TLS مباشر؛ غيره (587) يرفع الاتصال إلى STARTTLS إن دعمه الخادم.
 */
export const createSmtpTransport = (settings: MailSettings): MailTransport => {
  const transporter =
    settings.kind === 'url'
      ? nodemailer.createTransport(settings.url)
      : nodemailer.createTransport({
          host: settings.host,
          port: settings.port,
          secure: settings.port === 465,
          ...(settings.user ? { auth: { user: settings.user, pass: settings.pass ?? '' } } : {}),
        });
  return {
    send: async (msg) => {
      await transporter.sendMail({ from: settings.from, ...msg });
    },
  };
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** يحوّل النص العادي إلى HTML بسيط بالاتجاه المناسب للغة */
export const toHtml = (subject: string, body: string, locale: 'ar' | 'en'): string => {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div dir="${dir}" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7">
<h3>${escapeHtml(subject)}</h3>${paragraphs}</div>`;
};
