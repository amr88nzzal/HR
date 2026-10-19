import type { Ctx } from '../../db/tenant.js';

/** الأنواع الافتراضية (تُنشأ عند الطلب إن لم توجد): الأبعد تصعيداً أولاً لأن كل نوع يشير إلى التالي */
const DEFAULT_TYPES = [
  { code: 'warning_final', ar: 'إنذار نهائي', en: 'Final warning', cat: 'warning', approval: true },
  {
    code: 'warning_written',
    ar: 'إنذار كتابي',
    en: 'Written warning',
    cat: 'warning',
    approval: true,
    next: { code: 'warning_final', count: 2, days: 365 },
  },
  {
    code: 'notice_verbal',
    ar: 'تنبيه شفهي',
    en: 'Verbal notice',
    cat: 'notice',
    approval: false,
    next: { code: 'warning_written', count: 3, days: 180 },
  },
  {
    code: 'penalty_deduction',
    ar: 'خصم من الراتب',
    en: 'Salary deduction',
    cat: 'penalty',
    approval: true,
    effect: 'deduction',
  },
  {
    code: 'penalty_suspension',
    ar: 'إيقاف عن العمل',
    en: 'Suspension',
    cat: 'penalty',
    approval: true,
  },
  {
    code: 'reward_cash',
    ar: 'مكافأة نقدية',
    en: 'Cash reward',
    cat: 'reward_cash',
    approval: true,
    effect: 'bonus',
  },
  {
    code: 'reward_moral',
    ar: 'مكافأة معنوية',
    en: 'Moral reward',
    cat: 'reward_moral',
    approval: false,
  },
  {
    code: 'commendation',
    ar: 'كتاب شكر وتقدير',
    en: 'Commendation',
    cat: 'commendation',
    approval: false,
  },
  { code: 'promotion', ar: 'ترقية', en: 'Promotion', cat: 'promotion', approval: true },
] as const;

/**
 * ينشئ الأنواع الافتراضية الناقصة ويعيد عدد ما أُنشئ (آمن عند التكرار).
 * Creates the missing default types and returns how many were created (idempotent).
 */
export const ensureDefaultTypes = async (ctx: Ctx): Promise<number> => {
  const ids = new Map<string, string>();
  let n = 0;
  for (const t of DEFAULT_TYPES) {
    const existing = await ctx.trx
      .selectFrom('adminActionTypes')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('code', '=', t.code)
      .executeTakeFirst();
    if (existing) {
      ids.set(t.code, existing.id);
      continue;
    }
    const next = 'next' in t ? t.next : null;
    const row = await ctx.trx
      .insertInto('adminActionTypes')
      .values({
        companyId: ctx.companyId,
        code: t.code,
        nameAr: t.ar,
        nameEn: t.en,
        category: t.cat,
        payrollEffect: 'effect' in t ? t.effect : 'none',
        requiresApproval: t.approval,
        escalationTypeId: next ? (ids.get(next.code) ?? null) : null,
        escalationCount: next ? next.count : null,
        escalationWindowDays: next ? next.days : null,
        letterTemplateCode: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.set(t.code, row.id);
    n += 1;
  }
  return n;
};
