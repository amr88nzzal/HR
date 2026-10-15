import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { EmployeeAccountInput } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import type { Notifier } from '../../notifications/index.js';
import { AppError } from '../../shared/errors.js';
import { checkPasswordPolicy, hashPassword, issueInvite } from '../identity/index.js';

export type AccountDeps = { notifier: Notifier; publicUrl: string | undefined };
export type AccountState = 'none' | 'invited' | 'active' | 'disabled';

const audit = (ctx: Ctx, employeeId: string, action: string, changes: unknown) =>
  ctx.trx
    .insertInto('auditLogs')
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      entityType: 'employees',
      entityId: employeeId,
      action,
      changes: JSON.stringify(changes),
      requestId: ctx.requestId,
      ip: null,
    })
    .execute();

/** مدعو = لم يدخل بعد ولم يعيّن كلمته (أو ما زالت مؤقتة) */
export const stateOf = (
  u: { status: string; lastLoginAt: Date | null; mustChangePassword: boolean } | undefined,
): AccountState =>
  !u
    ? 'none'
    : u.status === 'disabled'
      ? 'disabled'
      : !u.lastLoginAt && u.mustChangePassword
        ? 'invited'
        : 'active';

const inviteLinkOf = (publicUrl: string | undefined, token: string) =>
  `${(publicUrl ?? '').replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;

const sendInvite = async (
  ctx: Ctx,
  deps: AccountDeps,
  user: { id: string; displayName: string },
) => {
  const { token, expiresAt } = await issueInvite(ctx, user.id);
  const link = inviteLinkOf(deps.publicUrl, token);
  await deps.notifier.notify(ctx, {
    userId: user.id,
    event: 'identity.invite',
    vars: {
      name: user.displayName,
      link,
      expires: expiresAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    },
  });
  return { inviteLink: link, inviteExpiresAt: expiresAt.toISOString() };
};

/** البريد الأساسي للموظف من جهات الاتصال (الأساسي أولاً) */
const contactEmail = async (ctx: Ctx, employeeId: string): Promise<string | null> => {
  const row = await ctx.trx
    .selectFrom('employeeContacts')
    .select('value')
    .where('employeeId', '=', employeeId)
    .where('type', '=', 'email')
    .orderBy('isPrimary', 'desc')
    .executeTakeFirst();
  return row?.value.trim().toLowerCase() ?? null;
};

export const createEmployeeAccount = async (
  ctx: Ctx,
  deps: AccountDeps,
  emp: { id: string; fullNameAr: string; userId: string | null },
  input: EmployeeAccountInput,
) => {
  if (emp.userId) throw new AppError('ALREADY_LINKED', 409, 'الموظف مرتبط بحساب بالفعل');
  const email = input.email ?? (await contactEmail(ctx, emp.id));
  if (!email)
    throw new AppError(
      'EMAIL_REQUIRED',
      400,
      'أدخل بريداً إلكترونياً أو أضف بريداً في جهات اتصال الموظف',
    );
  const taken = await ctx.trx
    .selectFrom('users')
    .select('id')
    .where((eb) =>
      input.username
        ? eb.or([eb('email', '=', email), eb('username', '=', input.username)])
        : eb('email', '=', email),
    )
    .executeTakeFirst();
  if (taken) throw new AppError('EMAIL_TAKEN', 409, 'البريد أو اسم الدخول مستخدم لحساب آخر');

  const temp = input.delivery === 'temp';
  const password = temp
    ? (input.password ?? `${randomBytes(9).toString('base64url')}Aa1!`)
    : // دعوة: كلمة عشوائية لا يعرفها أحد حتى يعيّن الموظف كلمته بنفسه
      `${randomBytes(24).toString('base64url')}Aa1!`;
  if (temp) {
    const problem = checkPasswordPolicy(password, { email, username: input.username ?? null });
    if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);
  }
  const user = await ctx.trx
    .insertInto('users')
    .values({
      companyId: ctx.companyId,
      email,
      username: input.username ?? null,
      displayName: emp.fullNameAr,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    })
    .returning(['id', 'displayName'])
    .executeTakeFirstOrThrow();

  const role = input.roleId
    ? await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('id', '=', input.roleId)
        .executeTakeFirst()
    : await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('code', '=', 'employee')
        .executeTakeFirst();
  if (input.roleId && !role) throw new AppError('INVALID_REFERENCE', 400, 'الدور غير موجود');
  if (role)
    await ctx.trx
      .insertInto('userRoleAssignments')
      .values({
        companyId: ctx.companyId,
        userId: user.id,
        roleId: role.id,
        scopeType: 'self',
        scopeId: null,
      })
      .execute();
  await ctx.trx
    .updateTable('employees')
    .set({ userId: user.id, version: sql`version + 1` })
    .where('id', '=', emp.id)
    .execute();
  await audit(ctx, emp.id, 'account_created', { userId: user.id, email, delivery: input.delivery });
  const base = { userId: user.id, email, delivery: input.delivery };
  if (temp) return { ...base, tempPassword: password };
  return { ...base, ...(await sendInvite(ctx, deps, user)) };
};

export const resendInvite = async (ctx: Ctx, deps: AccountDeps, userId: string | null) => {
  const user = userId
    ? await ctx.trx
        .selectFrom('users')
        .select(['id', 'displayName', 'status', 'lastLoginAt', 'mustChangePassword'])
        .where('id', '=', userId)
        .executeTakeFirst()
    : undefined;
  if (stateOf(user) !== 'invited' || !user)
    throw new AppError('NOT_INVITED', 409, 'الدعوة تُرسل لحساب لم يُفعَّل بعد فقط');
  return sendInvite(ctx, deps, user);
};

export const accountOf = async (ctx: Ctx, employeeId: string) => {
  const { rows } = await sql<Record<string, unknown>>`
    select u.id as user_id, u.email, u.username, u.status, u.disabled_reason, u.last_login_at,
           u.must_change_password,
           (select max(p.expires_at) from password_resets p
             where p.user_id = u.id and p.used_at is null and p.expires_at > now()) as invite_expires_at
      from employees e left join users u on u.id = e.user_id
     where e.id = ${employeeId}`.execute(ctx.trx);
  const r = rows[0];
  if (!r || !r['userId']) return { state: 'none' as const };
  return {
    state: stateOf({
      status: String(r['status']),
      lastLoginAt: (r['lastLoginAt'] as Date | null) ?? null,
      mustChangePassword: Boolean(r['mustChangePassword']),
    }),
    userId: r['userId'],
    email: r['email'],
    username: r['username'],
    status: r['status'],
    disabledReason: r['disabledReason'],
    lastLoginAt: r['lastLoginAt'],
    mustChangePassword: r['mustChangePassword'],
    inviteExpiresAt: r['inviteExpiresAt'],
  };
};

/** إنهاء الخدمة يعطّل الحساب المرتبط (ويُبطل جلساته)، وإعادة التعيين ترفع هذا التعطيل فقط */
export const syncAccountWithEmployment = async (
  ctx: Ctx,
  employeeId: string,
  ended: boolean,
): Promise<boolean> => {
  const emp = await ctx.trx
    .selectFrom('employees')
    .select('userId')
    .where('id', '=', employeeId)
    .executeTakeFirst();
  if (!emp?.userId) return false;
  if (ended) {
    const r = await ctx.trx
      .updateTable('users')
      .set({ status: 'disabled', disabledReason: 'employment_ended', version: sql`version + 1` })
      .where('id', '=', emp.userId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    await ctx.trx
      .updateTable('refreshTokens')
      .set({ revokedAt: new Date() })
      .where('userId', '=', emp.userId)
      .where('revokedAt', 'is', null)
      .execute();
    if (Number(r.numUpdatedRows) > 0)
      await audit(ctx, employeeId, 'account_disabled', { reason: 'employment_ended' });
    return true;
  }
  const r = await ctx.trx
    .updateTable('users')
    .set({ status: 'active', disabledReason: null, version: sql`version + 1` })
    .where('id', '=', emp.userId)
    .where('disabledReason', '=', 'employment_ended')
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) > 0)
    await audit(ctx, employeeId, 'account_enabled', { reason: 'rehired' });
  return true;
};
