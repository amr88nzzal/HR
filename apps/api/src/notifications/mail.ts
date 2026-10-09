import nodemailer from 'nodemailer';

export type MailMessage = { to: string; subject: string; text: string; html: string };

/** وسيط إرسال البريد: يمكن استبداله (SMTP الآن، ومزوّد API لاحقاً) */
export type MailTransport = { send: (msg: MailMessage) => Promise<void> };

/** SMTP عام: SMTP_URL مثل smtp://user:pass@host:587 (أو smtps:// للمنفذ 465) */
export const createSmtpTransport = (smtpUrl: string, from: string): MailTransport => {
  const transporter = nodemailer.createTransport(smtpUrl);
  return {
    send: async (msg) => {
      await transporter.sendMail({ from, ...msg });
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
