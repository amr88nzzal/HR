import { sql } from 'kysely';
import { SETTING_DEFS, formatEmployeeNo } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

/** تسلسل ذري لكل شركة: يزيد العدّاد ويعيد القيمة المحجوزة. */
const takeSequence = async (ctx: Ctx, key: string): Promise<number> => {
  const { rows } = await sql<{ value: string }>`
    insert into numbering_sequences (company_id, key, next_value)
    values (${ctx.companyId}, ${key}, 2)
    on conflict (company_id, key) do update set next_value = numbering_sequences.next_value + 1
    returning next_value - 1 as value`.execute(ctx.trx);
  return Number(rows[0]?.value);
};

/** الرقم الوظيفي التالي حسب صيغة الشركة؛ يتخطى أي رقم أُدخل يدوياً ويطابق المولَّد. */
export const nextEmployeeNo = async (ctx: Ctx): Promise<string> => {
  const row = await ctx.trx
    .selectFrom('settings')
    .select('value')
    .where('scopeType', '=', 'company')
    .where('key', '=', 'employeeNoFormat')
    .executeTakeFirst();
  const parsed = SETTING_DEFS.employeeNoFormat.schema.safeParse(row?.value);
  const format = parsed.success ? parsed.data : SETTING_DEFS.employeeNoFormat.default;
  for (let i = 0; i < 100; i += 1) {
    const candidate = formatEmployeeNo(format, await takeSequence(ctx, 'employee_no'));
    const taken = await ctx.trx
      .selectFrom('employees')
      .select('id')
      .where('employeeNo', '=', candidate)
      .executeTakeFirst();
    if (!taken) return candidate;
  }
  throw new AppError('NUMBERING_EXHAUSTED', 409, 'تعذّر توليد رقم وظيفي فريد، راجع صيغة الترقيم');
};
