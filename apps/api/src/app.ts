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
import { mountOrgRoutes } from './modules/org/index.js';
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
    api.use(createIdentityAdminRouter(auth.db, authenticate));
    mountOrgRoutes(api, auth.db, authenticate);
    mountEmployeesRoutes(api, auth.db, authenticate, auth.crypto);
    app.use('/api/v1', api);
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
};
