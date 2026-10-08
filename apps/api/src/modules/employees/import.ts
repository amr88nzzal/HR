import { sql } from 'kysely';
import { z } from 'zod';
import readXlsxFile from 'read-excel-file/node';
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  employeeInput,
  mapHeaders,
  normalizeRefValue,
  parseEmploymentType,
  parseGender,
  parseImportDate,
  parseMarital,
  type ImportReport,
  type ImportRowResult,
} from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { checkRef, loadSystem } from './external.routes.js';
import { applyChange } from './employments.routes.js';
import { derive, insertEmployee } from './employees.routes.js';
import { nextEmployeeNo } from './numbering.js';

type Cell = unknown;
type Parsed = { rows: { row: number; cells: Map<string, Cell> }[]; unknown: string[] };

const COLUMN_AR = new Map(IMPORT_COLUMNS.map((c) => [c.key, c.ar]));
const invalid = (msg: string) => new AppError('INVALID_FILE', 400, msg);

const isBlank = (v: Cell) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** يقرأ أول ورقة من ملف xlsx ويحوّلها إلى صفوف بمفاتيح الأعمدة المعروفة. */
export const parseWorkbook = async (buffer: Buffer): Promise<Parsed> => {
  let sheets: { sheet: string; data: Cell[][] }[];
  try {
    sheets = (await readXlsxFile(buffer)) as unknown as { sheet: string; data: Cell[][] }[];
  } catch {
    throw invalid('الملف ليس ملف Excel (xlsx) صالحاً');
  }
  const data = sheets[0]?.data ?? [];
  const header = data[0];
  if (!header || header.every(isBlank)) throw invalid('الملف فارغ أو بلا ترويسة');
  const { keys, unknown, missing } = mapHeaders(header);
  if (missing.length)
    throw invalid(`أعمدة مطلوبة غير موجودة: ${missing.map((k) => COLUMN_AR.get(k)).join('، ')}`);
  const body = data.slice(1);
  const rows = body.flatMap((cells, i) => {
    if (cells.every(isBlank)) return [];
    const map = new Map<string, Cell>();
    keys.forEach((k, idx) => {
      if (k && !isBlank(cells[idx])) map.set(k, cells[idx]);
    });
    return [{ row: i + 2, cells: map }];
  });
  if (rows.length > IMPORT_MAX_ROWS)
    throw new AppError(
      'IMPORT_TOO_LARGE',
      413,
      `الحد الأقصى ${IMPORT_MAX_ROWS} صف في المرة الواحدة (الملف فيه ${rows.length})`,
    );
  return { rows, unknown };
};

type Lookups = {
  branches: Map<string, string>;
  departments: Map<string, string>;
  jobTitles: Map<string, string>;
};
const codeKey = (v: string) => normalizeRefValue(v).toUpperCase();

const loadLookups = async (ctx: Ctx): Promise<Lookups> => {
  const byCode = async (table: 'branches' | 'departments' | 'jobTitles') =>
    new Map(
      (
        await ctx.trx
          .selectFrom(table)
          .select(['id', 'code'])
          .where('companyId', '=', ctx.companyId)
          .execute()
      ).map((r) => [codeKey(r.code), r.id]),
    );
  return {
    branches: await byCode('branches'),
    departments: await byCode('departments'),
    jobTitles: await byCode('jobTitles'),
  };
};

const text = (v: Cell): string => {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

const errorMessage = (err: unknown): string => {
  if (err instanceof AppError) return err.message;
  const code = (err as { code?: string }).code;
  if (code === '23P01' || code === '23505')
    return 'تعارض مع بيانات موجودة (قيمة مكررة أو فترة متداخلة)';
  if (code === '23503') return 'مرجع غير موجود';
  return err instanceof Error ? err.message : 'خطأ غير متوقع';
};

type Opts = { canSetNumber: boolean };

const processRow = async (
  ctx: Ctx,
  look: Lookups,
  opts: Opts,
  cells: Map<string, Cell>,
  result: ImportRowResult,
): Promise<void> => {
  const get = (k: string) => cells.get(k);
  const str = (k: string) => text(get(k));
  const errors = result.errors;
  const col = (k: string) => COLUMN_AR.get(k) ?? k;

  // ---- القيم الشخصية
  const input: Record<string, unknown> = {};
  for (const k of [
    'firstNameAr',
    'fatherNameAr',
    'grandfatherNameAr',
    'familyNameAr',
    'firstNameEn',
    'fatherNameEn',
    'grandfatherNameEn',
    'familyNameEn',
  ]) {
    if (str(k)) input[k] = str(k);
  }
  for (const k of ['birthDate', 'firstHireDate'] as const) {
    if (isBlank(get(k))) continue;
    const d = parseImportDate(get(k));
    if (d) input[k] = d;
    else errors.push(`${col(k)}: تاريخ غير صالح (استخدم خلية تاريخ أو YYYY-MM-DD)`);
  }
  if (str('gender')) {
    const g = parseGender(str('gender'));
    if (g) input['gender'] = g;
    else errors.push(`${col('gender')}: قيمة غير معروفة «${str('gender')}»`);
  }
  if (str('maritalStatus')) {
    const m = parseMarital(str('maritalStatus'));
    if (m) input['maritalStatus'] = m;
    else errors.push(`${col('maritalStatus')}: قيمة غير معروفة «${str('maritalStatus')}»`);
  }
  if (str('nationality')) input['nationality'] = str('nationality').toUpperCase();

  const wantedNo = normalizeRefValue(str('employeeNo'));
  const existing = wantedNo
    ? await ctx.trx
        .selectFrom('employees')
        .select([
          'id',
          'employeeNo',
          'firstNameAr',
          'fatherNameAr',
          'grandfatherNameAr',
          'familyNameAr',
          'firstNameEn',
          'fatherNameEn',
          'grandfatherNameEn',
          'familyNameEn',
          'firstHireDate',
        ])
        .where('companyId', '=', ctx.companyId)
        .where('employeeNo', '=', wantedNo)
        .executeTakeFirst()
    : undefined;

  // ---- التحقق بمخطط الإنشاء المشترك (أو الجزئي عند التحديث)
  const schema = existing ? employeeInput.omit({ employeeNo: true }).partial() : employeeInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors.push(`${col(String(issue.path[0] ?? ''))}: ${issue.message}`);
  }
  if (!existing && wantedNo && !opts.canSetNumber)
    errors.push(`${col('employeeNo')}: لا تملك صلاحية تحديد الرقم الوظيفي يدوياً`);
  if (!existing && wantedNo && !/^[A-Za-z0-9_\-/.]{1,40}$/.test(wantedNo))
    errors.push(`${col('employeeNo')}: صيغة غير صالحة`);

  // ---- التعيين
  const branchCode = str('branchCode');
  const departmentCode = str('departmentCode');
  const titleCode = str('jobTitleCode');
  const wantsEmployment = !!(branchCode || departmentCode || titleCode || str('hireDate'));
  let employment: {
    branchId: string;
    departmentId: string;
    jobTitleId?: string;
    employmentType: 'full_time' | 'part_time' | 'temporary' | 'contractor';
    effectiveDate: string;
  } | null = null;
  const branchId = branchCode ? look.branches.get(codeKey(branchCode)) : undefined;
  if (branchCode && !branchId) errors.push(`${col('branchCode')}: الفرع «${branchCode}» غير موجود`);
  if (wantsEmployment) {
    const departmentId = departmentCode ? look.departments.get(codeKey(departmentCode)) : undefined;
    const jobTitleId = titleCode ? look.jobTitles.get(codeKey(titleCode)) : undefined;
    if (departmentCode && !departmentId)
      errors.push(`${col('departmentCode')}: القسم «${departmentCode}» غير موجود`);
    if (titleCode && !jobTitleId)
      errors.push(`${col('jobTitleCode')}: المسمى «${titleCode}» غير موجود`);
    if (!branchCode || !departmentCode)
      errors.push('بيانات التعيين تتطلب رمز الفرع ورمز القسم معاً');
    const hire = isBlank(get('hireDate'))
      ? ((input['firstHireDate'] as string | undefined) ?? null)
      : parseImportDate(get('hireDate'));
    if (isBlank(get('hireDate')) === false && !hire)
      errors.push(`${col('hireDate')}: تاريخ غير صالح (استخدم خلية تاريخ أو YYYY-MM-DD)`);
    if (!hire && !errors.length) errors.push('بيانات التعيين تتطلب تاريخ التعيين');
    let type: 'full_time' | 'part_time' | 'temporary' | 'contractor' = 'full_time';
    if (str('employmentType')) {
      const t = parseEmploymentType(str('employmentType'));
      if (t) type = t;
      else errors.push(`${col('employmentType')}: قيمة غير معروفة «${str('employmentType')}»`);
    }
    if (branchId && departmentId && hire)
      employment = {
        branchId,
        departmentId,
        ...(jobTitleId ? { jobTitleId } : {}),
        employmentType: type,
        effectiveDate: hire,
      };
  }

  // ---- جهات الاتصال والمراجع
  const mobile = str('mobile');
  const email = str('email');
  if (email && !z.string().email().max(120).safeParse(email).success)
    errors.push(`${col('email')}: بريد غير صالح`);
  if (mobile.length > 120) errors.push(`${col('mobile')}: طويل جداً`);
  if (str('deviceCode') && !branchId && !branchCode) errors.push('كود جهاز البصمة يتطلب رمز الفرع');

  result.name = existing
    ? [existing.firstNameAr, existing.familyNameAr].filter(Boolean).join(' ')
    : [input['firstNameAr'], input['familyNameAr']].filter(Boolean).join(' ');
  if (errors.length || !parsed.success) return;

  // ---- التنفيذ
  let employeeId: string;
  if (existing) {
    employeeId = existing.id;
    result.action = 'update';
    result.employeeNo = existing.employeeNo;
    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(changes).length) {
      const merged = { ...existing, ...changes } as typeof existing;
      await ctx.trx
        .updateTable('employees')
        .set({
          ...changes,
          ...derive(merged, existing.employeeNo),
          version: sql<number>`version + 1`,
        })
        .where('id', '=', existing.id)
        .execute();
    }
  } else {
    const employeeNo = wantedNo || (await nextEmployeeNo(ctx));
    const row = await insertEmployee(
      ctx,
      { ...(parsed.data as z.infer<typeof employeeInput>) },
      employeeNo,
      {},
    );
    employeeId = row.id;
    result.action = 'create';
    result.employeeNo = employeeNo;
  }

  if (employment) {
    const has = await ctx.trx
      .selectFrom('employments')
      .select('id')
      .where('employeeId', '=', employeeId)
      .limit(1)
      .executeTakeFirst();
    if (has)
      result.warnings.push(
        'تُجوهلت بيانات التعيين: الموظف معيَّن بالفعل (استخدم النقل أو الترقية)',
      );
    else {
      const { effectiveDate, ...fields } = employment;
      await applyChange(ctx, employeeId, {
        changeType: 'hire',
        effectiveDate,
        employment: fields,
      });
    }
  }

  for (const [type, value] of [
    ['mobile', mobile],
    ['email', email],
  ] as const) {
    if (!value) continue;
    const dup = await ctx.trx
      .selectFrom('employeeContacts')
      .select('id')
      .where('employeeId', '=', employeeId)
      .where('type', '=', type)
      .where('value', '=', value)
      .executeTakeFirst();
    if (dup) continue;
    const hasPrimary = await ctx.trx
      .selectFrom('employeeContacts')
      .select('id')
      .where('employeeId', '=', employeeId)
      .where('type', '=', type)
      .where('isPrimary', '=', true)
      .executeTakeFirst();
    await ctx.trx
      .insertInto('employeeContacts')
      .values({
        companyId: ctx.companyId,
        employeeId,
        type,
        value,
        contactName: null,
        relation: null,
        isPrimary: !hasPrimary,
      })
      .execute();
    if (hasPrimary) result.warnings.push(`أُضيف ${col(type)} كجهة غير أساسية (توجد جهة أساسية)`);
  }

  for (const [systemKey, raw, refBranch] of [
    ['accounting', str('accountingNo'), null],
    ['attendance_device', str('deviceCode'), branchId ?? null],
  ] as const) {
    if (!raw) continue;
    const system = await ctx.trx
      .selectFrom('externalSystems')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('key', '=', systemKey)
      .executeTakeFirst();
    if (!system) throw new AppError('NOT_FOUND', 404, `النظام الخارجي «${systemKey}» غير معرّف`);
    const sys = await loadSystem(ctx, system.id);
    const { value, branchId: refBranchId } = await checkRef(ctx, sys, raw, refBranch);
    const same = await ctx.trx
      .selectFrom('employeeExternalRefs')
      .select('id')
      .where('employeeId', '=', employeeId)
      .where('systemId', '=', sys.id)
      .where('value', '=', value)
      .executeTakeFirst();
    if (same) continue;
    const others = await ctx.trx
      .selectFrom('employeeExternalRefs')
      .select('id')
      .where('employeeId', '=', employeeId)
      .where('systemId', '=', sys.id)
      .where('isPrimary', '=', true)
      .executeTakeFirst();
    await ctx.trx
      .insertInto('employeeExternalRefs')
      .values({
        companyId: ctx.companyId,
        employeeId,
        systemId: sys.id,
        value,
        branchId: refBranchId,
        validFrom: null,
        validTo: null,
        isPrimary: !others,
        enforceUnique: sys.isUnique,
        notes: null,
      })
      .execute();
    if (others) result.warnings.push(`${systemKey}: أُضيف مرجع غير أساسي (يوجد مرجع أساسي)`);
  }
};

/**
 * ينفّذ الاستيراد صفاً صفاً، كل صف داخل SAVEPOINT: الخطأ يعيد الصف وحده ويُسجَّل.
 * يُستدعى داخل معاملة المستأجر؛ القرار بالإبقاء أو التراجع للمستدعي (انظر import.routes).
 */
export const runImport = async (
  ctx: Ctx,
  buffer: Buffer,
  opts: Opts & { dryRun: boolean },
): Promise<ImportReport> => {
  const { rows, unknown } = await parseWorkbook(buffer);
  const look = await loadLookups(ctx);

  const seenNo = new Map<string, number>();
  for (const r of rows) {
    const no = normalizeRefValue(text(r.cells.get('employeeNo')));
    if (no) seenNo.set(no, (seenNo.get(no) ?? 0) + 1);
  }

  const results: ImportRowResult[] = [];
  for (const r of rows) {
    const result: ImportRowResult = {
      row: r.row,
      action: 'error',
      employeeNo: null,
      name: '',
      errors: [],
      warnings: [],
    };
    const no = normalizeRefValue(text(r.cells.get('employeeNo')));
    if (no && (seenNo.get(no) ?? 0) > 1) result.errors.push(`الرقم الوظيفي «${no}» مكرر في الملف`);
    else {
      await sql`savepoint import_row`.execute(ctx.trx);
      try {
        await processRow(ctx, look, opts, r.cells, result);
        if (result.errors.length) await sql`rollback to savepoint import_row`.execute(ctx.trx);
      } catch (err) {
        await sql`rollback to savepoint import_row`.execute(ctx.trx);
        result.errors.push(errorMessage(err));
      }
      await sql`release savepoint import_row`.execute(ctx.trx);
    }
    if (result.errors.length) {
      result.action = 'error';
      result.employeeNo = result.employeeNo ?? (no || null);
    }
    results.push(result);
  }

  const norm = (a: ImportRowResult['action']) => results.filter((x) => x.action === a).length;
  return {
    dryRun: opts.dryRun,
    total: results.length,
    created: norm('create'),
    updated: norm('update'),
    failed: norm('error'),
    committed: false,
    unknownColumns: unknown,
    rows: results,
  };
};
