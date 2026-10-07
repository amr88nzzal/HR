import { z } from 'zod';

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
