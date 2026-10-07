import { createHash, randomUUID } from 'node:crypto';
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES } from '@hrms/shared';
import type { Ctx } from '../db/tenant.js';
import { AppError } from './errors.js';
import type { FieldCrypto } from './crypto.js';
import type { StorageProvider } from './storage.js';

export type FileDeps = { storage: StorageProvider | undefined; crypto: FieldCrypto | undefined };

/** يحدد نوع الملف من توقيع البايتات (لا يُوثق بترويسة العميل). */
export const sniffFileType = (buf: Buffer): keyof typeof ALLOWED_FILE_TYPES | null => {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const head = buf.toString('latin1');
    if (head.includes('word/'))
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (head.includes('xl/'))
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return null;
};

/** يتحقق من الحجم والنوع؛ يرمي أخطاء واضحة. */
export const validateUpload = (
  buf: Buffer,
  allowed?: readonly string[],
): keyof typeof ALLOWED_FILE_TYPES => {
  if (!buf.length) throw new AppError('EMPTY_FILE', 400, 'الملف فارغ');
  if (buf.length > MAX_FILE_BYTES)
    throw new AppError('FILE_TOO_LARGE', 413, 'حجم الملف يتجاوز 20 ميغابايت');
  const mime = sniffFileType(buf);
  if (!mime || (allowed && !allowed.includes(mime)))
    throw new AppError('FILE_TYPE_NOT_ALLOWED', 415, 'نوع الملف غير مسموح');
  return mime;
};

const needStorage = (deps: FileDeps): StorageProvider => {
  if (!deps.storage) throw new AppError('STORAGE_NOT_CONFIGURED', 503, 'تخزين الملفات غير مهيّأ');
  return deps.storage;
};

/** اسم للعرض فقط: لا مسارات ولا محارف تحكم */
const cleanName = (name: string): string =>
  Array.from(name)
    .map((ch) => (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim()
    .slice(0, 200) || 'file';

export type SaveFileInput = {
  buffer: Buffer;
  mime: string;
  originalName: string;
  purpose: 'document' | 'employee_photo';
  encrypt: boolean;
  parentId?: string | null;
  variant?: string | null;
};

/**
 * يحفظ الملف في التخزين ثم يسجّله في stored_files.
 * عند فشل التسجيل يُحذف الملف المرفوع. يعيد صف الملف (بلا بايتات).
 */
export const saveStoredFile = async (ctx: Ctx, deps: FileDeps, input: SaveFileInput) => {
  const storage = needStorage(deps);
  if (input.encrypt && !deps.crypto)
    throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
  const key = `${ctx.companyId}/${new Date().getUTCFullYear()}/${randomUUID()}`;
  const payload =
    input.encrypt && deps.crypto
      ? Buffer.from(
          deps.crypto.encrypt(input.buffer.toString('base64'), `stored_files.${key}`),
          'utf8',
        )
      : input.buffer;
  await storage.put(key, payload);
  try {
    return await ctx.trx
      .insertInto('storedFiles')
      .values({
        companyId: ctx.companyId,
        storageKey: key,
        originalName: cleanName(input.originalName),
        mimeType: input.mime,
        sizeBytes: input.buffer.length,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
        isEncrypted: input.encrypt,
        purpose: input.purpose,
        parentId: input.parentId ?? null,
        variant: input.variant ?? null,
        createdBy: ctx.userId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
};

/** يقرأ بايتات الملف (ويفك التشفير عند الحاجة). */
export const readStoredFile = async (
  deps: FileDeps,
  file: { storageKey: string; isEncrypted: boolean },
): Promise<Buffer> => {
  const raw = await needStorage(deps).get(file.storageKey);
  if (!file.isEncrypted) return raw;
  if (!deps.crypto)
    throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
  return Buffer.from(
    deps.crypto.decrypt(raw.toString('utf8'), `stored_files.${file.storageKey}`),
    'base64',
  );
};

/** حذف بايتات ملفات بعد نجاح المعاملة (محاولة فقط؛ اليتيم يُنظَّف لاحقاً بمهمة دورية). */
export const deleteStoredBytes = async (deps: FileDeps, keys: string[]): Promise<void> => {
  if (!deps.storage) return;
  await Promise.all(keys.map((k) => deps.storage?.delete(k).catch(() => undefined)));
};
