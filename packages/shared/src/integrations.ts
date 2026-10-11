import { z } from 'zod';

export const INTEGRATION_PROVIDERS = ['email', 'telegram'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

const mailbox = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^([^<>\n\r]+<[^<>\s@]+@[^<>\s@]+>|[^\s@<>]+@[^\s@<>]+)$/, 'عنوان مرسِل غير صالح');

export const emailSettingsInput = z.object({
  enabled: z.boolean().default(true),
  host: z.string().trim().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  /** true = TLS مباشر (المنفذ 465)؛ false = STARTTLS عند توفره (587) */
  secure: z.boolean().default(false),
  user: z.string().trim().max(200).nullish(),
  /** غيابه = إبقاء المحفوظ؛ نص فارغ = حذفه */
  password: z.string().max(500).optional(),
  from: mailbox,
});
export type EmailSettingsInput = z.infer<typeof emailSettingsInput>;

export const emailTestInput = z.object({ to: z.string().trim().email().max(200) });

export type EmailSettingsDto = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
  hasPassword: boolean;
  /** مصدر الإعداد الفعّال: القاعدة، أو متغيرات البيئة (SMTP_URL)، أو لا شيء */
  source: 'db' | 'env' | 'none';
};

export const telegramSettingsInput = z.object({
  enabled: z.boolean().default(true),
  /** غيابه = إبقاء المحفوظ */
  botToken: z
    .string()
    .trim()
    .regex(/^\d{5,}:[A-Za-z0-9_-]{20,}$/, 'توكن بوت غير صالح')
    .optional(),
  /**
   * عنوان الموقع العام (https) لتفعيل الربط التلقائي عبر webhook؛ فارغ = بلا webhook
   * (يُدخَل chat id يدوياً لكل مستخدم).
   */
  publicUrl: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v.replace(/\/+$/, ''))
    .refine((v) => v === '' || /^https:\/\/[^\s/]+(\/\S*)?$/.test(v), 'يلزم عنوان https')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
});
export type TelegramSettingsInput = z.infer<typeof telegramSettingsInput>;

export type TelegramSettingsDto = {
  enabled: boolean;
  hasToken: boolean;
  botUsername: string | null;
  /** null = بلا webhook (ربط يدوي بـ chat id) */
  publicUrl: string | null;
};

export type TelegramLinkDto = {
  userId: string;
  displayName: string;
  email: string;
  tgUsername: string | null;
  linkedAt: string;
};

export type TelegramMeDto = {
  /** القناة مفعّلة على مستوى الشركة */
  available: boolean;
  /** الربط التلقائي برابط Start متاح (webhook مضبوط) */
  autoLink: boolean;
  linked: boolean;
  tgUsername: string | null;
};

export const telegramChatIdInput = z.object({
  chatId: z
    .string()
    .trim()
    .regex(/^-?\d{4,20}$/, 'chat id أرقام فقط'),
});
