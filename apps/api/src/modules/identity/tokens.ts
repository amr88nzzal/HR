import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export type AccessClaims = { userId: string; companyId: string; permissionsVersion: number };

const key = (secret: string) => new TextEncoder().encode(secret);

export const signAccessToken = (
  claims: AccessClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> =>
  new SignJWT({ cid: claims.companyId, pv: claims.permissionsVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));

/** يرجع null لأي توكن غير صالح/منتهٍ. */
export const verifyAccessToken = async (
  token: string,
  secret: string,
): Promise<AccessClaims | null> => {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload['cid'] !== 'string') return null;
    return {
      userId: payload.sub,
      companyId: payload['cid'],
      permissionsVersion: Number(payload['pv'] ?? 0),
    };
  } catch {
    return null;
  }
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** توكن معتم بصيغة `<companyId>.<عشوائي>`؛ المعرّف يسمح بضبط سياق RLS قبل البحث. */
export const generateOpaqueToken = (companyId: string): { token: string; hash: string } => {
  const token = `${companyId}.${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256(token) };
};

export const companyIdFromOpaqueToken = (token: string): string | null => {
  const [cid, secret] = token.split('.');
  return cid && secret && /^[0-9a-f-]{36}$/i.test(cid) ? cid : null;
};
