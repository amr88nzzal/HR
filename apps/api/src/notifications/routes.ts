import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_LOCALES,
  isMandatoryCategory,
  notificationEvent,
  notificationListQuery,
  preferencesInput,
  templateInput,
  templateVariables,
  type NotificationDto,
  type PreferenceMatrix,
} from '@hrms/shared';
import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import { AppError } from '../shared/errors.js';
import { requirePermission } from '../modules/identity/index.js';
import type { Notifier } from './service.js';

const READ_TPL = 'system.notification_template.read';
const UPDATE_TPL = 'system.notification_template.update';

const notFound = () => new AppError('NOT_FOUND', 404, 'الإشعار غير موجود');
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};

const makeRun =
  (db: Db) =>
  <T>(req: Request, fn: (ctx: Ctx, userId: string) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth.userId),
    );
  };

/** إشعارات المستخدم نفسه وتفضيلاته (يكفي تسجيل الدخول؛ كل استعلام مقيَّد بمعرّفه). */
export const createNotificationsRouter = (
  db: Db,
  authenticate: RequestHandler,
  notifier: Notifier,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);

  router.get('/', async (req, res, next) => {
    try {
      const q = notificationListQuery.parse(req.query);
      const out = await run(req, async (ctx, userId) => {
        const build = () => {
          let b = ctx.trx
            .selectFrom('notifications')
            .where('companyId', '=', ctx.companyId)
            .where('userId', '=', userId)
            .where('isVisible', '=', true);
          if (q.unread) b = b.where('readAt', 'is', null);
          return b;
        };
        const rows = await build()
          .select(['id', 'eventKey', 'category', 'title', 'body', 'link', 'readAt', 'createdAt'])
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute();
        const total = Number(
          (
            await build()
              .select(sql<string>`count(*)`.as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        return { rows, total };
      });
      const data: NotificationDto[] = out.rows.map((r) => ({
        ...r,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));
      res.json({ data, meta: { page: q.page, pageSize: q.pageSize, total: out.total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/unread-count', async (req, res, next) => {
    try {
      const n = await run(req, async (ctx, userId) =>
        Number(
          (
            await ctx.trx
              .selectFrom('notifications')
              .select(sql<string>`count(*)`.as('n'))
              .where('companyId', '=', ctx.companyId)
              .where('userId', '=', userId)
              .where('isVisible', '=', true)
              .where('readAt', 'is', null)
              .executeTakeFirstOrThrow()
          ).n,
        ),
      );
      res.json({ data: { count: n } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/read-all', async (req, res, next) => {
    try {
      const updated = await run(req, async (ctx, userId) => {
        const r = await ctx.trx
          .updateTable('notifications')
          .set({ readAt: new Date() })
          .where('companyId', '=', ctx.companyId)
          .where('userId', '=', userId)
          .where('readAt', 'is', null)
          .executeTakeFirst();
        return Number(r.numUpdatedRows);
      });
      res.json({ data: { updated } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/preferences', async (req, res, next) => {
    try {
      const rows = await run(req, (ctx, userId) =>
        ctx.trx
          .selectFrom('notificationPreferences')
          .select(['category', 'channel', 'enabled'])
          .where('userId', '=', userId)
          .execute(),
      );
      const data: PreferenceMatrix = NOTIFICATION_CATEGORIES.map((c) => ({
        category: c.key,
        mandatory: c.mandatory,
        channels: Object.fromEntries(
          NOTIFICATION_CHANNELS.map((ch) => [
            ch,
            c.mandatory ||
              (rows.find((r) => r.category === c.key && r.channel === ch)?.enabled ?? true),
          ]),
        ) as PreferenceMatrix[number]['channels'],
      }));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.put('/preferences', async (req, res, next) => {
    try {
      const { items } = preferencesInput.parse(req.body);
      for (const i of items) {
        if (!NOTIFICATION_CATEGORIES.some((c) => c.key === i.category))
          throw new AppError('VALIDATION_ERROR', 400, `فئة غير معروفة: ${i.category}`);
        if (isMandatoryCategory(i.category))
          throw new AppError('VALIDATION_ERROR', 400, 'لا يمكن تعطيل فئة إلزامية');
      }
      await run(req, async (ctx, userId) => {
        for (const i of items) {
          await ctx.trx
            .insertInto('notificationPreferences')
            .values({
              companyId: ctx.companyId,
              userId,
              category: i.category,
              channel: i.channel,
              enabled: i.enabled,
            })
            .onConflict((oc) =>
              oc.columns(['userId', 'category', 'channel']).doUpdateSet({ enabled: i.enabled }),
            )
            .execute();
        }
      });
      res.json({ data: { updated: items.length } });
    } catch (err) {
      next(err);
    }
  });

  // إشعار تجريبي لنفسك: للتحقق من البريد والقوالب
  router.post('/test', requirePermission(UPDATE_TPL), async (req, res, next) => {
    try {
      const id = await run(req, async (ctx, userId) => {
        const me = await ctx.trx
          .selectFrom('users')
          .select('displayName')
          .where('id', '=', userId)
          .executeTakeFirstOrThrow();
        return notifier.notify(ctx, {
          userId,
          event: 'system.test',
          vars: { user: me.displayName },
          link: '/notifications',
        });
      });
      res.status(201).json({ data: { id } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/read', async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const ok = await run(req, async (ctx, userId) => {
        const r = await ctx.trx
          .updateTable('notifications')
          .set({ readAt: new Date() })
          .where('companyId', '=', ctx.companyId)
          .where('userId', '=', userId)
          .where('id', '=', id)
          .where('readAt', 'is', null)
          .executeTakeFirst();
        if (Number(r.numUpdatedRows) > 0) return true;
        // موجود ومقروء سابقاً = نجاح؛ غير موجود/لغيره = 404
        const exists = await ctx.trx
          .selectFrom('notifications')
          .select('id')
          .where('companyId', '=', ctx.companyId)
          .where('userId', '=', userId)
          .where('id', '=', id)
          .executeTakeFirst();
        return !!exists;
      });
      if (!ok) throw notFound();
      res.json({ data: { id } });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/** قوالب الإشعارات: الافتراضي من الكود، والتخصيص في القاعدة لكل (حدث، قناة، لغة). */
export const createNotificationTemplatesRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);

  router.get('/', requirePermission(READ_TPL), async (req, res, next) => {
    try {
      const overrides = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('notificationTemplates')
          .select(['eventKey', 'channel', 'locale', 'subject', 'body', 'isActive', 'version'])
          .where('companyId', '=', ctx.companyId)
          .execute(),
      );
      const data = NOTIFICATION_EVENTS.map((e) => ({
        eventKey: e.key,
        category: e.category,
        variables: e.variables,
        defaults: e.defaults,
        overrides: overrides.filter((o) => o.eventKey === e.key),
      }));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  const target = (req: Request) => {
    const eventKey = String(req.params['eventKey']);
    const channel = String(req.params['channel']);
    const locale = String(req.params['locale']);
    const def = notificationEvent(eventKey);
    if (
      !def ||
      !(NOTIFICATION_CHANNELS as readonly string[]).includes(channel) ||
      !(NOTIFICATION_LOCALES as readonly string[]).includes(locale)
    )
      throw new AppError('NOT_FOUND', 404, 'القالب غير موجود');
    return { def, eventKey, channel: channel as 'in_app' | 'email', locale: locale as 'ar' | 'en' };
  };

  router.put(
    '/:eventKey/:channel/:locale',
    requirePermission(UPDATE_TPL),
    async (req, res, next) => {
      try {
        const { def, eventKey, channel, locale } = target(req);
        const input = templateInput.parse(req.body);
        const unknown = templateVariables(`${input.subject} ${input.body}`).filter(
          (v) => !def.variables.includes(v),
        );
        if (unknown.length)
          throw new AppError('VALIDATION_ERROR', 400, 'متغيرات غير مسموحة في القالب', { unknown });
        await run(req, (ctx) =>
          ctx.trx
            .insertInto('notificationTemplates')
            .values({
              companyId: ctx.companyId,
              eventKey,
              channel,
              locale,
              subject: input.subject,
              body: input.body,
              isActive: input.isActive,
            })
            .onConflict((oc) =>
              oc.columns(['companyId', 'eventKey', 'channel', 'locale']).doUpdateSet({
                subject: input.subject,
                body: input.body,
                isActive: input.isActive,
                version: sql<number>`notification_templates.version + 1`,
              }),
            )
            .execute(),
        );
        res.json({ data: { eventKey, channel, locale } });
      } catch (err) {
        next(err);
      }
    },
  );

  // حذف التخصيص = الرجوع إلى الافتراضي
  router.delete(
    '/:eventKey/:channel/:locale',
    requirePermission(UPDATE_TPL),
    async (req, res, next) => {
      try {
        const { eventKey, channel, locale } = target(req);
        await run(req, (ctx) =>
          ctx.trx
            .deleteFrom('notificationTemplates')
            .where('companyId', '=', ctx.companyId)
            .where('eventKey', '=', eventKey)
            .where('channel', '=', channel)
            .where('locale', '=', locale)
            .execute(),
        );
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};
