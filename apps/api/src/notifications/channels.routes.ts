import { Router, type Request, type RequestHandler } from 'express';
import { emailSettingsInput, emailTestInput } from '@hrms/shared';
import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import type { FieldCrypto } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import { requirePermission } from '../modules/identity/index.js';
import { readEmailSettings, saveEmailSettings, type MailProvider } from './channels.js';
import { toHtml } from './mail.js';

/** إعدادات قنوات الإشعار (البريد الآن، وتلغرام لاحقاً) — لمدير النظام. */
export const createChannelsRouter = (
  db: Db,
  authenticate: RequestHandler,
  opts: { crypto: FieldCrypto | undefined; mail: MailProvider; envSmtpConfigured: boolean },
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

  return router;
};
