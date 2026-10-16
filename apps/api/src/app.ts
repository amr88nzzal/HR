import express, { Router, type Express } from 'express';
import type { Logger } from 'pino';
import type { ApiEnvelope, Health } from '@hrms/shared';
import type { Db } from './db/index.js';
import {
  createAuthRouter,
  createAuthenticate,
  createIdentityAdminRouter,
  type AuthSettings,
} from './modules/identity/index.js';
import { mountEmployeesRoutes } from './modules/employees/index.js';
import type { FieldCrypto } from './shared/crypto.js';
import {
  createIssuedDocumentsRouter,
  createLetterTemplatesRouter,
  createPublicVerifyRouter,
  type Renderer,
} from './modules/letters/index.js';
import type { StorageProvider } from './shared/storage.js';
import { createJobsRouter, type JobQueue } from './jobs/index.js';
import {
  createChannelsRouter,
  createTelegramWebhookRouter,
  createMailProvider,
  createTelegramApi,
  createTelegramProvider,
  type TelegramApi,
  type MailProvider,
  createNotificationsRouter,
  createNotificationTemplatesRouter,
  createNotifier,
} from './notifications/index.js';
import {
  createApprovalEngine,
  createApprovalFlowsRouter,
  createApprovalsRouter,
  createDelegationsRouter,
} from './approvals/index.js';
import { mountArchiveRoutes } from './modules/archive/index.js';
import { mountOrgRoutes } from './modules/org/index.js';
import {
  createCorrectionsRouter,
  createOvertimeRouter,
  mountAttendanceRoutes,
} from './modules/attendance/index.js';
import { createBrandRouter, createPublicBrandRouter } from './modules/brand/index.js';
import { mountPayrollRoutes } from './modules/payroll/index.js';
import { createLeaveRequestsRouter, mountLeaveRoutes } from './modules/leave/index.js';
import { createErrorHandler, notFoundHandler } from './shared/errors.js';
import { requestIdMiddleware } from './shared/logging.js';

export type AppDeps = {
  logger: Logger;
  /** فحص جاهزية القاعدة (يرمي عند الفشل)؛ غير موجود = متخطّى */
  checkDb?: () => Promise<void>;
  /** المصادقة: تتطلب اتصال قاعدة وإعدادات JWT */
  auth?: {
    db: Db;
    settings: AuthSettings;
    cookieSecure: boolean;
    rateLimit?: boolean;
    crypto?: FieldCrypto;
    /** تخزين الملفات (الأرشيف وصور الموظفين)؛ غيابه يعطّل الرفع فقط */
    storage?: StorageProvider;
    /** قائمة المهام الخلفية (الإدراج ضمن المعاملات)؛ غيابها يعطّل إعادة التشغيل فقط */
    jobs?: JobQueue;
    /** مزوّد البريد الفعّال (إعداد الشركة ثم البيئة)؛ غيابه = إعداد القاعدة فقط */
    mail?: { provider: MailProvider; envConfigured: boolean };
    /** محوّل HTML→PDF (حاوية render)؛ غيابه يعطّل إصدار الوثائق فقط */
    render?: Renderer;
    /** العنوان العام (لرابط التحقق في QR)؛ غيابه = بلا QR */
    publicUrl?: string;
    /** عميل Bot API (يُستبدل في الاختبار) */
    telegramApi?: TelegramApi;
  };
};

export const createApp = ({ logger, checkDb, auth }: AppDeps): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // خطوة وسيطة واحدة موثوقة: بوابة nginx التي تضبط X-Forwarded-For
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health/live', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });

  app.get('/health/ready', async (_req, res) => {
    let db: 'up' | 'down' | 'skipped' = 'skipped';
    if (checkDb) {
      try {
        await checkDb();
        db = 'up';
      } catch (err) {
        db = 'down';
        logger.error({ err }, 'database readiness check failed');
      }
    }
    const health: Health = {
      status: db === 'down' ? 'degraded' : 'ok',
      checks: { database: db },
    };
    const body: ApiEnvelope<Health> = { data: health };
    res.status(health.status === 'ok' ? 200 : 503).json(body);
  });

  if (auth) {
    app.use('/api/v1/auth', createAuthRouter(auth));
    const api = Router();
    const authenticate = createAuthenticate(auth.db, auth.settings.jwtSecret);
    const telegramApi = auth.telegramApi ?? createTelegramApi();
    const telegram = createTelegramProvider({ crypto: auth.crypto, api: telegramApi });
    // قبل أي راوتر يفرض المصادقة على كل المسارات
    api.use('/integrations/telegram/webhook', createTelegramWebhookRouter(auth.db, { telegram }));
    // التحقق العام بلا مصادقة (قبل أي راوتر يفرضها)
    api.use('/public/verify', createPublicVerifyRouter(auth.db, auth.rateLimit !== false));
    api.use(
      '/public/brand',
      createPublicBrandRouter(
        auth.db,
        { storage: auth.storage, crypto: auth.crypto },
        auth.rateLimit !== false,
        auth.settings.defaultCompanySlug,
      ),
    );
    api.use(createIdentityAdminRouter(auth.db, authenticate));
    mountOrgRoutes(api, auth.db, authenticate);
    mountLeaveRoutes(api, auth.db, authenticate);
    mountAttendanceRoutes(api, auth.db, authenticate);
    const files = { storage: auth.storage, crypto: auth.crypto };
    mountEmployeesRoutes(
      api,
      auth.db,
      authenticate,
      auth.crypto,
      { notifier: createNotifier(auth.jobs), publicUrl: auth.publicUrl },
      files,
    );
    mountArchiveRoutes(api, auth.db, authenticate, files, auth.crypto);
    api.use('/jobs', createJobsRouter(auth.db, authenticate, auth.jobs));
    api.use(
      '/notifications',
      createNotificationsRouter(auth.db, authenticate, createNotifier(auth.jobs)),
    );
    api.use('/notification-templates', createNotificationTemplatesRouter(auth.db, authenticate));
    api.use(
      '/integrations',
      createChannelsRouter(auth.db, authenticate, {
        crypto: auth.crypto,
        mail:
          auth.mail?.provider ??
          createMailProvider({ crypto: auth.crypto, envSmtpUrl: undefined, envFrom: '' }),
        envSmtpConfigured: auth.mail?.envConfigured ?? false,
        telegramApi,
        telegram,
      }),
    );
    const engine = createApprovalEngine(createNotifier(auth.jobs));
    api.use('/approval-flows', createApprovalFlowsRouter(auth.db, authenticate));
    api.use('/approval-delegations', createDelegationsRouter(auth.db, authenticate));
    api.use('/approvals', createApprovalsRouter(auth.db, authenticate, engine));
    api.use('/leave-requests', createLeaveRequestsRouter(auth.db, authenticate, engine));
    api.use(
      '/letter-templates',
      createLetterTemplatesRouter(auth.db, authenticate, files, auth.publicUrl),
    );
    api.use(
      '/issued-documents',
      createIssuedDocumentsRouter(auth.db, authenticate, files, auth.render, auth.publicUrl),
    );
    api.use('/company-brand', createBrandRouter(auth.db, authenticate, files));
    mountPayrollRoutes(api, auth.db, authenticate, {
      notifier: createNotifier(auth.jobs),
      publicUrl: auth.publicUrl,
      files,
      render: auth.render,
    });
    api.use('/attendance-corrections', createCorrectionsRouter(auth.db, authenticate, engine));
    api.use('/overtime-requests', createOvertimeRouter(auth.db, authenticate, engine));
    app.use('/api/v1', api);
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
};
