import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { loadGrants } from './permissions.service.js';
import {
  companyIdFromOpaqueToken,
  generateOpaqueToken,
  sha256,
  signAccessToken,
} from './tokens.js';

export type AuthSettings = {
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  defaultCompanySlug: string;
};

export type ClientInfo = { ip?: string; userAgent?: string; requestId: string };

export type Session = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  permissionsVersion: number;
  mustChangePassword: boolean;
};

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const REFRESH_GRACE_MS = 10_000;

// تجزئة وهمية لتساوي زمن الرد عند غياب المستخدم (منع تعداد الحسابات بالتوقيت)
let dummyHash: string | undefined;
const getDummyHash = async () => (dummyHash ??= await hashPassword('dummy-password-for-timing'));

const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'بيانات الدخول غير صحيحة');

const audit = (
  ctx: Ctx,
  action: string,
  userId: string | null,
  client: ClientInfo,
  changes?: unknown,
) =>
  ctx.trx
    .insertInto('auditLogs')
    .values({
      companyId: ctx.companyId,
      userId,
      entityType: 'auth',
      entityId: userId,
      action,
      changes: changes ? JSON.stringify(changes) : null,
      requestId: client.requestId,
      ip: client.ip ?? null,
    })
    .execute();

const issueSession = async (
  ctx: Ctx,
  settings: AuthSettings,
  user: { id: string; permissionsVersion: number; mustChangePassword: boolean },
  client: ClientInfo,
  familyId?: string,
): Promise<Session & { refreshId: string }> => {
  const { token, hash } = generateOpaqueToken(ctx.companyId);
  const row = await ctx.trx
    .insertInto('refreshTokens')
    .values({
      companyId: ctx.companyId,
      userId: user.id,
      familyId: familyId ?? crypto.randomUUID(),
      tokenHash: hash,
      deviceInfo: client.userAgent?.slice(0, 300) ?? null,
      ip: client.ip ?? null,
      expiresAt: new Date(Date.now() + settings.refreshTtlDays * 86_400_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const accessToken = await signAccessToken(
    { userId: user.id, companyId: ctx.companyId, permissionsVersion: user.permissionsVersion },
    settings.jwtSecret,
    settings.accessTtlSeconds,
  );
  return {
    accessToken,
    expiresIn: settings.accessTtlSeconds,
    refreshToken: token,
    permissionsVersion: user.permissionsVersion,
    mustChangePassword: user.mustChangePassword,
    refreshId: row.id,
  };
};

export const login = async (
  db: Db,
  settings: AuthSettings,
  input: { company?: string; identifier: string; password: string },
  client: ClientInfo,
): Promise<Session> => {
  const slug = input.company ?? settings.defaultCompanySlug;
  const { rows } = await sql<{ id: string | null }>`select login_company_id(${slug}) as id`.execute(
    db,
  );
  const companyId = rows[0]?.id;
  if (!companyId) {
    await verifyPassword(await getDummyHash(), input.password);
    throw invalidCredentials();
  }

  // النتيجة تُعاد بدل الرمي حتى تُثبَّت عدّادات الفشل قبل الرد بالخطأ
  const outcome = await withTenant(db, { companyId, requestId: client.requestId }, async (ctx) => {
    const user = await ctx.trx
      .selectFrom('users')
      .selectAll()
      .where((eb) =>
        eb.or([eb('email', '=', input.identifier), eb('username', '=', input.identifier)]),
      )
      .forUpdate()
      .executeTakeFirst();

    if (!user) {
      await verifyPassword(await getDummyHash(), input.password);
      return { error: invalidCredentials() };
    }
    if (user.status !== 'active') {
      await verifyPassword(await getDummyHash(), input.password);
      return { error: invalidCredentials() };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return {
        error: new AppError(
          'ACCOUNT_LOCKED',
          423,
          'الحساب مقفل مؤقتاً بسبب محاولات فاشلة، حاول لاحقاً',
          {
            lockedUntil: user.lockedUntil,
          },
        ),
      };
    }

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedAttempts + 1;
      const lock = failed >= MAX_FAILED;
      await ctx.trx
        .updateTable('users')
        .set({
          failedAttempts: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where('id', '=', user.id)
        .execute();
      await audit(ctx, lock ? 'account_locked' : 'login_failed', user.id, client);
      return { error: invalidCredentials() };
    }

    await ctx.trx
      .updateTable('users')
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where('id', '=', user.id)
      .execute();
    const session = await issueSession(ctx, settings, user, client);
    await audit(ctx, 'login', user.id, client);
    return { session };
  });

  if ('error' in outcome) throw outcome.error;
  return outcome.session;
};

export const refresh = async (
  db: Db,
  settings: AuthSettings,
  token: string,
  client: ClientInfo,
): Promise<Session> => {
  const companyId = companyIdFromOpaqueToken(token);
  if (!companyId) throw new AppError('INVALID_REFRESH_TOKEN', 401, 'الجلسة غير صالحة');

  const outcome = await withTenant(db, { companyId, requestId: client.requestId }, async (ctx) => {
    const row = await ctx.trx
      .selectFrom('refreshTokens')
      .selectAll()
      .where('tokenHash', '=', sha256(token))
      .forUpdate()
      .executeTakeFirst();
    const fail = new AppError('INVALID_REFRESH_TOKEN', 401, 'الجلسة غير صالحة');
    if (!row) return { error: fail };

    if (row.revokedAt) {
      // إعادة استخدام توكن مُدوَّر: سباق مشروع (تبويبان) خلال مهلة قصيرة، وإلا سرقة محتملة → إبطال العائلة كلها
      if (Date.now() - row.revokedAt.getTime() > REFRESH_GRACE_MS) {
        await ctx.trx
          .updateTable('refreshTokens')
          .set({ revokedAt: new Date() })
          .where('familyId', '=', row.familyId)
          .where('revokedAt', 'is', null)
          .execute();
        await audit(ctx, 'refresh_reuse_detected', row.userId, client, { familyId: row.familyId });
      }
      return { error: fail };
    }
    if (row.expiresAt < new Date()) return { error: fail };

    const user = await ctx.trx
      .selectFrom('users')
      .select(['id', 'status', 'permissionsVersion', 'mustChangePassword'])
      .where('id', '=', row.userId)
      .executeTakeFirst();
    if (!user || user.status !== 'active') return { error: fail };

    const session = await issueSession(ctx, settings, user, client, row.familyId);
    await ctx.trx
      .updateTable('refreshTokens')
      .set({ revokedAt: new Date(), replacedById: session.refreshId })
      .where('id', '=', row.id)
      .execute();
    return { session };
  });

  if ('error' in outcome) throw outcome.error;
  return outcome.session;
};

/** تسجيل الخروج: يبطل عائلة التوكن؛ لا يفشل مع توكن غير معروف. */
export const logout = async (db: Db, token: string, client: ClientInfo): Promise<void> => {
  const companyId = companyIdFromOpaqueToken(token);
  if (!companyId) return;
  await withTenant(db, { companyId, requestId: client.requestId }, async (ctx) => {
    const row = await ctx.trx
      .selectFrom('refreshTokens')
      .select(['familyId', 'userId'])
      .where('tokenHash', '=', sha256(token))
      .executeTakeFirst();
    if (!row) return;
    await ctx.trx
      .updateTable('refreshTokens')
      .set({ revokedAt: new Date() })
      .where('familyId', '=', row.familyId)
      .where('revokedAt', 'is', null)
      .execute();
    await audit(ctx, 'logout', row.userId, client);
  });
};

export const changePassword = async (
  ctx: Ctx,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  client: ClientInfo,
): Promise<void> => {
  const user = await ctx.trx
    .selectFrom('users')
    .select(['id', 'email', 'username', 'passwordHash'])
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new AppError('INVALID_CREDENTIALS', 400, 'كلمة المرور الحالية غير صحيحة');
  }
  const problem = checkPasswordPolicy(input.newPassword, user);
  if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);

  await ctx.trx
    .updateTable('users')
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    })
    .where('id', '=', userId)
    .execute();
  // إبطال كل الجلسات القائمة بعد تغيير كلمة المرور
  await ctx.trx
    .updateTable('refreshTokens')
    .set({ revokedAt: new Date() })
    .where('userId', '=', userId)
    .where('revokedAt', 'is', null)
    .execute();
  await audit(ctx, 'password_changed', userId, client);
};

export type Me = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  companyId: string;
  mustChangePassword: boolean;
  permissionsVersion: number;
  permissions: string[];
};

export const getMe = async (ctx: Ctx, userId: string): Promise<Me> => {
  const user = await ctx.trx
    .selectFrom('users')
    .select(['id', 'email', 'username', 'displayName', 'mustChangePassword', 'permissionsVersion'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const grants = await loadGrants(ctx, userId);
  return {
    ...user,
    companyId: ctx.companyId,
    permissions: [...new Set(grants.map((g) => g.code))].sort(),
  };
};
