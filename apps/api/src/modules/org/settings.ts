import { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { SETTING_DEFS, settingKeys, type SettingKey } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { allowedBranchIds, requirePermission, type AuthContext } from '../identity/index.js';
import { ensureRefsExist } from './crud.js';

type Scope = { scopeType: 'company' | 'branch' | 'user'; scopeId: string | null };

const parseKey = (k: unknown): SettingKey => {
  if (typeof k !== 'string' || !(settingKeys as string[]).includes(k)) {
    throw new AppError('UNKNOWN_SETTING', 400, 'مفتاح إعداد غير معروف');
  }
  return k as SettingKey;
};

const defaults = (): Record<string, unknown> =>
  Object.fromEntries(settingKeys.map((k) => [k, SETTING_DEFS[k].default]));

/** القيم الفعلية: الافتراضي ← الشركة ← الفرع ← المستخدم (الأدنى يطغى). */
export const resolveSettings = async (
  ctx: Ctx,
  userId: string,
  branchId?: string,
): Promise<Record<string, unknown>> => {
  const scopes = [
    sql`(scope_type = 'company')`,
    sql`(scope_type = 'user' and scope_id = ${userId})`,
  ];
  if (branchId) scopes.push(sql`(scope_type = 'branch' and scope_id = ${branchId})`);
  const { rows } = await sql<{ scopeType: string; key: string; value: unknown }>`
    select scope_type as "scopeType", key, value from settings where ${sql.join(scopes, sql` or `)}`.execute(
    ctx.trx,
  );
  const rank = { company: 1, branch: 2, user: 3 } as const;
  const out = defaults();
  const best: Record<string, number> = {};
  for (const r of rows) {
    const rk = rank[r.scopeType as keyof typeof rank];
    if ((best[r.key] ?? 0) < rk && r.key in out) {
      out[r.key] = r.value;
      best[r.key] = rk;
    }
  }
  return out;
};

const upsert = async (ctx: Ctx, scope: Scope, key: SettingKey, value: unknown) => {
  const parsed = SETTING_DEFS[key].schema.parse(value);
  const existing = await ctx.trx
    .selectFrom('settings')
    .select('id')
    .where('scopeType', '=', scope.scopeType)
    .where('key', '=', key)
    .where((eb) => (scope.scopeId ? eb('scopeId', '=', scope.scopeId) : eb('scopeId', 'is', null)))
    .executeTakeFirst();
  if (existing) {
    await ctx.trx
      .updateTable('settings')
      .set({ value: JSON.stringify(parsed), version: sql`version + 1` })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await ctx.trx
      .insertInto('settings')
      .values({ companyId: ctx.companyId, ...scope, key, value: JSON.stringify(parsed) })
      .execute();
  }
};

const valueBody = z.object({ value: z.unknown() });

export const createSettingsRouter = (
  db: Db,
  authenticate: import('express').RequestHandler,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(
    req: import('express').Request,
    fn: (ctx: Ctx, auth: AuthContext) => Promise<T>,
  ) => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

  // القيم الفعلية للمستخدم الحالي (أي مستخدم مسجّل)
  router.get('/effective', async (req, res, next) => {
    try {
      const branchId =
        typeof req.query['branchId'] === 'string' ? req.query['branchId'] : undefined;
      const data = await run(req, async (ctx, auth) => {
        if (branchId) await ensureRefsExist(ctx, 'branches', [branchId]);
        return resolveSettings(ctx, auth.userId, branchId);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  // إعداد شخصي
  router.put('/me/:key', async (req, res, next) => {
    try {
      const key = parseKey(req.params['key']);
      const { value } = valueBody.parse(req.body);
      await run(req, (ctx, auth) =>
        upsert(ctx, { scopeType: 'user', scopeId: auth.userId }, key, value),
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // إعدادات الشركة
  router.get('/company', requirePermission('system.setting.read'), async (req, res, next) => {
    try {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('settings')
          .select(['key', 'value'])
          .where('scopeType', '=', 'company')
          .execute(),
      );
      res.json({
        data: { ...defaults(), ...Object.fromEntries(rows.map((r) => [r.key, r.value])) },
      });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/company/:key',
    requirePermission('system.setting.update'),
    async (req, res, next) => {
      try {
        const key = parseKey(req.params['key']);
        const { value } = valueBody.parse(req.body);
        await run(req, (ctx) => upsert(ctx, { scopeType: 'company', scopeId: null }, key, value));
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // إعدادات فرع: يتطلب صلاحية التعديل ونطاقاً يشمل الفرع
  router.put(
    '/branch/:branchId/:key',
    requirePermission('system.setting.update'),
    async (req, res, next) => {
      try {
        const key = parseKey(req.params['key']);
        const branchId = z.string().uuid().parse(req.params['branchId']);
        const { value } = valueBody.parse(req.body);
        await run(req, async (ctx, auth) => {
          const allowed = allowedBranchIds(auth, 'system.setting.update');
          if (allowed !== 'all' && !allowed.includes(branchId))
            throw new AppError('NOT_FOUND', 404, 'الفرع غير موجود');
          await ensureRefsExist(ctx, 'branches', [branchId]).catch(() => {
            throw new AppError('NOT_FOUND', 404, 'الفرع غير موجود');
          });
          await upsert(ctx, { scopeType: 'branch', scopeId: branchId }, key, value);
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};
