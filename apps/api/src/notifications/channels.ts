import nodemailer from 'nodemailer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  EmailSettingsDto,
  EmailSettingsInput,
  TelegramSettingsDto,
  TelegramSettingsInput,
} from '@hrms/shared';
import type { Ctx } from '../db/tenant.js';
import type { FieldCrypto } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import { createSmtpTransport, type MailTransport } from './mail.js';
import type { TelegramApi } from './telegram.js';

const AAD = 'integration_settings.secret_enc';

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  from: string;
};

type Row = { enabled: boolean; config: Record<string, unknown>; secretEnc: string | null };

const loadRow = async (ctx: Ctx, provider: 'email' | 'telegram'): Promise<Row | undefined> =>
  ctx.trx
    .selectFrom('integrationSettings')
    .select(['enabled', 'config', 'secretEnc'])
    .where('companyId', '=', ctx.companyId)
    .where('provider', '=', provider)
    .executeTakeFirst();

export const smtpTransportFrom = (cfg: EmailConfig, password: string | null): MailTransport => {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: password ?? '' } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    send: async (msg) => {
      await transporter.sendMail({ from: cfg.from, ...msg });
    },
  };
};

/** يعيد وسيط الإرسال الفعّال للشركة: إعداد القاعدة المفعّل، وإلا SMTP_URL من البيئة، وإلا لا شيء. */
export type MailProvider = (ctx: Ctx) => Promise<MailTransport | undefined>;

export const createMailProvider = (opts: {
  crypto: FieldCrypto | undefined;
  envSmtpUrl: string | undefined;
  envFrom: string;
}): MailProvider => {
  const env = opts.envSmtpUrl ? createSmtpTransport(opts.envSmtpUrl, opts.envFrom) : undefined;
  return async (ctx) => {
    const row = await loadRow(ctx, 'email');
    if (row?.enabled) {
      const cfg = row.config as unknown as EmailConfig;
      const password =
        row.secretEnc && opts.crypto ? opts.crypto.decrypt(row.secretEnc, AAD) : null;
      return smtpTransportFrom(cfg, password);
    }
    return env;
  };
};

export const readEmailSettings = async (
  ctx: Ctx,
  envConfigured: boolean,
): Promise<EmailSettingsDto | null> => {
  const row = await loadRow(ctx, 'email');
  if (!row) {
    return envConfigured
      ? {
          enabled: false,
          host: '',
          port: 587,
          secure: false,
          user: null,
          from: '',
          hasPassword: false,
          source: 'env',
        }
      : null;
  }
  const cfg = row.config as unknown as EmailConfig;
  return {
    enabled: row.enabled,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    hasPassword: !!row.secretEnc,
    source: row.enabled ? 'db' : envConfigured ? 'env' : 'none',
  };
};

export const saveEmailSettings = async (
  ctx: Ctx,
  crypto: FieldCrypto | undefined,
  input: EmailSettingsInput,
): Promise<void> => {
  const existing = await loadRow(ctx, 'email');
  let secretEnc = existing?.secretEnc ?? null;
  if (input.password !== undefined) {
    if (input.password === '') secretEnc = null;
    else {
      if (!crypto) throw new AppError('CRYPTO_UNAVAILABLE', 503, 'مفاتيح التشفير غير مضبوطة');
      secretEnc = crypto.encrypt(input.password, AAD);
    }
  }
  const config: EmailConfig = {
    host: input.host,
    port: input.port,
    secure: input.secure,
    user: input.user || null,
    from: input.from,
  };
  if (existing) {
    await ctx.trx
      .updateTable('integrationSettings')
      .set({ enabled: input.enabled, config: JSON.stringify(config), secretEnc })
      .where('companyId', '=', ctx.companyId)
      .where('provider', '=', 'email')
      .execute();
  } else {
    await ctx.trx
      .insertInto('integrationSettings')
      .values({
        companyId: ctx.companyId,
        provider: 'email',
        enabled: input.enabled,
        config: JSON.stringify(config),
        secretEnc,
      })
      .execute();
  }
};

// ───────────── تلغرام ─────────────
export type TelegramConfig = {
  botUsername: string | null;
  publicUrl: string | null;
  webhookSecret: string;
};

export const telegramWebhookUrl = (publicUrl: string, companyId: string) =>
  `${publicUrl}/api/v1/integrations/telegram/webhook/${companyId}`;

const loadTelegram = async (ctx: Ctx) => {
  const row = await loadRow(ctx, 'telegram');
  if (!row) return undefined;
  return {
    enabled: row.enabled,
    config: row.config as unknown as TelegramConfig,
    secretEnc: row.secretEnc,
  };
};

export const readTelegramSettings = async (ctx: Ctx): Promise<TelegramSettingsDto | null> => {
  const row = await loadTelegram(ctx);
  if (!row) return null;
  return {
    enabled: row.enabled,
    hasToken: !!row.secretEnc,
    botUsername: row.config.botUsername,
    publicUrl: row.config.publicUrl,
  };
};

export const saveTelegramSettings = async (
  ctx: Ctx,
  crypto: FieldCrypto | undefined,
  api: TelegramApi,
  input: TelegramSettingsInput,
): Promise<TelegramSettingsDto> => {
  if (!crypto) throw new AppError('CRYPTO_UNAVAILABLE', 503, 'مفاتيح التشفير غير مضبوطة');
  const existing = await loadTelegram(ctx);
  const token =
    input.botToken ?? (existing?.secretEnc ? crypto.decrypt(existing.secretEnc, AAD) : undefined);
  if (!token) throw new AppError('TELEGRAM_TOKEN_REQUIRED', 400, 'أدخل توكن البوت');
  let botUsername = existing?.config.botUsername ?? null;
  try {
    if (input.botToken || !botUsername) {
      const me = await api.call<{ username?: string }>(token, 'getMe');
      botUsername = me.username ?? null;
    }
    const webhookSecret = existing?.config.webhookSecret ?? randomBytes(24).toString('hex');
    if (input.enabled && input.publicUrl) {
      await api.call(token, 'setWebhook', {
        url: telegramWebhookUrl(input.publicUrl, ctx.companyId),
        secret_token: webhookSecret,
        allowed_updates: ['message'],
      });
    } else {
      await api.call(token, 'deleteWebhook');
    }
    const config: TelegramConfig = {
      botUsername,
      publicUrl: input.publicUrl ?? null,
      webhookSecret,
    };
    const secretEnc = input.botToken
      ? crypto.encrypt(input.botToken, AAD)
      : (existing?.secretEnc ?? null);
    if (existing) {
      await ctx.trx
        .updateTable('integrationSettings')
        .set({ enabled: input.enabled, config: JSON.stringify(config), secretEnc })
        .where('companyId', '=', ctx.companyId)
        .where('provider', '=', 'telegram')
        .execute();
    } else {
      await ctx.trx
        .insertInto('integrationSettings')
        .values({
          companyId: ctx.companyId,
          provider: 'telegram',
          enabled: input.enabled,
          config: JSON.stringify(config),
          secretEnc,
        })
        .execute();
    }
    return {
      enabled: input.enabled,
      hasToken: true,
      botUsername,
      publicUrl: input.publicUrl ?? null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError('TELEGRAM_API_FAILED', 502, `تعذّر الاتصال بتلغرام: ${msg.slice(0, 300)}`);
  }
};

/** مرسِل رسائل تلغرام لشركة؛ undefined إن لم تُفعَّل القناة. */
export type TelegramSender = { send: (chatId: string, text: string) => Promise<void> };
export type TelegramProvider = (ctx: Ctx) => Promise<TelegramSender | undefined>;

export const createTelegramProvider = (opts: {
  crypto: FieldCrypto | undefined;
  api: TelegramApi;
}): TelegramProvider => {
  return async (ctx) => {
    const row = await loadTelegram(ctx);
    if (!row?.enabled || !row.secretEnc || !opts.crypto) return undefined;
    const token = opts.crypto.decrypt(row.secretEnc, AAD);
    return {
      send: async (chatId, text) => {
        await opts.api.call(token, 'sendMessage', {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        });
      },
    };
  };
};

/** رمز ربط من 8 خانات (بلا أحرف ملتبسة)؛ صالح 15 دقيقة، ويستبدل أي رمز سابق للمستخدم. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () =>
  Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

export const createLinkCode = async (ctx: Ctx, userId: string) => {
  const tg = await loadTelegram(ctx);
  if (!tg?.enabled || !tg.config.botUsername || !tg.config.publicUrl)
    throw new AppError(
      'TELEGRAM_NOT_CONFIGURED',
      409,
      'الربط التلقائي غير مفعّل (أدخل chat id يدوياً)',
    );
  await ctx.trx.deleteFrom('telegramLinkCodes').where('userId', '=', userId).execute();
  const code = newCode();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await ctx.trx
    .insertInto('telegramLinkCodes')
    .values({ companyId: ctx.companyId, userId, code, expiresAt })
    .execute();
  return {
    code,
    deepLink: `https://t.me/${tg.config.botUsername}?start=${code}`,
    expiresAt: expiresAt.toISOString(),
  };
};

/** يعالج تحديث تلغرام الوارد (webhook): `/start CODE` يربط حساب المستخدم. */
export const handleTelegramUpdate = async (
  ctx: Ctx,
  sender: TelegramSender,
  update: unknown,
): Promise<void> => {
  const msg = (
    update as { message?: { text?: string; chat?: { id?: number }; from?: { username?: string } } }
  ).message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();
  if (chatId === undefined || !text) return;
  const chat = String(chatId);
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,16})$/.exec(text);
  if (!m) {
    await sender.send(chat, 'لربط حسابك افتح «الإشعارات» في النظام واضغط «ربط تلغرام».');
    return;
  }
  const row = await ctx.trx
    .selectFrom('telegramLinkCodes')
    .select(['id', 'userId'])
    .where('companyId', '=', ctx.companyId)
    .where('code', '=', (m[1] as string).toUpperCase())
    .where('expiresAt', '>', new Date())
    .executeTakeFirst();
  if (!row) {
    await sender.send(chat, 'رمز الربط غير صالح أو منتهٍ. أنشئ رمزاً جديداً من النظام.');
    return;
  }
  // حساب تلغرام واحد لكل مستخدم، ومستخدم واحد لكل محادثة
  await ctx.trx
    .deleteFrom('telegramLinks')
    .where('companyId', '=', ctx.companyId)
    .where((eb) => eb.or([eb('userId', '=', row.userId), eb('chatId', '=', chat)]))
    .execute();
  await ctx.trx
    .insertInto('telegramLinks')
    .values({
      companyId: ctx.companyId,
      userId: row.userId,
      chatId: chat,
      tgUsername: msg?.from?.username ?? null,
    })
    .execute();
  await ctx.trx.deleteFrom('telegramLinkCodes').where('id', '=', row.id).execute();
  await sender.send(chat, 'تم ربط حسابك بنظام شؤون الموظفين ✅ ستصلك الإشعارات هنا.');
};

export const verifyWebhookSecret = async (ctx: Ctx, header: string | undefined) => {
  const tg = await loadTelegram(ctx);
  if (!tg?.enabled || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(tg.config.webhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** ربط يدوي: يتحقق بإرسال رسالة إلى chat id (تفشل إن لم يبدأ صاحبه المحادثة مع البوت). */
export const setLinkByChatId = async (
  ctx: Ctx,
  sender: TelegramSender,
  userId: string,
  chatId: string,
): Promise<void> => {
  const user = await ctx.trx
    .selectFrom('users')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user) throw new AppError('NOT_FOUND', 404, 'المستخدم غير موجود');
  try {
    await sender.send(chatId, 'تم ربط حسابك بنظام شؤون الموظفين ✅ ستصلك الإشعارات هنا.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(
      'TELEGRAM_API_FAILED',
      502,
      `تعذّر الإرسال إلى chat id (هل بدأ صاحبه المحادثة مع البوت؟): ${msg.slice(0, 200)}`,
    );
  }
  await ctx.trx
    .deleteFrom('telegramLinks')
    .where('companyId', '=', ctx.companyId)
    .where((eb) => eb.or([eb('userId', '=', userId), eb('chatId', '=', chatId)]))
    .execute();
  await ctx.trx
    .insertInto('telegramLinks')
    .values({ companyId: ctx.companyId, userId, chatId, tgUsername: null })
    .execute();
};
