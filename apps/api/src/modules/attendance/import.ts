import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { normalizeRefValue } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { companyTimezone, recomputeDays } from './days.js';
import {
  DEFAULT_PROFILE,
  parseCsv,
  type ParseError,
  type ParseProfile,
  type ParsedRow,
} from './import-parse.js';
import { addDays, localParts, localToUtc } from './time.js';

export const IMPORT_MAX_ROWS = 50_000;
export const IMPORT_MAX_BYTES = 12 * 1024 * 1024;

export type LoadedProfile = ParseProfile & { id: string | null; code: string; systemKey: string };

const toProfile = (r: {
  id: string;
  code: string;
  delimiter: string;
  encoding: ParseProfile['encoding'];
  hasHeader: ParseProfile['hasHeader'];
  columns: Record<string, number | string | null>;
  dateOrder: ParseProfile['dateOrder'];
  directionMode: ParseProfile['directionMode'];
  inValues: string[];
  outValues: string[];
  systemKey: string;
}): LoadedProfile => ({
  id: r.id,
  code: r.code,
  delimiter: r.delimiter,
  encoding: r.encoding,
  hasHeader: r.hasHeader,
  columns: {
    branch: r.columns['branch'] ?? null,
    department: r.columns['department'] ?? null,
    employee: r.columns['employee'] ?? 2,
    datetime: r.columns['datetime'] ?? 3,
    type: r.columns['type'] ?? null,
  },
  dateOrder: r.dateOrder,
  directionMode: r.directionMode,
  inValues: r.inValues,
  outValues: r.outValues,
  systemKey: r.systemKey,
});

/** الملف المطلوب، أو الافتراضي للشركة، أو الصيغة المبدئية المدمجة. */
export const loadProfile = async (ctx: Ctx, profileId?: string): Promise<LoadedProfile> => {
  let q = ctx.trx.selectFrom('importProfiles').selectAll().where('companyId', '=', ctx.companyId);
  q = profileId
    ? q.where('id', '=', profileId)
    : q.where('isDefault', '=', true).where('isActive', '=', true);
  const row = await q.executeTakeFirst();
  if (profileId && !row) throw new AppError('NOT_FOUND', 404, 'ملف الاستيراد غير موجود');
  if (!row)
    return { ...DEFAULT_PROFILE, id: null, code: 'BUILTIN', systemKey: 'attendance_device' };
  if (!row.isActive) throw new AppError('INACTIVE', 409, 'ملف الاستيراد معطّل');
  return toProfile(row);
};

type Ref = {
  value: string;
  employeeId: string;
  branchCode: string | null;
  validFrom: string | null;
  validTo: string | null;
};

type Matched = { row: ParsedRow; employeeId: string; at: Date };
type HeldItem = { row: ParsedRow; at: Date; reason: 'unmatched' | 'ambiguous' };

export type Analysis = {
  fileHash: string;
  encoding: 'utf-8' | 'windows-1256';
  hasHeader: boolean;
  total: number;
  errors: ParseError[];
  toInsert: Matched[];
  held: HeldItem[];
  duplicatesInFile: number;
  alreadyExisting: number;
  employees: Set<string>;
  dateFrom: string | null;
  dateTo: string | null;
  alreadyImportedBatchId: string | null;
};

/** يحلل الملف ويطابق الموظفين ويكشف المكرر، دون أي كتابة (يُستعمل للمعاينة وللتنفيذ). */
export const analyzeFile = async (
  ctx: Ctx,
  buf: Buffer,
  profile: LoadedProfile,
): Promise<Analysis> => {
  const fileHash = createHash('sha256').update(buf).update(profile.code).digest('hex');
  let parsed;
  try {
    parsed = parseCsv(buf, profile);
  } catch (err) {
    throw new AppError('INVALID_FILE', 400, (err as Error).message);
  }
  if (parsed.total > IMPORT_MAX_ROWS)
    throw new AppError('TOO_MANY_ROWS', 400, `الحد الأقصى ${IMPORT_MAX_ROWS} سطر في الملف الواحد`);

  const prior = await ctx.trx
    .selectFrom('importBatches')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('fileHash', '=', fileHash)
    .where('status', '=', 'applied')
    .executeTakeFirst();

  const tz = await companyTimezone(ctx);
  const codes = [...new Set(parsed.rows.map((r) => r.employee))];
  const refs: Ref[] =
    codes.length === 0
      ? []
      : (
          await sql<Ref>`
            select r.value, r.employee_id as employee_id, b.code as branch_code,
                   r.valid_from::text as valid_from, r.valid_to::text as valid_to
              from employee_external_refs r
              join external_systems s on s.id = r.system_id and s.key = ${profile.systemKey}
              left join branches b on b.id = r.branch_id
             where r.company_id = ${ctx.companyId}
               and r.value in (${sql.join(codes)})`.execute(ctx.trx)
        ).rows;
  const byCode = new Map<string, Ref[]>();
  for (const r of refs) byCode.set(r.value, [...(byCode.get(r.value) ?? []), r]);

  const matched: Matched[] = [];
  const held: HeldItem[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  for (const row of parsed.rows) {
    const at = localToUtc(row.date, row.time, tz);
    let cands = (byCode.get(row.employee) ?? []).filter(
      (c) => (!c.validFrom || c.validFrom <= row.date) && (!c.validTo || c.validTo >= row.date),
    );
    if (new Set(cands.map((c) => c.employeeId)).size > 1 && row.branch) {
      const b = normalizeRefValue(row.branch).toLowerCase();
      const narrowed = cands.filter((c) => c.branchCode?.toLowerCase() === b);
      if (narrowed.length > 0) cands = narrowed;
    }
    const ids = [...new Set(cands.map((c) => c.employeeId))];
    if (ids.length === 0) held.push({ row, at, reason: 'unmatched' });
    else if (ids.length > 1) held.push({ row, at, reason: 'ambiguous' });
    else {
      const key = `${ids[0]}|${at.getTime()}`;
      if (seen.has(key)) duplicatesInFile++;
      else {
        seen.add(key);
        matched.push({ row, employeeId: ids[0] as string, at });
      }
    }
  }

  // ما وُجد مسبقاً في القاعدة
  let toInsert = matched;
  let alreadyExisting = 0;
  if (matched.length > 0) {
    const times = matched.map((m) => m.at.getTime());
    const existing = await ctx.trx
      .selectFrom('attendanceRecords')
      .select(['employeeId', 'punchedAt'])
      .where('companyId', '=', ctx.companyId)
      .where('employeeId', 'in', [...new Set(matched.map((m) => m.employeeId))])
      .where('punchedAt', '>=', new Date(Math.min(...times)))
      .where('punchedAt', '<=', new Date(Math.max(...times)))
      .execute();
    const have = new Set(existing.map((e) => `${e.employeeId}|${new Date(e.punchedAt).getTime()}`));
    toInsert = matched.filter((m) => !have.has(`${m.employeeId}|${m.at.getTime()}`));
    alreadyExisting = matched.length - toInsert.length;
  }
  const dates = toInsert.map((m) => localParts(m.at, tz).date).sort();
  return {
    fileHash,
    encoding: parsed.encoding,
    hasHeader: parsed.hasHeader,
    total: parsed.total,
    errors: parsed.errors,
    toInsert,
    held,
    duplicatesInFile,
    alreadyExisting,
    employees: new Set(toInsert.map((m) => m.employeeId)),
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    alreadyImportedBatchId: prior?.id ?? null,
  };
};

const HELD_SAMPLE = 50;

/** تقرير المعاينة/التنفيذ المعروض للمستخدم. */
export const reportOf = (a: Analysis, tz: string) => {
  const codes = new Map<string, { code: string; reason: string; count: number }>();
  for (const h of a.held) {
    const k = `${h.row.employee}|${h.reason}`;
    const cur = codes.get(k) ?? { code: h.row.employee, reason: h.reason, count: 0 };
    cur.count++;
    codes.set(k, cur);
  }
  return {
    fileHash: a.fileHash,
    encoding: a.encoding,
    hasHeader: a.hasHeader,
    alreadyImportedBatchId: a.alreadyImportedBatchId,
    total: a.total,
    toInsert: a.toInsert.length,
    duplicatesInFile: a.duplicatesInFile,
    alreadyExisting: a.alreadyExisting,
    held: a.held.length,
    heldCodes: [...codes.values()].sort((x, y) => y.count - x.count).slice(0, HELD_SAMPLE),
    errorCount: a.errors.length,
    errors: a.errors.slice(0, 100),
    employees: a.employees.size,
    dateFrom: a.dateFrom,
    dateTo: a.dateTo,
    sample: a.toInsert.slice(0, 20).map((m) => ({
      line: m.row.line,
      code: m.row.employee,
      employeeId: m.employeeId,
      date: localParts(m.at, tz).date,
      time: m.row.time,
      direction: m.row.direction,
    })),
  };
};

const CHUNK = 1000;

/** يعيد احتساب الأيام المتأثرة لمجموعة موظفين على نوافذ ≤ 60 يوماً. */
const recomputeWindow = async (
  ctx: Ctx,
  employeeIds: string[],
  from: string | null,
  to: string | null,
) => {
  if (!from || !to || employeeIds.length === 0) return;
  let a = addDays(from, -1);
  const end = addDays(to, 1);
  while (a <= end) {
    const b = addDays(a, 59) < end ? addDays(a, 59) : end;
    await recomputeDays(ctx, employeeIds, a, b);
    a = addDays(b, 1);
  }
};

const insertPunches = async (
  ctx: Ctx,
  batchId: string,
  items: { employeeId: string; at: Date; direction: 'in' | 'out' | null }[],
  userId: string | null,
): Promise<number> => {
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const res = await ctx.trx
      .insertInto('attendanceRecords')
      .values(
        items.slice(i, i + CHUNK).map((m) => ({
          companyId: ctx.companyId,
          employeeId: m.employeeId,
          punchedAt: m.at,
          direction: m.direction,
          source: 'import' as const,
          batchId,
          createdBy: userId,
        })),
      )
      .onConflict((oc) => oc.columns(['companyId', 'employeeId', 'punchedAt']).doNothing())
      .executeTakeFirst();
    inserted += Number(res.numInsertedOrUpdatedRows ?? 0);
  }
  return inserted;
};

/** يطبّق التحليل: دفعة + بصمات + محجوز + إعادة احتساب. */
export const applyImport = async (
  ctx: Ctx,
  a: Analysis,
  profile: LoadedProfile,
  fileName: string | null,
  userId: string,
) => {
  if (a.alreadyImportedBatchId)
    throw new AppError(
      'ALREADY_IMPORTED',
      409,
      'هذا الملف استُورد سابقاً (تراجع عن دفعته لإعادة استيراده)',
      {
        batchId: a.alreadyImportedBatchId,
      },
    );
  const tz = await companyTimezone(ctx);
  const batch = await ctx.trx
    .insertInto('importBatches')
    .values({
      companyId: ctx.companyId,
      profileId: profile.id,
      fileName: fileName?.slice(0, 200) ?? null,
      fileHash: a.fileHash,
      totalRows: a.total,
      errors: a.errors.length,
      employees: a.employees.size,
      dateFrom: a.dateFrom,
      dateTo: a.dateTo,
      createdBy: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const inserted = await insertPunches(
    ctx,
    batch.id,
    a.toInsert.map((m) => ({ employeeId: m.employeeId, at: m.at, direction: m.row.direction })),
    userId,
  );
  for (let i = 0; i < a.held.length; i += CHUNK)
    await ctx.trx
      .insertInto('importHeldRows')
      .values(
        a.held.slice(i, i + CHUNK).map((h) => ({
          companyId: ctx.companyId,
          batchId: batch.id,
          lineNo: h.row.line,
          deviceCode: h.row.employee,
          deviceBranch: h.row.branch,
          deviceDepartment: h.row.department,
          punchedAt: h.at,
          direction: h.row.direction,
          reason: h.reason,
        })),
      )
      .execute();
  await ctx.trx
    .updateTable('importBatches')
    .set({
      inserted,
      duplicates: a.duplicatesInFile + a.alreadyExisting + (a.toInsert.length - inserted),
      held: a.held.length,
    })
    .where('id', '=', batch.id)
    .execute();
  await recomputeWindow(ctx, [...a.employees], a.dateFrom, a.dateTo);
  return { batchId: batch.id, inserted, tz };
};

/** يربط رمز جهاز بموظف: يحفظ المرجع (اختيارياً) ويطبّق كل محجوزاته. */
export const resolveHeld = async (
  ctx: Ctx,
  userId: string,
  input: { deviceCode: string; employeeId: string; createRef: boolean; systemKey: string },
) => {
  const code = normalizeRefValue(input.deviceCode);
  const emp = await ctx.trx
    .selectFrom('employees')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', input.employeeId)
    .executeTakeFirst();
  if (!emp) throw new AppError('NOT_FOUND', 404, 'الموظف غير موجود');
  const rows = await ctx.trx
    .selectFrom('importHeldRows')
    .selectAll()
    .where('companyId', '=', ctx.companyId)
    .where('status', '=', 'held')
    .where('deviceCode', '=', code)
    .execute();
  if (rows.length === 0) throw new AppError('NOT_FOUND', 404, 'لا سجلات محجوزة بهذا الرمز');

  if (input.createRef) {
    const system = await ctx.trx
      .selectFrom('externalSystems')
      .select(['id', 'refScope'])
      .where('companyId', '=', ctx.companyId)
      .where('key', '=', input.systemKey)
      .executeTakeFirst();
    if (!system) throw new AppError('NOT_FOUND', 404, 'النظام الخارجي غير موجود');
    const has = await ctx.trx
      .selectFrom('employeeExternalRefs')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('systemId', '=', system.id)
      .where('employeeId', '=', input.employeeId)
      .where('value', '=', code)
      .executeTakeFirst();
    if (!has) {
      let branchId: string | null = null;
      if (system.refScope === 'branch') {
        const cur = await ctx.trx
          .selectFrom('employments')
          .select('branchId')
          .where('employeeId', '=', input.employeeId)
          .where(sql<boolean>`valid_to is null`)
          .executeTakeFirst();
        if (!cur) throw new AppError('NO_BRANCH', 409, 'لا فرع حالي للموظف لربط الرمز بفرعه');
        branchId = cur.branchId;
      }
      try {
        await ctx.trx
          .insertInto('employeeExternalRefs')
          .values({
            companyId: ctx.companyId,
            employeeId: input.employeeId,
            systemId: system.id,
            value: code,
            branchId,
            isPrimary: false,
            notes: 'أُنشئ من مركز استيراد الحضور',
          })
          .execute();
      } catch (err) {
        const c = (err as { code?: string }).code;
        if (c === '23P01' || c === '23505')
          throw new AppError('REF_CONFLICT', 409, 'الرمز مربوط بموظف آخر في الفترة نفسها');
        throw err;
      }
    }
  }

  const tz = await companyTimezone(ctx);
  let inserted = 0;
  const byBatch = new Map<string, typeof rows>();
  for (const r of rows) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
  for (const [batchId, list] of byBatch) {
    const n = await insertPunches(
      ctx,
      batchId,
      list.map((r) => ({
        employeeId: input.employeeId,
        at: new Date(r.punchedAt),
        direction: r.direction,
      })),
      userId,
    );
    inserted += n;
    await ctx.trx
      .updateTable('importBatches')
      .set({
        inserted: sql`inserted + ${n}`,
        held: sql`greatest(held - ${list.length}, 0)`,
      })
      .where('id', '=', batchId)
      .execute();
  }
  await ctx.trx
    .updateTable('importHeldRows')
    .set({
      status: 'resolved',
      employeeId: input.employeeId,
      resolvedBy: userId,
      resolvedAt: new Date(),
    })
    .where(
      'id',
      'in',
      rows.map((r) => r.id),
    )
    .execute();
  const dates = rows.map((r) => localParts(new Date(r.punchedAt), tz).date).sort();
  await recomputeWindow(ctx, [input.employeeId], dates[0] ?? null, dates[dates.length - 1] ?? null);
  return { resolved: rows.length, inserted, duplicates: rows.length - inserted };
};

export const discardHeld = async (ctx: Ctx, userId: string, deviceCode: string) => {
  const code = normalizeRefValue(deviceCode);
  const res = await ctx.trx
    .updateTable('importHeldRows')
    .set({ status: 'discarded', resolvedBy: userId, resolvedAt: new Date() })
    .where('companyId', '=', ctx.companyId)
    .where('status', '=', 'held')
    .where('deviceCode', '=', code)
    .executeTakeFirst();
  const n = Number(res.numUpdatedRows ?? 0);
  if (n === 0) throw new AppError('NOT_FOUND', 404, 'لا سجلات محجوزة بهذا الرمز');
  return { discarded: n };
};

/** تراجع عن دفعة: يحذف بصماتها ومحجوزاتها ويعيد احتساب أيامها. */
export const revertBatch = async (ctx: Ctx, userId: string, batchId: string) => {
  const b = await ctx.trx
    .selectFrom('importBatches')
    .select(['id', 'status', 'dateFrom', 'dateTo'])
    .where('companyId', '=', ctx.companyId)
    .where('id', '=', batchId)
    .forUpdate()
    .executeTakeFirst();
  if (!b) throw new AppError('NOT_FOUND', 404, 'الدفعة غير موجودة');
  if (b.status === 'reverted') throw new AppError('ALREADY_REVERTED', 409, 'الدفعة متراجَع عنها');
  const recs = await ctx.trx
    .selectFrom('attendanceRecords')
    .select(['employeeId', 'punchedAt'])
    .where('batchId', '=', batchId)
    .execute();
  const tz = await companyTimezone(ctx);
  const dates = recs.map((r) => localParts(new Date(r.punchedAt), tz).date).sort();
  const employees = [...new Set(recs.map((r) => r.employeeId))];
  await ctx.trx.deleteFrom('attendanceRecords').where('batchId', '=', batchId).execute();
  await ctx.trx.deleteFrom('importHeldRows').where('batchId', '=', batchId).execute();
  await ctx.trx
    .updateTable('importBatches')
    .set({ status: 'reverted', revertedAt: new Date(), revertedBy: userId })
    .where('id', '=', batchId)
    .execute();
  await recomputeWindow(ctx, employees, dates[0] ?? null, dates[dates.length - 1] ?? null);
  return { removed: recs.length };
};
