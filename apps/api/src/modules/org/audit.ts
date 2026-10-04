import { Router } from 'express';
import { sql } from 'kysely';
import { auditQuery, type ApiEnvelope } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';

export const createAuditRouter = (
  db: Db,
  authenticate: import('express').RequestHandler,
): Router => {
  const router = Router();
  router.use(authenticate);

  router.get('/', requirePermission('system.audit.read'), async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
      const q = auditQuery.parse(req.query);
      const out = await withTenant(
        db,
        { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
        async (ctx) => {
          const build = () => {
            let b = ctx.trx.selectFrom('auditLogs as a').leftJoin('users as u', 'u.id', 'a.userId');
            if (q.entityType) b = b.where('a.entityType', '=', q.entityType);
            if (q.entityId) b = b.where('a.entityId', '=', q.entityId);
            if (q.userId) b = b.where('a.userId', '=', q.userId);
            if (q.action) b = b.where('a.action', '=', q.action);
            if (q.from) b = b.where('a.occurredAt', '>=', q.from);
            if (q.to) b = b.where('a.occurredAt', '<=', q.to);
            return b;
          };
          const rows = await build()
            .select([
              'a.id',
              'a.occurredAt',
              'a.userId',
              'u.displayName as userName',
              'a.entityType',
              'a.entityId',
              'a.action',
              'a.changes',
              'a.requestId',
            ])
            .orderBy('a.occurredAt', 'desc')
            .orderBy('a.id', 'desc')
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
        },
      );
      const body: ApiEnvelope<typeof out.rows> = {
        data: out.rows,
        meta: { page: q.page, pageSize: q.pageSize, total: out.total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
