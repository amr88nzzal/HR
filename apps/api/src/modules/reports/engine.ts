import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { employeeScope } from '../employees/index.js';
import type { AuthContext } from '../identity/index.js';
import { REPORTS, reportByCode } from './catalog.js';
import type {
  Filters,
  ReportColumn,
  ReportDef,
  ReportFilter,
  ReportManifest,
  Row,
} from './types.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const has = (auth: AuthContext, code: string): boolean => auth.grants.some((g) => g.code === code);

/** التقارير التي يستطيع المستخدم رؤيتها (يملك صلاحيتها بأي نطاق) */
export const visibleReports = (auth: AuthContext): ReportDef[] =>
  REPORTS.filter((r) => has(auth, r.manifest.permission));

export const requireReport = (auth: AuthContext, code: string): ReportDef => {
  const r = reportByCode(code);
  // التقرير غير المسموح كغير الموجود: لا يكشف وجوده
  if (!r || !has(auth, r.manifest.permission))
    throw new AppError('NOT_FOUND', 404, 'التقرير غير موجود');
  return r;
};

/** أعمدة التقرير المسموحة للمستخدم (الأعمدة المقيَّدة بصلاحية تُحذف كلياً) */
export const allowedColumns = (auth: AuthContext, m: ReportManifest): ReportColumn[] =>
  m.columns.filter((c) => !c.requires || has(auth, c.requires));

/** يحوّل manifest إلى ما يُعرض للمستخدم (بلا الأعمدة المحجوبة) */
export const manifestFor = (auth: AuthContext, m: ReportManifest): ReportManifest => ({
  ...m,
  columns: allowedColumns(auth, m),
});

const filterSchema = (f: ReportFilter): z.ZodType<string | undefined> => {
  let s: z.ZodType<string>;
  switch (f.type) {
    case 'date':
      s = z.string().regex(DATE, 'تاريخ غير صالح');
      break;
    case 'month':
      s = z.string().regex(MONTH, 'شهر غير صالح');
      break;
    case 'uuid':
      s = z.string().uuid();
      break;
    case 'number':
      s = z.string().regex(/^\d{1,9}$/, 'رقم غير صالح');
      break;
    case 'select':
      s = z.enum((f.options ?? []).map((o) => o.value) as [string, ...string[]]);
      break;
    default:
      s = z.string().trim().min(1).max(100);
  }
  return f.required ? s : s.optional();
};

/** يتحقق من قيم المرشحات حسب manifest ويتجاهل غير المعرَّف منها */
export const parseFilters = (m: ReportManifest, input: unknown): Filters => {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const f of m.filters) shape[f.key] = filterSchema(f);
  const clean: Record<string, unknown> = {};
  for (const f of m.filters) {
    const v = raw[f.key];
    clean[f.key] = typeof v === 'string' && v !== '' ? v : undefined;
  }
  const r = z.object(shape).safeParse(clean);
  if (!r.success)
    throw new AppError('VALIDATION_ERROR', 400, 'مرشحات التقرير غير صالحة', r.error.flatten());
  return r.data as Filters;
};

const trimAmount = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const [i = '0', d = ''] = Number(v).toFixed(4).replace(/0+$/, '').split('.');
  return `${i}.${d.padEnd(2, '0')}`;
};

/** يُسقط ما لا يطلبه المستخدم/لا يحق له، ويطبّع الأنواع */
const shape = (cols: ReportColumn[], row: Row): Row => {
  const out: Row = {};
  for (const c of cols) {
    const v = row[c.key];
    out[c.key] =
      v === null || v === undefined
        ? null
        : c.type === 'money'
          ? trimAmount(v)
          : c.type === 'number'
            ? Number(v)
            : String(v);
  }
  return out;
};

/** يقيّد الأعمدة المطلوبة بالمسموح (وبترتيب الطلب)؛ الفارغ = الافتراضية */
export const pickColumns = (
  auth: AuthContext,
  m: ReportManifest,
  wanted: string[] | undefined,
): ReportColumn[] => {
  const allowed = allowedColumns(auth, m);
  if (!wanted?.length) return allowed.filter((c) => !c.optional);
  const byKey = new Map(allowed.map((c) => [c.key, c]));
  const picked = wanted.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  if (!picked.length) throw new AppError('VALIDATION_ERROR', 400, 'لا أعمدة صالحة في الطلب');
  return picked;
};

const baseQuery = (def: ReportDef, auth: AuthContext, f: Filters) =>
  def.query(auth, employeeScope(auth, def.manifest.permission), f);

export const countRows = async (
  ctx: Ctx,
  auth: AuthContext,
  def: ReportDef,
  f: Filters,
): Promise<number> => {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from (${baseQuery(def, auth, f)}) r`.execute(ctx.trx);
  return rows[0]?.n ?? 0;
};

export const fetchPage = async (
  ctx: Ctx,
  auth: AuthContext,
  def: ReportDef,
  f: Filters,
  cols: ReportColumn[],
  limit: number,
  offset: number,
): Promise<Row[]> => {
  const { rows } = await sql<Row>`
    select * from (${baseQuery(def, auth, f)}) r
     order by ${sql.raw(def.orderBy)} limit ${limit} offset ${offset}`.execute(ctx.trx);
  return rows.map((r) => shape(cols, r));
};

/**
 * يمرّ على كل الصفوف على دفعات عبر مؤشر خادم (cursor) داخل معاملة الطلب:
 * الاستعلام يُنفَّذ والفرز مرة واحدة (لا إعادة تنفيذ لكل دفعة كما في OFFSET فيتربّع الزمن).
 */
export const iterateRows = async function* (
  ctx: Ctx,
  auth: AuthContext,
  def: ReportDef,
  f: Filters,
  cols: ReportColumn[],
  batch = 1000,
): AsyncGenerator<Row[]> {
  const name = sql.id(`rep_${randomUUID().replace(/-/g, '')}`);
  await sql`declare ${name} no scroll cursor for
    select * from (${baseQuery(def, auth, f)}) r order by ${sql.raw(def.orderBy)}`.execute(ctx.trx);
  try {
    for (;;) {
      const { rows } = await sql<Row>`fetch forward ${sql.lit(batch)} from ${name}`.execute(
        ctx.trx,
      );
      if (rows.length) yield rows.map((r) => shape(cols, r));
      if (rows.length < batch) return;
    }
  } finally {
    await sql`close ${name}`.execute(ctx.trx);
  }
};
