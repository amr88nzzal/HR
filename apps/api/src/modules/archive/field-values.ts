import { sql } from 'kysely';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { FieldCrypto } from '../../shared/crypto.js';

export const MASK = '••••••';
const ENC = '$enc';

export type FieldDef = {
  key: string;
  labelAr: string;
  dataType:
    | 'text'
    | 'long_text'
    | 'number'
    | 'date'
    | 'amount'
    | 'boolean'
    | 'select'
    | 'file'
    | 'reminder_date';
  isRequired: boolean;
  isSensitive: boolean;
  isUnique: boolean;
  options: unknown;
  isActive: boolean;
};
type Values = Record<string, unknown>;

const bad = (key: string, message: string) =>
  new AppError('DOCUMENT_FIELD_INVALID', 400, `الحقل «${key}»: ${message}`, { field: key });
const isEnc = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && typeof (v as Values)[ENC] === 'string';
const aad = (typeId: string, key: string) => `documents.values.${typeId}.${key}`;

export const maskValues = (values: Values): Values =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, isEnc(v) ? MASK : v]));

const validDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

type Rules = { min?: number; max?: number; regex?: string };
const rulesOf = (def: FieldDef): Rules =>
  !Array.isArray(def.options) && typeof def.options === 'object' && def.options !== null
    ? (def.options as Rules)
    : {};

const coerce = (def: FieldDef, v: unknown, currencies: Set<string>): unknown => {
  const rules = rulesOf(def);
  switch (def.dataType) {
    case 'text':
    case 'long_text': {
      if (typeof v !== 'string') throw bad(def.key, 'يجب أن يكون نصاً');
      const t = v.trim();
      if (t.length > (def.dataType === 'text' ? 500 : 10000)) throw bad(def.key, 'النص طويل');
      if (rules.regex && !new RegExp(rules.regex).test(t)) throw bad(def.key, 'لا يطابق الصيغة');
      if (rules.min !== undefined && t.length < rules.min) throw bad(def.key, 'النص قصير');
      if (rules.max !== undefined && t.length > rules.max) throw bad(def.key, 'النص طويل');
      return t;
    }
    case 'number': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(def.key, 'يجب أن يكون رقماً');
      if (rules.min !== undefined && n < rules.min) throw bad(def.key, 'أقل من الحد الأدنى');
      if (rules.max !== undefined && n > rules.max) throw bad(def.key, 'أكبر من الحد الأعلى');
      return n;
    }
    case 'date':
    case 'reminder_date':
      if (!validDate(v)) throw bad(def.key, 'تاريخ بصيغة YYYY-MM-DD');
      return v;
    case 'amount': {
      const o = v as { amount?: unknown; currency?: unknown } | null;
      const raw = typeof o?.amount === 'number' ? String(o.amount) : o?.amount;
      if (typeof raw !== 'string' || !/^-?\d{1,14}(\.\d{1,4})?$/.test(raw.trim()))
        throw bad(def.key, 'مبلغ عشري بحد أقصى 4 منازل');
      if (typeof o?.currency !== 'string' || !currencies.has(o.currency))
        throw bad(def.key, 'عملة غير معرّفة في الشركة');
      const [i = '0', f = ''] = raw.trim().split('.');
      return { amount: `${i}.${f.padEnd(4, '0')}`, currency: o.currency };
    }
    case 'boolean':
      if (typeof v !== 'boolean') throw bad(def.key, 'يجب أن يكون صح/خطأ');
      return v;
    case 'select': {
      const allowed = Array.isArray(def.options)
        ? def.options.map((o) => (o as { value: string }).value)
        : [];
      if (typeof v !== 'string' || !allowed.includes(v))
        throw bad(def.key, 'قيمة غير ضمن الخيارات');
      return v;
    }
    case 'file':
      throw bad(def.key, 'الملفات تُرفع عبر مسار files لا ضمن القيم');
  }
};

export type PreparedValues = {
  values: Values;
  /** تواريخ حقول التذكير الحالية (مفتاح ← تاريخ) لمزامنة document_reminders */
  reminders: Map<string, string>;
};

/**
 * يتحقق من قيم وثيقة ويُنتج ما يُخزَّن:
 * - مفاتيح غير معرّفة/معطّلة مرفوضة؛ null أو '' يمسح؛ قناع العرض يُبقي الحساس الحالي.
 * - الحساس يُشفَّر؛ الفريد يُفحص ضمن نوع الوثيقة (للوثائق النشطة) بقفل استشاري.
 * - الإلزامي يُفحص على النتيجة النهائية (حقول الملفات مستثناة لأنها ترفع لاحقاً).
 */
export const prepareValues = async (
  ctx: Ctx,
  crypto: FieldCrypto | undefined,
  typeId: string,
  defs: FieldDef[],
  incoming: Values,
  existing: Values,
  selfId: string | null,
): Promise<PreparedValues> => {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const needsCurrency = Object.entries(incoming).some(
    ([k, v]) => byKey.get(k)?.dataType === 'amount' && v !== null && v !== '',
  );
  const currencies = needsCurrency
    ? new Set(
        (
          await ctx.trx
            .selectFrom('currencies')
            .select('code')
            .where('companyId', '=', ctx.companyId)
            .execute()
        ).map((c) => c.code),
      )
    : new Set<string>();
  const result: Values = { ...existing };

  for (const [key, raw] of Object.entries(incoming)) {
    const def = byKey.get(key);
    if (!def || !def.isActive) throw bad(key, 'حقل غير معرّف أو معطّل');
    if (raw === null || raw === '') {
      delete result[key];
      continue;
    }
    if (def.isSensitive && raw === MASK && isEnc(existing[key])) continue;
    const value = coerce(def, raw, currencies);
    if (def.isSensitive) {
      if (!crypto)
        throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
      result[key] = { [ENC]: crypto.encrypt(JSON.stringify(value), aad(typeId, key)) };
    } else {
      result[key] = value;
    }
  }

  for (const def of defs) {
    if (def.isActive && def.isRequired && def.dataType !== 'file' && result[def.key] === undefined)
      throw bad(def.key, 'حقل إلزامي');
  }

  for (const def of defs) {
    const v = result[def.key];
    if (!def.isUnique || v === undefined || !(def.key in incoming)) continue;
    await sql`select pg_advisory_xact_lock(hashtext(${`${typeId}:${def.key}`}))`.execute(ctx.trx);
    const dup = await sql<{ id: string }>`
      select id from documents
       where company_id = ${ctx.companyId} and document_type_id = ${typeId}
         and status = 'active'
         and "values" -> ${def.key} = ${JSON.stringify(v)}::jsonb
         and (${selfId}::uuid is null or id <> ${selfId}::uuid)
       limit 1`.execute(ctx.trx);
    if (dup.rows.length) throw bad(def.key, 'القيمة مستخدمة في وثيقة أخرى من النوع نفسه');
  }

  const reminders = new Map<string, string>();
  for (const def of defs) {
    const v = result[def.key];
    if (def.dataType === 'reminder_date' && typeof v === 'string') reminders.set(def.key, v);
  }
  return { values: result, reminders };
};

export const decryptValue = (
  crypto: FieldCrypto,
  typeId: string,
  values: Values,
  key: string,
): unknown => {
  const v = values[key];
  if (!isEnc(v)) throw new AppError('NOT_FOUND', 404, 'لا توجد قيمة حساسة لهذا الحقل');
  return JSON.parse(crypto.decrypt(v[ENC] as string, aad(typeId, key)));
};
