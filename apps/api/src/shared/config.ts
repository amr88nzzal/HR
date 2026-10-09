import { z } from 'zod';

/** القيمة الفارغة تُعامل كغير مضبوطة */
const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** اتصال التطبيق (دور hrms_app الخاضع لـ RLS) */
  DATABASE_URL: z.string().url().optional(),
  /** اتصال المالك: للترحيل والـ CLI فقط (يتجاوز RLS) */
  DATABASE_ADMIN_URL: z.string().url().optional(),
  /** كلمة مرور دور hrms_app؛ يضبطها أمر post-migrate */
  APP_DB_PASSWORD: z.string().min(8).optional(),
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** تشفير الحقول الحساسة: "k1:base64,k2:base64" (32 بايت لكل مفتاح) */
  ENCRYPTION_KEYS: z.string().optional(),
  ENCRYPTION_KEY_ID: z.string().optional(),
  /** مفتاح HMAC للبصمات القابلة للبحث (32 بايت base64)؛ لا يُغيَّر بعد الاستخدام */
  ENCRYPTION_DIGEST_KEY: z.string().optional(),
  /** مجلد تخزين الملفات المرفوعة (يُحمَّل كـ volume ويُنسخ احتياطياً مع القاعدة) */
  STORAGE_DIR: z.string().min(1).default('./data/files'),
  /**
   * البريد (اختياري). طريقتان: SMTP_URL مثل smtp://user:pass@host:587،
   * أو المتغيرات المنفصلة SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (الأسهل مع كلمات المرور ذات الرموز).
   * بغيابهما تُعلَّم رسائل البريد skipped. القيمة الفارغة (كما تصل من compose) = غير مضبوط.
   */
  SMTP_URL: blank(z.string().url().optional()),
  SMTP_HOST: blank(z.string().min(1).optional()),
  SMTP_PORT: blank(z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_USER: blank(z.string().min(1).optional()),
  SMTP_PASS: blank(z.string().min(1).optional()),
  /** عنوان المرسِل: MAIL_FROM أو EMAIL_FROM (الأول له الأسبقية) */
  MAIL_FROM: blank(z.string().min(3).optional()),
  EMAIL_FROM: blank(z.string().min(3).optional()),
  /** الشركة الافتراضية عند غياب company في طلب الدخول (نشر الشركة الواحدة) */
  DEFAULT_COMPANY_SLUG: z.string().min(1).default('main'),
});

export type Config = z.infer<typeof envSchema>;

/** يتحقق من متغيرات البيئة عند الإقلاع ويفشل بسرعة إن كانت ناقصة أو خاطئة. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `إعدادات بيئة غير صالحة: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
};

export type MailSettings =
  | { kind: 'url'; url: string; from: string }
  | {
      kind: 'host';
      host: string;
      port: number;
      user: string | undefined;
      pass: string | undefined;
      from: string;
    };

const DEFAULT_FROM = 'HRMS <no-reply@localhost>';

/** يحدد إعدادات البريد من البيئة؛ undefined إن لم يُضبط شيء. SMTP_URL له الأسبقية على المتغيرات المنفصلة. */
export const mailSettings = (config: Config): MailSettings | undefined => {
  const from = config.MAIL_FROM ?? config.EMAIL_FROM ?? config.SMTP_USER ?? DEFAULT_FROM;
  if (config.SMTP_URL) return { kind: 'url', url: config.SMTP_URL, from };
  if (config.SMTP_HOST)
    return {
      kind: 'host',
      host: config.SMTP_HOST,
      port: config.SMTP_PORT ?? 587,
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
      from,
    };
  return undefined;
};
