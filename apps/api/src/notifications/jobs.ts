import { z } from 'zod';
import { defineJob } from '../jobs/types.js';
import type { MailProvider, TelegramProvider } from './channels.js';

/**
 * مهام الإشعارات. mailProvider = undefined أو بلا إعداد فعّال تعني أن SMTP غير مهيأ: يُعلَّم التسليم «skipped» بلا إعادة محاولة.
 */
export const notificationJobs = (
  mailProvider: MailProvider | undefined,
  telegramProvider?: TelegramProvider,
) => [
  defineJob({
    name: 'notifications.send_email',
    queue: 'critical',
    parse: (d) => z.object({ deliveryId: z.string().uuid() }).parse(d),
    handle: async (ctx, data, info) => {
      const delivery = await ctx.trx
        .selectFrom('notificationDeliveries')
        .selectAll()
        .where('companyId', '=', ctx.companyId)
        .where('id', '=', data.deliveryId)
        .forUpdate()
        .executeTakeFirst();
      if (!delivery) return { skipped: 'not_found' };
      if (delivery.status === 'sent') return { skipped: 'already_sent' };
      const mail = mailProvider ? await mailProvider(ctx) : undefined;
      if (!mail) {
        await ctx.trx
          .updateTable('notificationDeliveries')
          .set({ status: 'skipped', error: 'SMTP غير مهيأ' })
          .where('id', '=', delivery.id)
          .execute();
        return { skipped: 'no_transport' };
      }
      await mail.send({
        to: delivery.toAddress,
        subject: delivery.subject,
        text: delivery.body,
        html: delivery.bodyHtml,
      });
      await ctx.trx
        .updateTable('notificationDeliveries')
        .set({ status: 'sent', sentAt: new Date(), attempts: info.attempt, error: null })
        .where('id', '=', delivery.id)
        .execute();
      return { to: delivery.toAddress };
    },
    // الفشل النهائي يُسجَّل على التسليم نفسه (المعاملة الأصلية تراجعت)
    onFailure: async (ctx, data, error, info) => {
      await ctx.trx
        .updateTable('notificationDeliveries')
        .set({ status: 'failed', attempts: info.attempt, error: error.slice(0, 1000) })
        .where('id', '=', data.deliveryId)
        .execute();
    },
  }),
  defineJob({
    name: 'notifications.send_telegram',
    queue: 'critical',
    parse: (d) => z.object({ deliveryId: z.string().uuid() }).parse(d),
    handle: async (ctx, data, info) => {
      const delivery = await ctx.trx
        .selectFrom('notificationDeliveries')
        .selectAll()
        .where('companyId', '=', ctx.companyId)
        .where('id', '=', data.deliveryId)
        .forUpdate()
        .executeTakeFirst();
      if (!delivery) return { skipped: 'not_found' };
      if (delivery.status === 'sent') return { skipped: 'already_sent' };
      const sender = telegramProvider ? await telegramProvider(ctx) : undefined;
      if (!sender) {
        await ctx.trx
          .updateTable('notificationDeliveries')
          .set({ status: 'skipped', error: 'تلغرام غير مهيأ' })
          .where('id', '=', delivery.id)
          .execute();
        return { skipped: 'no_transport' };
      }
      await sender.send(delivery.toAddress, `${delivery.subject}\n\n${delivery.body}`.trim());
      await ctx.trx
        .updateTable('notificationDeliveries')
        .set({ status: 'sent', sentAt: new Date(), attempts: info.attempt, error: null })
        .where('id', '=', delivery.id)
        .execute();
      return { chat: delivery.toAddress };
    },
    onFailure: async (ctx, data, error, info) => {
      await ctx.trx
        .updateTable('notificationDeliveries')
        .set({ status: 'failed', attempts: info.attempt, error: error.slice(0, 1000) })
        .where('id', '=', data.deliveryId)
        .execute();
    },
  }),
];
