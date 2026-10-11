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
