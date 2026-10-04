import type { RequestHandler } from 'express';
import type { Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import {
  getCachedSnapshot,
  loadGrants,
  setCachedSnapshot,
  type AuthSnapshot,
  type Grant,
} from './permissions.service.js';
import { verifyAccessToken } from './tokens.js';

export type AuthContext = {
  userId: string;
  companyId: string;
  permissionsVersion: number;
  grants: Grant[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const unauthorized = () => new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');

/** يتحقق من التوكن، ويحمّل صلاحيات المستخدم (ذاكرة مؤقتة 30ث)، ويضع X-Permissions-Version. */
export const createAuthenticate =
  (db: Db, jwtSecret: string): RequestHandler =>
  async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
      const claims = token ? await verifyAccessToken(token, jwtSecret) : null;
      if (!claims) throw unauthorized();

      let snapshot = getCachedSnapshot(claims.userId);
      if (!snapshot) {
        snapshot = await withTenant(
          db,
          { companyId: claims.companyId, userId: claims.userId, requestId: req.requestId },
          async (ctx): Promise<AuthSnapshot> => {
            const user = await ctx.trx
              .selectFrom('users')
              .select(['status', 'permissionsVersion'])
              .where('id', '=', claims.userId)
              .executeTakeFirst();
            if (!user) return { grants: [], permissionsVersion: 0, active: false };
            return {
              grants: await loadGrants(ctx, claims.userId),
              permissionsVersion: user.permissionsVersion,
              active: user.status === 'active',
            };
          },
        );
        if (snapshot.active) setCachedSnapshot(claims.userId, snapshot);
      }
      if (!snapshot.active) throw unauthorized();

      req.auth = {
        userId: claims.userId,
        companyId: claims.companyId,
        permissionsVersion: snapshot.permissionsVersion,
        grants: snapshot.grants,
      };
      res.setHeader('X-Permissions-Version', String(snapshot.permissionsVersion));
      next();
    } catch (err) {
      next(err);
    }
  };

export const hasPermission = (auth: AuthContext, code: string): boolean =>
  auth.grants.some((g) => g.code === code);

/** يشترط وجود الصلاحية بأي نطاق؛ ترشيح النطاق نفسه يتم في الخدمات. */
export const requirePermission =
  (code: string): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!hasPermission(req.auth, code)) {
      return next(
        new AppError('FORBIDDEN', 403, 'لا تملك صلاحية تنفيذ هذا الإجراء', { required: code }),
      );
    }
    next();
  };
