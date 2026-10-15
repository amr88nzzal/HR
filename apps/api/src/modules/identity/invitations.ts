import { AppError } from '../../shared/errors.js';
import type { Ctx } from '../../db/tenant.js';
import { checkPasswordPolicy, hashPassword } from './password.js';
import { companyIdFromOpaqueToken, generateOpaqueToken, sha256 } from './tokens.js';
import { invalidateSnapshot } from './permissions.service.js';

export const INVITE_TTL_HOURS = 72;

const audit = (ctx: Ctx, entityId: string, action: string) =>
  ctx.trx
    .insertInto('auditLogs')
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      entityType: 'users',
      entityId,
      action,
      changes: '{}',
      requestId: ctx.requestId,
      ip: null,
    })
    .execute();

/** يُبطل دعوات المستخدم غير المستعملة ويصدر دعوة جديدة (التوكن الخام يُعاد مرة واحدة فقط). */
export const issueInvite = async (
  ctx: Ctx,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> => {
  await ctx.trx
    .updateTable('passwordResets')
    .set({ usedAt: new Date() })
    .where('userId', '=', userId)
    .where('usedAt', 'is', null)
    .execute();
  const { token, hash } = generateOpaqueToken(ctx.companyId);
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
  await ctx.trx
    .insertInto('passwordResets')
    .values({ companyId: ctx.companyId, userId, tokenHash: hash, expiresAt })
    .execute();
  return { token, expiresAt };
};

export const inviteCompanyId = (token: string): string | null => companyIdFromOpaqueToken(token);

/** تفعيل الحساب بالدعوة: يعيّن المستخدم كلمة مروره بنفسه فلا تنتقل كلمة مرور بين البشر. */
export const acceptInvite = async (
  ctx: Ctx,
  input: { token: string; password: string },
): Promise<void> => {
  const row = await ctx.trx
    .selectFrom('passwordResets')
    .select(['id', 'userId', 'expiresAt', 'usedAt'])
    .where('tokenHash', '=', sha256(input.token))
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now())
    throw new AppError('INVALID_INVITE', 400, 'رابط الدعوة غير صالح أو منتهٍ');
  const user = await ctx.trx
    .selectFrom('users')
    .select(['id', 'email', 'username', 'status'])
    .where('id', '=', row.userId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (user.status !== 'active') throw new AppError('INVALID_INVITE', 400, 'الحساب معطّل');
  const problem = checkPasswordPolicy(input.password, user);
  if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);
  await ctx.trx
    .updateTable('users')
    .set({
      passwordHash: await hashPassword(input.password),
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
    })
    .where('id', '=', user.id)
    .execute();
  await ctx.trx
    .updateTable('passwordResets')
    .set({ usedAt: new Date() })
    .where('id', '=', row.id)
    .execute();
  await ctx.trx
    .updateTable('refreshTokens')
    .set({ revokedAt: new Date() })
    .where('userId', '=', user.id)
    .where('revokedAt', 'is', null)
    .execute();
  await audit(ctx, user.id, 'invite_accepted');
  invalidateSnapshot(user.id);
};
