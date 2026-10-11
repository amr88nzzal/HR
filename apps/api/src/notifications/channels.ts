import nodemailer from 'nodemailer';
import type { EmailSettingsDto, EmailSettingsInput } from '@hrms/shared';
import type { Ctx } from '../db/tenant.js';
import type { FieldCrypto } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import { createSmtpTransport, type MailTransport } from './mail.js';

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
