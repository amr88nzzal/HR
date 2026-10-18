import { Router, type Request, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import {
  emailSettingsInput,
  emailTestInput,
  telegramChatIdInput,
  telegramSettingsInput,
  type TelegramLinkDto,
  type TelegramMeDto,
} from '@hrms/shared';
import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import type { FieldCrypto } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import { requirePermission } from '../modules/identity/index.js';
import {
  createLinkCode,
  handleTelegramUpdate,
  telegramWebhookInfo,
  readEmailSettings,
  readTelegramSettings,
  saveEmailSettings,
  saveTelegramSettings,
  setLinkByChatId,
  verifyWebhookSecret,
  type MailProvider,
  type TelegramProvider,
} from './channels.js';
import type { TelegramApi } from './telegram.js';
import { toHtml } from './mail.js';

/** إعدادات قنوات الإشعار (البريد الآن، وتلغرام لاحقاً) — لمدير النظام. */
export const createChannelsRouter = (
  db: Db,
  authenticate: RequestHandler,
  opts: {
    crypto: FieldCrypto | undefined;
    mail: MailProvider;
    envSmtpConfigured: boolean;
    telegramApi: TelegramApi;
    telegram: TelegramProvider;
  },
): Router => {
  const router = Router();
  const run = <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };

  router.use(authenticate);

  router.get('/email', requirePermission('system.integration.read'), async (req, res, next) => {
    try {
      const data = await run(req, (ctx) => readEmailSettings(ctx, opts.envSmtpConfigured));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.put('/email', requirePermission('system.integration.manage'), async (req, res, next) => {
    try {
      const body = emailSettingsInput.parse(req.body);
      await run(req, (ctx) => saveEmailSettings(ctx, opts.crypto, body));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/email/test',
    requirePermission('system.integration.manage'),
    async (req, res, next) => {
      try {
        const { to } = emailTestInput.parse(req.body);
        const transport = await run(req, (ctx) => opts.mail(ctx));
        if (!transport)
          throw new AppError('EMAIL_NOT_CONFIGURED', 409, 'لا يوجد إعداد بريد مفعّل لهذه الشركة');
        const subject = 'اختبار إعداد البريد';
        const text = 'وصلت هذه الرسالة التجريبية من نظام شؤون الموظفين، فإعداد البريد يعمل.';
        try {
          await transport.send({ to, subject, text, html: toHtml(subject, text, 'ar') });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new AppError('EMAIL_SEND_FAILED', 502, `فشل الإرسال: ${msg.slice(0, 300)}`);
        }
        res.json({ data: { sent: true } });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── تلغرام: إعداد الشركة (إدارة) ──
  router.get('/telegram', requirePermission('system.integration.read'), async (req, res, next) => {
    try {
      res.json({ data: await run(req, (ctx) => readTelegramSettings(ctx)) });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/telegram',
    requirePermission('system.integration.manage'),
    async (req, res, next) => {
      try {
        const body = telegramSettingsInput.parse(req.body);
        const data = await run(req, (ctx) =>
          saveTelegramSettings(ctx, opts.crypto, opts.telegramApi, body),
        );
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/telegram/links',
    requirePermission('system.integration.read'),
    async (req, res, next) => {
      try {
        const data = await run(req, async (ctx): Promise<TelegramLinkDto[]> => {
          const rows = await ctx.trx
            .selectFrom('telegramLinks as l')
            .innerJoin('users as u', 'u.id', 'l.userId')
            .select(['u.id as userId', 'u.displayName', 'u.email', 'l.tgUsername', 'l.linkedAt'])
            .where('l.companyId', '=', ctx.companyId)
            .orderBy('u.displayName')
            .execute();
          return rows.map((r) => ({ ...r, linkedAt: r.linkedAt.toISOString() }));
        });
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  const manualLink = (req: Request, userId: string) =>
    run(req, async (ctx) => {
      const { chatId } = telegramChatIdInput.parse(req.body);
      const sender = await opts.telegram(ctx);
      if (!sender) throw new AppError('TELEGRAM_NOT_CONFIGURED', 409, 'قناة تلغرام غير مفعّلة');
      await setLinkByChatId(ctx, sender, userId, chatId);
    });

  router.put(
    '/telegram/links/:userId',
    requirePermission('system.integration.manage'),
    async (req, res, next) => {
      try {
        const userId = String(req.params['userId'] ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(userId))
          throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
        await manualLink(req, userId);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.put('/telegram/me', async (req, res, next) => {
    try {
      await manualLink(req, req.auth?.userId as string);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.delete(
    '/telegram/links/:userId',
    requirePermission('system.integration.manage'),
    async (req, res, next) => {
      try {
        const userId = String(req.params['userId'] ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(userId))
          throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
        await run(req, (ctx) =>
          ctx.trx.deleteFrom('telegramLinks').where('userId', '=', userId).execute(),
        );
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/telegram/webhook-info',
    requirePermission('system.integration.manage'),
    async (req, res, next) => {
      try {
        const data = await run(req, (ctx) =>
          telegramWebhookInfo(ctx, opts.crypto, opts.telegramApi),
        );
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/telegram/test',
    requirePermission('system.integration.manage'),
    async (req, res, next) => {
      try {
        const userId = req.auth?.userId as string;
        await run(req, async (ctx) => {
          const sender = await opts.telegram(ctx);
          if (!sender) throw new AppError('TELEGRAM_NOT_CONFIGURED', 409, 'قناة تلغرام غير مفعّلة');
          const link = await ctx.trx
            .selectFrom('telegramLinks')
            .select('chatId')
            .where('userId', '=', userId)
            .executeTakeFirst();
          if (!link) throw new AppError('TELEGRAM_NOT_LINKED', 409, 'حسابك غير مربوط بتلغرام بعد');
          try {
            await sender.send(link.chatId, 'رسالة تجريبية من نظام شؤون الموظفين ✅');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError('TELEGRAM_API_FAILED', 502, `فشل الإرسال: ${msg.slice(0, 300)}`);
          }
        });
        res.json({ data: { sent: true } });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── تلغرام: ربط حساب المستخدم نفسه (يكفي تسجيل الدخول) ──
  router.get('/telegram/me', async (req, res, next) => {
    try {
      const userId = req.auth?.userId as string;
      const data = await run(req, async (ctx): Promise<TelegramMeDto> => {
        const cfg = await readTelegramSettings(ctx);
        const link = await ctx.trx
          .selectFrom('telegramLinks')
          .select('tgUsername')
          .where('userId', '=', userId)
          .executeTakeFirst();
        return {
          available: !!cfg?.enabled && !!cfg.hasToken,
          autoLink: !!cfg?.enabled && !!cfg.botUsername && !!cfg.publicUrl,
          linked: !!link,
          tgUsername: link?.tgUsername ?? null,
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/telegram/me/link-code', async (req, res, next) => {
    try {
      const userId = req.auth?.userId as string;
      res.json({ data: await run(req, (ctx) => createLinkCode(ctx, userId)) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/telegram/me', async (req, res, next) => {
    try {
      const userId = req.auth?.userId as string;
      await run(req, (ctx) =>
        ctx.trx.deleteFrom('telegramLinks').where('userId', '=', userId).execute(),
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/**
 * webhook تلغرام: بلا مصادقة مستخدم؛ يُتحقق من سرّ الشركة في ترويسة تلغرام.
 * يُركَّب قبل أي راوتر يفرض المصادقة على كل المسارات.
 */
export const createTelegramWebhookRouter = (
  db: Db,
  opts: { telegram: TelegramProvider; logger?: Logger },
): Router => {
  const router = Router();
  router.post('/:companyId', async (req, res) => {
    const companyId = String(req.params['companyId'] ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return void res.status(404).end();
    try {
      const header = req.header('x-telegram-bot-api-secret-token');
      // المعاملة تثبّت الربط أولاً؛ والرد يُرسَل بعد التثبيت وفشله لا يلغي الربط
      // The transaction commits the link first; the reply is sent after commit and cannot undo it.
      const out = await withTenant(db, { companyId, requestId: req.requestId }, async (ctx) => {
        if (!(await verifyWebhookSecret(ctx, header))) throw new AppError('FORBIDDEN', 403, 'x');
        const sender = await opts.telegram(ctx);
        if (!sender) return null;
        const reply = await handleTelegramUpdate(ctx, req.body);
        return reply ? { sender, reply } : null;
      });
      if (out) {
        try {
          await out.sender.send(out.reply.chatId, out.reply.text);
        } catch (err) {
          opts.logger?.warn({ err, companyId }, 'telegram webhook: reply failed (link kept)');
        }
      }
      res.json({ ok: true });
    } catch (err) {
      const forbidden = err instanceof AppError && err.status === 403;
      // لا نكشف سبب الرفض لتلغرام، لكنه يُسجَّل للتشخيص (سرّ غير مطابق أو القناة معطّلة)
      // The reason is not exposed to Telegram but is logged for diagnosis.
      if (forbidden)
        opts.logger?.warn({ companyId }, 'telegram webhook rejected: secret mismatch or disabled');
      else opts.logger?.error({ err, companyId }, 'telegram webhook: processing failed');
      // أخطاء المعالجة لا تُعاد لتلغرام كي لا يكرّر الإرسال
      res.status(forbidden ? 403 : 200).json({ ok: false });
    }
  });

  return router;
};
