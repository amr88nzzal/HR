import { Router, type Request, type RequestHandler } from 'express';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import {
  employeeAccountInput,
  bulkAccountInput,
  type BulkAccountStatus,
  employeeInput,
  employeeListQuery,
  employeeUpdateInput,
  normalizeRefValue,
  normalizeSearch,
  revealFieldInput,
  type ApiEnvelope,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { hasPermission, requirePermission, type AuthContext } from '../identity/index.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import { employeeScope } from './access.js';
import {
  accountOf,
  checkAccountCreation,
  createEmployeeAccount,
  resendInvite,
  type AccountDeps,
} from './accounts.js';
import {
  decryptCustomField,
  prepareCustomFields,
  withMaskedCustomFields,
} from './custom-fields.js';
import { nextEmployeeNo } from './numbering.js';

type Row = Record<string, unknown>;
const notFound = () => new AppError('NOT_FOUND', 404, 'الموظف غير موجود');
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};

const COLUMNS = [
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
  'fullNameAr',
  'fullNameEn',
  'birthDate',
  'gender',
  'maritalStatus',
  'nationality',
  'photoFileId',
  'status',
  'firstHireDate',
  'userId',
  'customFields',
  'version',
  'createdAt',
  'updatedAt',
] as const;

type NameParts = {
  firstNameAr: string;
  fatherNameAr?: string | null;
  grandfatherNameAr?: string | null;
  familyNameAr: string;
  firstNameEn?: string | null;
  fatherNameEn?: string | null;
  grandfatherNameEn?: string | null;
  familyNameEn?: string | null;
};
const join = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(' ');

/** الأسماء الكاملة ونص البحث المطبَّع (يشمل الرقم الوظيفي). */
export const derive = (n: NameParts, employeeNo: string) => {
  const fullNameAr = join(n.firstNameAr, n.fatherNameAr, n.grandfatherNameAr, n.familyNameAr);
  const en = join(n.firstNameEn, n.fatherNameEn, n.grandfatherNameEn, n.familyNameEn);
  return {
    fullNameAr,
    fullNameEn: en || null,
    searchText: normalizeSearch(`${employeeNo} ${fullNameAr} ${en}`),
  };
};

/** يُدرج موظفاً جديداً (يُستخدم من الإنشاء المباشر والاستيراد). */
export const insertEmployee = (
  ctx: Ctx,
  input: z.infer<typeof employeeInput>,
  employeeNo: string,
  customFields: Record<string, unknown>,
) =>
  ctx.trx
    .insertInto('employees')
    .values({
      companyId: ctx.companyId,
      employeeNo,
      firstNameAr: input.firstNameAr,
      fatherNameAr: input.fatherNameAr ?? null,
      grandfatherNameAr: input.grandfatherNameAr ?? null,
      familyNameAr: input.familyNameAr,
      firstNameEn: input.firstNameEn ?? null,
      fatherNameEn: input.fatherNameEn ?? null,
      grandfatherNameEn: input.grandfatherNameEn ?? null,
      familyNameEn: input.familyNameEn ?? null,
      birthDate: input.birthDate ?? null,
      gender: input.gender ?? null,
      maritalStatus: input.maritalStatus ?? null,
      nationality: input.nationality ?? null,
      firstHireDate: input.firstHireDate ?? null,
      photoFileId: null,
      userId: null,
      customFields: JSON.stringify(customFields),
      ...derive(input, employeeNo),
    })
    .returning([...COLUMNS])
    .executeTakeFirstOrThrow();

/** تعيين الموظف الحالي بتاريخ اليوم بتوقيت الشركة */
const currentEmployment = (extra: RawBuilder<boolean>): RawBuilder<boolean> =>
  sql<boolean>`exists (
    select 1 from employments cur
     where cur.employee_id = employees.id
       and cur.valid_from <= company_today(employees.company_id)
       and (cur.valid_to is null or cur.valid_to >= company_today(employees.company_id))
       and ${extra})`;
const currentValue = (column: string) =>
  sql<string | null>`(
    select ${sql.ref(`cur.${column}`)} from employments cur
     where cur.employee_id = employees.id
       and cur.valid_from <= company_today(employees.company_id)
       and (cur.valid_to is null or cur.valid_to >= company_today(employees.company_id))
     limit 1)`;

/** حالة حساب الموظف (none/invited/active/disabled) كتعبير SQL يُعاد استعماله في الفلتر والفرز والعرض. */
const accountState = sql<string>`case
  when employees.user_id is null then 'none'
  else coalesce((select case when u.status = 'disabled' then 'disabled'
                             when u.last_login_at is null and u.must_change_password then 'invited' else 'active' end
                   from users u where u.id = employees.user_id), 'none') end`;
/** اسم الفرع/القسم/المسمى الحالي للفرز الأبجدي */
const currentName = (table: 'branches' | 'departments' | 'job_titles', column: string) =>
  sql<
    string | null
  >`(select t.name_ar from ${sql.table(table)} t where t.id = ${currentValue(column)})`;

const audit = (ctx: Ctx, entityId: string, action: string, changes: unknown) =>
  ctx.trx
    .insertInto('auditLogs')
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      entityType: 'employees',
      entityId,
      action,
      changes: JSON.stringify(changes),
      requestId: ctx.requestId,
      ip: null,
    })
    .execute();

export const createEmployeesRouter = (
  db: Db,
  authenticate: RequestHandler,
  crypto: FieldCrypto | undefined,
  accountDeps: AccountDeps,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>) => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

  const loadVisible = async (ctx: Ctx, auth: AuthContext, id: string, code: string) => {
    const scope = employeeScope(auth, code);
    let q = ctx.trx
      .selectFrom('employees')
      .select([...COLUMNS])
      .where('id', '=', id);
    if (scope) q = q.where(scope);
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    return row;
  };

  router.get('/', requirePermission('employees.employee.read'), async (req, res, next) => {
    try {
      const query = employeeListQuery.parse(req.query);
      const out = await run(req, async (ctx, auth) => {
        const scope = employeeScope(auth, 'employees.employee.read');
        const words = query.q ? query.q.split(/\s+/).filter(Boolean) : [];
        const tokens = query.q ? normalizeSearch(query.q).split(' ').filter(Boolean) : [];
        const build = () => {
          let b = ctx.trx.selectFrom('employees');
          if (scope) b = b.where(scope);
          if (query.status?.length) b = b.where('status', 'in', query.status);
          if (query.branchId?.length)
            b = b.where(
              currentEmployment(sql<boolean>`cur.branch_id = any(${query.branchId}::uuid[])`),
            );
          if (query.departmentId?.length)
            b = b.where(
              currentEmployment(
                sql<boolean>`cur.department_id = any(${query.departmentId}::uuid[])`,
              ),
            );
          if (query.jobTitleId?.length)
            b = b.where(
              currentEmployment(sql<boolean>`cur.job_title_id = any(${query.jobTitleId}::uuid[])`),
            );
          if (query.account?.length)
            b = b.where(sql<boolean>`${accountState} = any(${query.account}::text[])`);
          // كل كلمة بحث: تطابق الاسم/الرقم الوظيفي أو بداية قيمة مرجع خارجي (رقم محاسبة، كود بصمة…)
          tokens.forEach((t, i) => {
            const esc = (v: string) => v.replace(/[%_\\]/g, '\\$&');
            const ref = esc(normalizeRefValue(words[i] ?? t));
            b = b.where(
              sql<boolean>`(employees.search_text like ${`%${esc(t)}%`}
                or exists (select 1 from employee_external_refs r
                            where r.employee_id = employees.id and r.value ilike ${`${ref}%`}))`,
            );
          });
          return b;
        };
        const sortKey = query.sort.replace(/^-/, '');
        const sortExpr = {
          employeeNo: sql`employees.employee_no`,
          name: sql`employees.full_name_ar`,
          createdAt: sql`employees.created_at`,
          status: sql`employees.status`,
          account: accountState,
          branch: currentName('branches', 'branch_id'),
          department: currentName('departments', 'department_id'),
          jobTitle: currentName('job_titles', 'job_title_id'),
        }[sortKey as 'employeeNo'];
        const rows = await build()
          .select([...COLUMNS])
          .select([
            currentValue('branch_id').as('currentBranchId'),
            currentValue('department_id').as('currentDepartmentId'),
            currentValue('job_title_id').as('currentJobTitleId'),
            currentValue('manager_employee_id').as('currentManagerEmployeeId'),
            accountState.as('accountStatus'),
          ])
          .orderBy(sortExpr, query.sort.startsWith('-') ? 'desc' : 'asc')
          .orderBy('id')
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize)
          .execute();
        const total = Number(
          (
            await build()
              .select(sql<string>`count(*)`.as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        return { rows, total };
      });
      const body: ApiEnvelope<Row[]> = {
        data: out.rows.map(withMaskedCustomFields),
        meta: { page: query.page, pageSize: query.pageSize, total: out.total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission('employees.employee.read'), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      res.json({
        data: withMaskedCustomFields(
          await run(req, (ctx, auth) => loadVisible(ctx, auth, id, 'employees.employee.read')),
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('employees.employee.create'), async (req, res, next) => {
    try {
      const input = employeeInput.parse(req.body);
      const account = z
        .object({ account: employeeAccountInput.optional() })
        .parse(req.body).account;
      const data = await run(req, async (ctx, auth) => {
        if (account && !hasPermission(auth, 'identity.user.create_from_employee')) {
          throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية إنشاء حسابات المستخدمين', {
            required: 'identity.user.create_from_employee',
          });
        }
        if (input.employeeNo && !hasPermission(auth, 'employees.employee.set_number')) {
          throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية تحديد الرقم الوظيفي يدوياً', {
            required: 'employees.employee.set_number',
          });
        }
        const employeeNo = input.employeeNo ?? (await nextEmployeeNo(ctx));
        const customFields = await prepareCustomFields(ctx, crypto, input.customFields, {});
        const row = await insertEmployee(ctx, input, employeeNo, customFields);
        // الحساب في المعاملة نفسها: فشله (بريد مكرر…) يلغي إنشاء الموظف كاملاً
        const created = account
          ? await createEmployeeAccount(
              ctx,
              accountDeps,
              { id: row.id, fullNameAr: row.fullNameAr, userId: null },
              account,
            )
          : null;
        return { row, account: created };
      });
      res.status(201).json({
        data: withMaskedCustomFields(data.row),
        ...(data.account ? { meta: { account: data.account } } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission('employees.employee.update'), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const {
        version,
        customFields: incomingCustom,
        ...changes
      } = employeeUpdateInput.parse(req.body);
      const data = await run(req, async (ctx, auth) => {
        const current = await loadVisible(ctx, auth, id, 'employees.employee.update');
        const customPatch =
          incomingCustom === undefined
            ? {}
            : {
                customFields: JSON.stringify(
                  await prepareCustomFields(ctx, crypto, incomingCustom, current.customFields),
                ),
              };
        const merged = {
          ...current,
          ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
        } as NameParts & { employeeNo: string };
        const row = await ctx.trx
          .updateTable('employees')
          .set({
            ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
            ...derive(merged, current.employeeNo),
            ...customPatch,
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .where('version', '=', version)
          .returning([...COLUMNS])
          .executeTakeFirst();
        if (!row)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        return row;
      });
      res.json({ data: withMaskedCustomFields(data) });
    } catch (err) {
      next(err);
    }
  });

  // كشف قيمة حقل مخصص حساس: صلاحية مستقلة ويُسجَّل في التدقيق دائماً
  router.post(
    '/:id/reveal',
    requirePermission('employees.custom_field.reveal'),
    async (req, res, next) => {
      try {
        const id = idOf(req.params['id']);
        const { key } = revealFieldInput.parse(req.body);
        if (!crypto)
          throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
        const value = await run(req, async (ctx, auth) => {
          const row = await loadVisible(ctx, auth, id, 'employees.custom_field.reveal');
          const plain = decryptCustomField(crypto, row.customFields, key);
          await audit(ctx, id, 'reveal', { field: key });
          return plain;
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ data: { key, value } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:id', requirePermission('employees.employee.delete'), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx, auth) => {
        await loadVisible(ctx, auth, id, 'employees.employee.delete');
        try {
          await ctx.trx.deleteFrom('employees').where('id', '=', id).execute();
        } catch (err) {
          if ((err as { code?: string }).code === '23503') {
            throw new AppError(
              'IN_USE',
              409,
              'لا يمكن حذف موظف له سجلات مرتبطة، أنهِ خدمته بدلاً من ذلك',
            );
          }
          throw err;
        }
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ربط الموظف بحساب مستخدم موجود (أو فكّ الربط)
  router.put(
    '/:id/user',
    requirePermission('employees.employee.update'),
    async (req, res, next) => {
      try {
        const id = idOf(req.params['id']);
        const { userId } = z.object({ userId: z.string().uuid().nullable() }).parse(req.body);
        const data = await run(req, async (ctx, auth) => {
          await loadVisible(ctx, auth, id, 'employees.employee.update');
          if (userId) {
            const u = await ctx.trx
              .selectFrom('users')
              .select('id')
              .where('id', '=', userId)
              .executeTakeFirst();
            if (!u) throw new AppError('INVALID_REFERENCE', 400, 'المستخدم غير موجود');
          }
          try {
            return await ctx.trx
              .updateTable('employees')
              .set({ userId, version: sql`version + 1` })
              .where('id', '=', id)
              .returning([...COLUMNS])
              .executeTakeFirstOrThrow();
          } catch (e) {
            if ((e as { code?: string }).code === '23505')
              throw new AppError('USER_ALREADY_LINKED', 409, 'هذا المستخدم مرتبط بموظف آخر');
            throw e;
          }
        });
        res.json({ data: withMaskedCustomFields(data) });
      } catch (err) {
        next(err);
      }
    },
  );

  // حساب المستخدم للموظف: الحالة، إنشاء (دعوة/مؤقت)، إعادة إرسال الدعوة
  router.get(
    '/:id/account',
    requirePermission('employees.employee.read'),
    requirePermission('identity.user.read'),
    async (req, res, next) => {
      try {
        const id = idOf(req.params['id']);
        const data = await run(req, async (ctx, auth) => {
          await loadVisible(ctx, auth, id, 'employees.employee.read');
          return accountOf(ctx, id);
        });
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  // إنشاء حسابات بالجملة (دعوة بالبريد) لموظفين محدّدين: معاينة أو تنفيذ، كل موظف داخل SAVEPOINT
  // Bulk account creation (email invite) for chosen employees: preview or run, each employee in a SAVEPOINT
  router.post(
    '/accounts/bulk',
    requirePermission('employees.employee.update'),
    requirePermission('identity.user.create_from_employee'),
    async (req, res, next) => {
      try {
        const input = bulkAccountInput.parse(req.body);
        const ids = [...new Set(input.employeeIds)];
        const data = await run(req, async (ctx, auth) => {
          const seen = new Set<string>();
          const results: {
            employeeId: string;
            employeeNo: string | null;
            name: string | null;
            email: string | null;
            status: BulkAccountStatus;
            reason?: string;
          }[] = [];
          for (const id of ids) {
            let emp: Awaited<ReturnType<typeof loadVisible>>;
            try {
              emp = await loadVisible(ctx, auth, id, 'employees.employee.update');
            } catch {
              results.push({
                employeeId: id,
                employeeNo: null,
                name: null,
                email: null,
                status: 'not_visible',
              });
              continue;
            }
            const base = { employeeId: id, employeeNo: emp.employeeNo, name: emp.fullNameAr };
            const chk = await checkAccountCreation(ctx, emp);
            if (chk.status !== 'ok') {
              results.push({ ...base, email: chk.email, status: chk.status });
              continue;
            }
            // بريد مكرر داخل الدفعة نفسها / same email twice inside this batch
            if (chk.email && seen.has(chk.email)) {
              results.push({ ...base, email: chk.email, status: 'duplicate_email' });
              continue;
            }
            if (chk.email) seen.add(chk.email);
            if (input.dryRun) {
              results.push({ ...base, email: chk.email, status: 'ok' });
              continue;
            }
            await sql`savepoint bulk_account`.execute(ctx.trx);
            try {
              await createEmployeeAccount(ctx, accountDeps, emp, {
                delivery: 'invite',
                ...(input.roleId ? { roleId: input.roleId } : {}),
              });
              await sql`release savepoint bulk_account`.execute(ctx.trx);
              results.push({ ...base, email: chk.email, status: 'created' });
            } catch (err) {
              await sql`rollback to savepoint bulk_account`.execute(ctx.trx);
              results.push({
                ...base,
                email: chk.email,
                status: 'error',
                reason: err instanceof AppError ? err.message : 'تعذّر إنشاء الحساب',
              });
            }
          }
          return results;
        });
        res.json({
          data,
          meta: {
            dryRun: input.dryRun,
            total: data.length,
            created: data.filter((r) => r.status === 'created').length,
            ok: data.filter((r) => r.status === 'ok').length,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:id/account',
    requirePermission('employees.employee.update'),
    requirePermission('identity.user.create_from_employee'),
    async (req, res, next) => {
      try {
        const id = idOf(req.params['id']);
        const body = req.body as { password?: unknown; delivery?: unknown };
        // توافق: كلمة مرور بلا تحديد التسليم تعني التسليم المؤقت
        const input = employeeAccountInput.parse(
          body?.password !== undefined && body?.delivery === undefined
            ? { ...body, delivery: 'temp' }
            : req.body,
        );
        const data = await run(req, async (ctx, auth) => {
          const emp = await loadVisible(ctx, auth, id, 'employees.employee.update');
          return createEmployeeAccount(ctx, accountDeps, emp, input);
        });
        res.status(201).json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:id/account/resend-invite',
    requirePermission('employees.employee.update'),
    requirePermission('identity.user.create_from_employee'),
    async (req, res, next) => {
      try {
        const id = idOf(req.params['id']);
        const data = await run(req, async (ctx, auth) => {
          const emp = await loadVisible(ctx, auth, id, 'employees.employee.update');
          return resendInvite(ctx, accountDeps, emp.userId);
        });
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};
