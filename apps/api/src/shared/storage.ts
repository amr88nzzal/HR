import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** مزوّد تخزين الملفات: قرص محلي الآن، وS3-متوافق لاحقاً بالواجهة نفسها. */
export type StorageProvider = {
  put: (key: string, data: Buffer) => Promise<void>;
  get: (key: string) => Promise<Buffer>;
  /** حذف صامت إن لم يوجد الملف */
  delete: (key: string) => Promise<void>;
};

// المفاتيح يولّدها الخادم فقط (معرّفات وشرطات وشرطات مائلة)، ونرفض غيرها دفاعاً ضد اجتياز المسار
const SAFE_KEY = /^[0-9a-f-]{36}\/\d{4}\/[0-9a-f-]{36}$/;

export const createLocalStorage = (root: string): StorageProvider => {
  const base = path.resolve(root);
  const resolve = (key: string): string => {
    if (!SAFE_KEY.test(key)) throw new Error('مفتاح تخزين غير صالح');
    return path.join(base, key);
  };
  return {
    put: async (key, data) => {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { mode: 0o600 });
    },
    get: (key) => readFile(resolve(key)),
    delete: async (key) => {
      await rm(resolve(key), { force: true });
    },
  };
};
