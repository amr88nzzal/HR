import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * تشفير الحقول الحساسة داخل التطبيق: AES-256-GCM.
 * الحمولة: `v1.<keyId>.<iv>.<ciphertext+tag>` (base64url) فيمكن تدوير المفاتيح دون إعادة تشفير فوري.
 * `aad` يربط النص المشفّر بسياقه (جدول.عمود) فلا يصلح نقله إلى حقل آخر.
 * البصمة (digest): HMAC-SHA256 بمفتاح مستقل للبحث بالتطابق دون فك التشفير.
 */
export type FieldCrypto = {
  encrypt: (plain: string, aad: string) => string;
  decrypt: (payload: string, aad: string) => string;
  digest: (value: string) => string;
};

const KEY_BYTES = 32;

const decodeKey = (b64: string, label: string): Buffer => {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES)
    throw new Error(`${label}: يجب أن يكون المفتاح 32 بايت بترميز base64`);
  return key;
};

/** keysSpec: "k1:BASE64,k2:BASE64" */
export const createFieldCrypto = (opts: {
  keysSpec: string;
  currentKeyId: string;
  digestKey: string;
}): FieldCrypto => {
  const keys = new Map<string, Buffer>();
  for (const part of opts.keysSpec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const idx = part.indexOf(':');
    if (idx < 1) throw new Error('ENCRYPTION_KEYS: الصيغة id:base64');
    const id = part.slice(0, idx);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('ENCRYPTION_KEYS: معرّف مفتاح غير صالح');
    keys.set(id, decodeKey(part.slice(idx + 1), `ENCRYPTION_KEYS[${id}]`));
  }
  const current = keys.get(opts.currentKeyId);
  if (!current) throw new Error('ENCRYPTION_KEY_ID غير موجود ضمن ENCRYPTION_KEYS');
  const digestKey = decodeKey(opts.digestKey, 'ENCRYPTION_DIGEST_KEY');

  return {
    encrypt: (plain, aad) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current, iv);
      cipher.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return `v1.${opts.currentKeyId}.${iv.toString('base64url')}.${ct.toString('base64url')}`;
    },
    decrypt: (payload, aad) => {
      const [version, keyId, iv, data] = payload.split('.');
      const key = keyId ? keys.get(keyId) : undefined;
      if (version !== 'v1' || !key || !iv || !data) throw new Error('حمولة مشفّرة غير صالحة');
      const raw = Buffer.from(data, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([
        decipher.update(raw.subarray(0, raw.length - 16)),
        decipher.final(),
      ]).toString('utf8');
    },
    digest: (value) => createHmac('sha256', digestKey).update(value).digest('hex'),
  };
};
