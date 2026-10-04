import cookieParser from 'cookie-parser';
import { Router, type CookieOptions, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { ApiEnvelope } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import {
  changePassword,
  getMe,
  login,
  logout,
  refresh,
  type AuthSettings,
  type ClientInfo,
  type Me,
  type Session,
} from './auth.service.js';
import { createAuthenticate } from './middleware.js';
import { invalidateSnapshot } from './permissions.service.js';

export const REFRESH_COOKIE = 'hrms_rt';
const COOKIE_PATH = '/api/v1/auth';

const loginSchema = z.object({
  company: z.string().min(1).max(100).optional(),
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

export type IdentityRoutesDeps = {
  db: Db;
  settings: AuthSettings;
  cookieSecure: boolean;
  /** تعطيل تحديد المعدل في الاختبارات */
  rateLimit?: boolean;
};

export const createAuthRouter = ({
  db,
  settings,
  cookieSecure,
  rateLimit: limit = true,
}: IdentityRoutesDeps): Router => {
  const router = Router();
  router.use(cookieParser());
  const authenticate = createAuthenticate(db, settings.jwtSecret);

  const cookieOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: settings.refreshTtlDays * 86_400_000,
  });
  const clientOf = (req: Request): ClientInfo => ({
    ip: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.requestId ?? '',
  });
  const sendSession = (res: Response, session: Session) => {
    res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions());
    const body: ApiEnvelope<Omit<Session, 'refreshToken'>> = {
      data: {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        permissionsVersion: session.permissionsVersion,
        mustChangePassword: session.mustChangePassword,
      },
    };
    res.json(body);
  };

  if (limit) {
    // حد عام على المسارات الحساسة لكل IP، فوق قفل الحساب بعد 5 محاولات فاشلة
    router.use(
      ['/login', '/refresh'],
      rateLimit({
        windowMs: 60_000,
        limit: 30,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) =>
          next(new AppError('RATE_LIMITED', 429, 'محاولات كثيرة، حاول بعد قليل')),
      }),
    );
  }

  router.post('/login', async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      sendSession(res, await login(db, settings, input, clientOf(req)));
    } catch (err) {
      next(err);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
      if (!token) throw new AppError('INVALID_REFRESH_TOKEN', 401, 'الجلسة غير صالحة');
      try {
        sendSession(res, await refresh(db, settings, token, clientOf(req)));
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
      if (token) await logout(db, token, clientOf(req));
      res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/change-password', authenticate, async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
      const input = changePasswordSchema.parse(req.body);
      await withTenant(
        db,
        { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
        (ctx) => changePassword(ctx, auth.userId, input, clientOf(req)),
      );
      invalidateSnapshot(auth.userId);
      res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', authenticate, async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
      const me = await withTenant(
        db,
        { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
        (ctx) => getMe(ctx, auth.userId),
      );
      const body: ApiEnvelope<Me> = { data: me };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
