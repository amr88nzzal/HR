import {
  isMandatoryCategory,
  notificationEvent,
  renderTemplate,
  type NotificationChannel,
  type NotificationLocale,
} from '@hrms/shared';
import type { Ctx } from '../db/tenant.js';
import type { JobQueue } from '../jobs/index.js';
import { AppError } from '../shared/errors.js';
import { toHtml } from './mail.js';

export type NotifyInput = {
  userId: string;
  event: string;
  vars?: Record<string, string>;
  /** مسار داخل التطبيق يُفتح عند النقر */
  link?: string;
  data?: Record<string, unknown>;
};

export type Notifier = {
  /**
   * ينشئ الإشعار داخل معاملة العمل نفسها ويضع تسليم البريد في الطابور (ضمن المعاملة أيضاً).
   * يحترم تفضيلات المستخدم إلا للفئات الإلزامية. يعيد معرّف الإشعار.
   */
  notify: (ctx: Ctx, input: NotifyInput) => Promise<string>;
};

const asLocale = (v: string | null | undefined): NotificationLocale => (v === 'en' ? 'en' : 'ar');

/** يحلّ نص القالب: تخصيص فعّال في القاعدة، وإلا الافتراضي من الكود */
export const resolveTexts = async (
  ctx: Ctx,
  eventKey: string,
  locale: NotificationLocale,
): Promise<Record<NotificationChannel, { subject: string; body: string }>> => {
  const def = notificationEvent(eventKey);
  if (!def) throw new AppError('UNKNOWN_EVENT', 500, `حدث إشعار غير معرّف: ${eventKey}`);
  const overrides = await ctx.trx
    .selectFrom('notificationTemplates')
    .select(['channel', 'subject', 'body'])
    .where('companyId', '=', ctx.companyId)
    .where('eventKey', '=', eventKey)
    .where('locale', '=', locale)
    .where('isActive', '=', true)
    .execute();
  const pick = (channel: NotificationChannel) => {
    const o = overrides.find((r) => r.channel === channel);
    return o
      ? { subject: o.subject ?? def.defaults[locale].subject, body: o.body }
      : def.defaults[locale];
  };
  return { in_app: pick('in_app'), email: pick('email'), telegram: pick('telegram') };
};

export const createNotifier = (queue: JobQueue | undefined): Notifier => ({
  notify: async (ctx, input) => {
    const def = notificationEvent(input.event);
    if (!def) throw new AppError('UNKNOWN_EVENT', 500, `حدث إشعار غير معرّف: ${input.event}`);
    const vars = input.vars ?? {};

    const company = await ctx.trx
      .selectFrom('companies')
      .select('defaultLocale')
      .where('id', '=', ctx.companyId)
      .executeTakeFirst();
    const locale = asLocale(company?.defaultLocale);
    const user = await ctx.trx
      .selectFrom('users')
      .select(['id', 'email'])
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', input.userId)
      .executeTakeFirst();
    if (!user) throw new AppError('INVALID_REFERENCE', 400, 'مستخدم الإشعار غير موجود');

    const prefs = await ctx.trx
      .selectFrom('notificationPreferences')
      .select(['channel', 'enabled'])
      .where('userId', '=', user.id)
      .where('category', '=', def.category)
      .execute();
    const allowed = (channel: NotificationChannel) =>
      isMandatoryCategory(def.category) ||
      (prefs.find((p) => p.channel === channel)?.enabled ?? true);

    const texts = await resolveTexts(ctx, input.event, locale);
    const inApp = texts.in_app;
    const row = await ctx.trx
      .insertInto('notifications')
      .values({
        companyId: ctx.companyId,
        userId: user.id,
        eventKey: input.event,
        category: def.category,
        title: renderTemplate(inApp.subject, vars),
        body: renderTemplate(inApp.body, vars),
        link: input.link ?? null,
        data: JSON.stringify(input.data ?? {}),
        isVisible: allowed('in_app'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (allowed('email') && user.email) {
      const mail = texts.email;
      const subject = renderTemplate(mail.subject, vars);
      const body = renderTemplate(mail.body, vars);
      const delivery = await ctx.trx
        .insertInto('notificationDeliveries')
        .values({
          companyId: ctx.companyId,
          notificationId: row.id,
          channel: 'email',
          toAddress: user.email,
          subject,
          body,
          bodyHtml: toHtml(subject, body, locale),
          status: queue ? 'pending' : 'skipped',
          error: queue ? null : 'قائمة المهام غير مفعّلة',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (queue) await queue.enqueue(ctx, 'notifications.send_email', { deliveryId: delivery.id });
    }

    if (allowed('telegram') && queue) {
      // يُرسل فقط لمن ربط حسابه والقناة مفعّلة على الشركة
      const link = await ctx.trx
        .selectFrom('telegramLinks as l')
        .innerJoin('integrationSettings as i', (j) =>
          j.onRef('i.companyId', '=', 'l.companyId').on('i.provider', '=', 'telegram'),
        )
        .select(['l.chatId', 'i.config'])
        .where('l.companyId', '=', ctx.companyId)
        .where('l.userId', '=', user.id)
        .where('i.enabled', '=', true)
        .executeTakeFirst();
      if (link) {
        const tg = texts.telegram;
        const subject = renderTemplate(tg.subject, vars);
        const publicUrl = (link.config as { publicUrl?: string }).publicUrl;
        const body =
          renderTemplate(tg.body, vars) +
          (input.link && publicUrl ? `\n${publicUrl}${input.link}` : '');
        const delivery = await ctx.trx
          .insertInto('notificationDeliveries')
          .values({
            companyId: ctx.companyId,
            notificationId: row.id,
            channel: 'telegram',
            toAddress: link.chatId,
            subject,
            body,
            bodyHtml: '',
            status: 'pending',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await queue.enqueue(ctx, 'notifications.send_telegram', { deliveryId: delivery.id });
      }
    }
    return row.id;
  },
});
