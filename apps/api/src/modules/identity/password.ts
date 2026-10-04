import { hash, verify } from '@node-rs/argon2';

// argon2id (الخوارزمية الافتراضية للمكتبة هي Argon2id) بمعاملات OWASP
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => hash(plain, OPTS);

export const verifyPassword = async (hashed: string, plain: string): Promise<boolean> => {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
};

const COMMON = new Set(
  [
    'password',
    'password1',
    'password12',
    'password123',
    'passw0rd123',
    '1234567890',
    '12345678910',
    '123456789012',
    'qwertyuiop',
    'qwerty12345',
    'qwerty123456',
    'iloveyou123',
    'admin12345',
    'administrator',
    'welcome123',
    'welcome1234',
    'letmein1234',
    'abc1234567',
    'abcd123456',
    '0123456789',
    'changeme123',
    'p@ssw0rd123',
    'p@ssword123',
    'hrms123456',
    '1q2w3e4r5t',
    '1qaz2wsx3edc',
  ].map((s) => s.toLowerCase()),
);

export const MIN_PASSWORD_LENGTH = 10;

/** سياسة كلمة المرور: ≥10 أحرف، ليست شائعة، ولا تحتوي بريد/اسم المستخدم. يرجع رسالة الخطأ أو null. */
export const checkPasswordPolicy = (
  plain: string,
  user: { email?: string; username?: string | null } = {},
): string | null => {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف`;
  }
  const lower = plain.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(plain)) return 'كلمة المرور شائعة وسهلة التخمين';
  const local = user.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    return 'كلمة المرور لا يجب أن تحتوي بريد المستخدم';
  }
  if (user.username && user.username.length >= 4 && lower.includes(user.username.toLowerCase())) {
    return 'كلمة المرور لا يجب أن تحتوي اسم المستخدم';
  }
  return null;
};
