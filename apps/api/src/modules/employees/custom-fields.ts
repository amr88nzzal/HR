import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FieldCrypto } from '../../shared/crypto.js';

export const MASK = '••••••';
const ENC_KEY = '$enc';
const aad = (key: string) => `employees.custom_fields.${key}`;

type Stored = Record<string, unknown>;
type Definition = {
  key: string;
  labelAr: string;
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options: unknown[];
  isRequired: boolean;
  isSensitive: boolean;
  isActive: boolean;
};

const bad = (key: string, message: string) =>
  new AppError('CUSTOM_FIELD_INVALID', 400, `الحقل «${key}»: ${message}`, { field: key });

const isEnc = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && typeof (v as Stored)[ENC_KEY] === 'string';

/** عرض آمن: القيم المشفّرة تُستبدل بقناع في كل استجابة. */
export const maskCustomFields = (fields: Stored): Stored =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, isEnc(v) ? MASK : v]));

export const withMaskedCustomFields = <T extends { customFields?: Stored }>(row: T): T =>
  row.customFields ? { ...row, customFields: maskCustomFields(row.customFields) } : row;

const validDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** يتحقق من نوع القيمة ويعيدها بصيغتها المخزّنة. */
const coerce = (def: Definition, v: unknown): unknown => {
  switch (def.fieldType) {
    case 'text':
      if (typeof v !== 'string') throw bad(def.key, 'يجب أن يكون نصاً');
      if (v.trim().length > 1000) throw bad(def.key, 'النص أطول من 1000 حرف');
      return v.trim();
    case 'number': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(def.key, 'يجب أن يكون رقماً');
      return n;
    }
    case 'date':
      if (typeof v !== 'string' || !validDate(v)) throw bad(def.key, 'تاريخ بصيغة YYYY-MM-DD');
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') throw bad(def.key, 'يجب أن يكون صح/خطأ');
      return v;
    case 'select': {
      const allowed = def.options.map((o) => (o as { value: string }).value);
      if (typeof v !== 'string' || !allowed.includes(v))
        throw bad(def.key, 'قيمة غير ضمن الخيارات');
      return v;
    }
  }
};

/**
 * يحوّل مدخلات الحقول المخصصة إلى ما يُخزَّن:
 * - المفاتيح غير المعرّفة أو المعطّلة مرفوضة.
 * - null أو نص فارغ يمسح القيمة؛ وقناع العرض يُبقي القيمة الحالية (للحقول الحساسة).
 * - الحقول الحساسة تُشفَّر.
 * - الحقول الإلزامية تُفحص على النتيجة النهائية.
 * `existing` القيم الحالية (فارغة عند الإنشاء)؛ المدخلات تُدمج فوقها.
 */
export const prepareCustomFields = async (
  ctx: Ctx,
  crypto: FieldCrypto | undefined,
  incoming: Stored | undefined,
  existing: Stored,
): Promise<Stored> => {
  const defs = (await ctx.trx
    .selectFrom('customFieldDefinitions')
    .select(['key', 'labelAr', 'fieldType', 'options', 'isRequired', 'isSensitive', 'isActive'])
    .where('companyId', '=', ctx.companyId)
    .where('entity', '=', 'employee')
    .execute()) as Definition[];
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const result: Stored = { ...existing };

  for (const [key, raw] of Object.entries(incoming ?? {})) {
    const def = byKey.get(key);
    if (!def || !def.isActive) throw bad(key, 'حقل غير معرّف أو معطّل');
    if (raw === null || raw === '') {
      delete result[key];
      continue;
    }
    if (def.isSensitive && raw === MASK && isEnc(existing[key])) continue;
    const value = coerce(def, raw);
    if (def.isSensitive) {
      if (!crypto)
        throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
      result[key] = { [ENC_KEY]: crypto.encrypt(JSON.stringify(value), aad(key)) };
    } else {
      result[key] = value;
    }
  }
  for (const def of defs) {
    if (def.isActive && def.isRequired && result[def.key] === undefined)
      throw bad(def.key, 'حقل إلزامي');
  }
  return result;
};

/** يفك تشفير حقل حساس واحد؛ لا يدقّق (المسار المستدعي يدقّق). */
export const decryptCustomField = (crypto: FieldCrypto, fields: Stored, key: string): unknown => {
  const v = fields[key];
  if (!isEnc(v)) throw new AppError('NOT_FOUND', 404, 'لا توجد قيمة حساسة لهذا الحقل');
  return JSON.parse(crypto.decrypt(v[ENC_KEY] as string, aad(key)));
};
