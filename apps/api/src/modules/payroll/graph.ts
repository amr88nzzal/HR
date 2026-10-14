import { formulaRefs, parseFormula } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

/**
 * يتأكد أن اعتماديات المكونات بلا حلقات: مكوّن صيغة يعتمد على المكونات التي يذكرها وعلى أعضاء
 * الأسس التي يذكرها، ومكوّن النسبة/الجدول يعتمد على أعضاء أساسه. يُستدعى بعد الكتابة داخل
 * المعاملة نفسها فيُلغي رميُ الخطأ الكتابةَ.
 */
export const assertAcyclic = async (ctx: Ctx): Promise<void> => {
  const comps = await ctx.trx
    .selectFrom('payComponents')
    .select(['id', 'code', 'nameAr', 'calcType', 'baseId', 'formula'])
    .where('companyId', '=', ctx.companyId)
    .execute();
  const bases = await ctx.trx
    .selectFrom('payrollBases')
    .select(['id', 'code'])
    .where('companyId', '=', ctx.companyId)
    .execute();
  const links = await ctx.trx
    .selectFrom('payComponentBases')
    .select(['baseId', 'componentId'])
    .where('companyId', '=', ctx.companyId)
    .execute();
  const byCode = new Map(comps.map((c) => [c.code, c.id]));
  const baseByCode = new Map(bases.map((b) => [b.code, b.id]));
  const members = new Map<string, string[]>();
  for (const l of links) members.set(l.baseId, [...(members.get(l.baseId) ?? []), l.componentId]);

  const edges = new Map<string, Set<string>>();
  for (const c of comps) {
    const out = new Set<string>();
    if ((c.calcType === 'percent' || c.calcType === 'rate_table') && c.baseId)
      for (const m of members.get(c.baseId) ?? []) out.add(m);
    if (c.calcType === 'formula' && c.formula) {
      const refs = formulaRefs(parseFormula(c.formula));
      for (const v of refs.vars) {
        const id = byCode.get(v);
        if (id) out.add(id);
      }
      for (const b of refs.bases) {
        const bid = baseByCode.get(b);
        if (bid) for (const m of members.get(bid) ?? []) out.add(m);
      }
    }
    edges.set(c.id, out);
  }
  const state = new Map<string, 1 | 2>();
  const name = new Map(comps.map((c) => [c.id, c.nameAr]));
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cycle = [...path.slice(path.indexOf(id)), id].map((x) => name.get(x) ?? x);
      throw new AppError(
        'CIRCULAR_DEPENDENCY',
        400,
        `اعتماد دائري بين المكونات: ${cycle.join(' ← ')}`,
      );
    }
    state.set(id, 1);
    for (const next of edges.get(id) ?? []) visit(next, [...path, id]);
    state.set(id, 2);
  };
  for (const c of comps) visit(c.id, []);
};
