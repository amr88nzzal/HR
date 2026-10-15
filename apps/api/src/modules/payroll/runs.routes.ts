import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  addLineInput,
  lineOverrideInput,
  num,
  payGroupAssignInput,
  payslipListQuery,
  periodInput,
  periodInputsPut,
  reopenInput,
  simulateInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { employeeScope } from '../employees/index.js';
import { requirePermission } from '../identity/index.js';
import {
  assertDraft,
  calculatePeriod,
  monthRange,
  recalcEmployee,
  simulatePeriod,
  type Period,
} from './calc.js';
import { makeRun } from './setup.routes.js';

type Row = Record<string, unknown>;
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');
const P = 'payroll.period';
const SLIP = 'payroll.payslip';

/** المجموعة الافتراضية الشهرية: تُنشأ عند الطلب */
export const ensureDefaultGroup = async (ctx: Ctx): Promise<string> => {
  const found = await sql<{ id: string }>`
    select id from pay_groups where company_id = ${ctx.companyId} and is_default`.execute(ctx.trx);
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await sql<{ id: string }>`
    insert into pay_groups (company_id, code, name_ar, name_en, is_default)
    values (${ctx.companyId}, 'monthly', 'الرواتب الشهرية', 'Monthly payroll', true)
    on conflict (company_id, code) do update set is_default = true
    returning id`.execute(ctx.trx);
  return rows[0]!.id;
};

const loadPeriod = async (ctx: Ctx, id: string, lock = false): Promise<Period> => {
  const { rows } = await sql<Period>`
    select id, pay_group_id, year, month, start_date::text as start_date, end_date::text as end_date,
           currency, status from payroll_periods
     where id = ${id} and company_id = ${ctx.companyId} ${lock ? sql`for update` : sql``}`.execute(
    ctx.trx,
  );
  if (!rows[0]) throw notFound();
  return rows[0];
};

const periodRows = (ctx: Ctx, id?: string) =>
  sql<Row>`
    select p.id, p.pay_group_id, g.name_ar as group_name, p.year, p.month, p.start_date::text as start_date,
           p.end_date::text as end_date, p.currency, p.status, p.calculated_at, p.approved_at, p.locked_at,
           p.reopen_reason, p.version,
           (select count(*)::int from payslips s where s.period_id = p.id) as employees_count,
           (select count(*)::int from payslips s where s.period_id = p.id and s.status = 'error') as error_count,
           (select count(*)::int from payslips s where s.period_id = p.id and s.has_manual) as manual_count,
           coalesce((select sum(s.gross_amount) from payslips s where s.period_id = p.id), 0)::text as gross_total,
           coalesce((select sum(s.deductions_amount) from payslips s where s.period_id = p.id), 0)::text as deductions_total,
           coalesce((select sum(s.net_amount) from payslips s where s.period_id = p.id), 0)::text as net_total,
           coalesce((select sum(s.employer_amount) from payslips s where s.period_id = p.id), 0)::text as employer_total
      from payroll_periods p join pay_groups g on g.id = p.pay_group_id
     where p.company_id = ${ctx.companyId} ${id ? sql`and p.id = ${id}` : sql``}
     order by p.year desc, p.month desc, g.code, p.currency`.execute(ctx.trx);

const slipDetail = async (ctx: Ctx, slipId: string) => {
  const { rows } = await sql<Row>`
    select s.id, s.period_id, s.employee_id, e.employee_no, e.full_name_ar as employee_name, s.currency,
           s.status, s.basic_amount::text as basic_amount, s.gross_amount::text as gross_amount,
           s.deductions_amount::text as deductions_amount, s.net_amount::text as net_amount,
           s.employer_amount::text as employer_amount, s.inputs, s.warnings, s.error, s.has_manual,
           s.version, p.status as period_status
      from payslips s join employees e on e.id = s.employee_id join payroll_periods p on p.id = s.period_id
     where s.id = ${slipId} and s.company_id = ${ctx.companyId}`.execute(ctx.trx);
  if (!rows[0]) throw notFound();
  const { rows: lines } = await sql<Row>`
    select l.id, l.code, l.name_ar, l.name_en, l.kind, l.amount::text as amount, l.auto_amount::text as auto_amount,
           l.auto_at_override::text as auto_at_override, l.is_manual, l.is_added, l.override_reason_id,
           r.name_ar as override_reason_name, l.override_note, l.override_by, l.override_at, l.explain, l.sort_order
      from payslip_lines l left join override_reasons r on r.id = l.override_reason_id
     where l.payslip_id = ${slipId} order by l.sort_order, l.code`.execute(ctx.trx);
  return {
    ...rows[0],
    lines: lines.map((l) => ({
      ...l,
      // الآلي تغيّر بعد التجاوز: تحتاج المراجعة
      autoChanged:
        l.isManual && !l.isAdded && l.autoAtOverride != null && l.autoAmount !== l.autoAtOverride,
    })),
  };
};

export const createRunsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  // ───── مجموعات الدفع: التعيينات ─────
  router.get(
    '/groups/:id/assignments',
    requirePermission('payroll.group.read'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select a.id, a.employee_id, e.employee_no, e.full_name_ar as employee_name,
                 a.valid_from::text as valid_from, a.valid_to::text as valid_to
            from pay_group_assignments a join employees e on e.id = a.employee_id
           where a.pay_group_id = ${id} and a.company_id = ${ctx.companyId}
           order by a.valid_from desc`.execute(ctx.trx);
        return rows;
      });
      res.json({ data });
    }),
  );
  router.post(
    '/groups/:id/assignments',
    requirePermission('payroll.group.update'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = payGroupAssignInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const g =
          await sql`select 1 from pay_groups where id = ${id} and company_id = ${ctx.companyId}`.execute(
            ctx.trx,
          );
        const e =
          await sql`select 1 from employees where id = ${b.employeeId} and company_id = ${ctx.companyId}`.execute(
            ctx.trx,
          );
        if (!g.rows.length || !e.rows.length)
          throw new AppError('INVALID_REFERENCE', 400, 'مرجع غير موجود');
        // التعيين الجديد يُنهي السابق المفتوح قبل تاريخه بيوم
        await sql`update pay_group_assignments
                     set valid_to = (${b.validFrom}::date - 1)
                   where employee_id = ${b.employeeId} and valid_to is null and valid_from < ${b.validFrom}::date`.execute(
          ctx.trx,
        );
        try {
          const { rows } = await sql<Row>`
            insert into pay_group_assignments (company_id, pay_group_id, employee_id, valid_from)
            values (${ctx.companyId}, ${id}, ${b.employeeId}, ${b.validFrom}::date)
            returning id, employee_id, valid_from::text as valid_from`.execute(ctx.trx);
          return rows[0];
        } catch {
          throw new AppError('ASSIGNMENT_OVERLAP', 409, 'يتداخل مع تعيين آخر للموظف');
        }
      });
      res.status(201).json({ data });
    }),
  );
  router.delete(
    '/groups/:id/assignments/:assignmentId',
    requirePermission('payroll.group.update'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const aid = uuid.parse(req.params['assignmentId']);
      await run(req, async (ctx) => {
        const r = await sql`delete from pay_group_assignments
                             where id = ${aid} and pay_group_id = ${id} and company_id = ${ctx.companyId}`.execute(
          ctx.trx,
        );
        if (!r.numAffectedRows) throw notFound();
      });
      res.status(204).end();
    }),
  );

  // ───── الدورات ─────
  router.get(
    '/periods',
    requirePermission(`${P}.read`),
    wrap(async (req, res) => {
      const data = await run(req, async (ctx) => (await periodRows(ctx)).rows);
      res.json({ data });
    }),
  );
  router.post(
    '/periods',
    requirePermission(`${P}.create`),
    wrap(async (req, res) => {
      const b = periodInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const groupId = b.payGroupId ?? (await ensureDefaultGroup(ctx));
        const g = await sql<{ active: boolean }>`
          select is_active as active from pay_groups where id = ${groupId} and company_id = ${ctx.companyId}`.execute(
          ctx.trx,
        );
        if (!g.rows[0]) throw new AppError('INVALID_REFERENCE', 400, 'مجموعة الدفع غير موجودة');
        if (!g.rows[0].active) throw new AppError('GROUP_INACTIVE', 409, 'مجموعة الدفع معطّلة');
        const cur =
          await sql`select 1 from currencies where company_id = ${ctx.companyId} and code = ${b.currency}`.execute(
            ctx.trx,
          );
        if (!cur.rows.length) throw new AppError('INVALID_REFERENCE', 400, 'العملة غير معرّفة');
        const { startDate, endDate } = monthRange(b.year, b.month);
        try {
          const { rows } = await sql<{ id: string }>`
            insert into payroll_periods (company_id, pay_group_id, year, month, start_date, end_date, currency)
            values (${ctx.companyId}, ${groupId}, ${b.year}, ${b.month}, ${startDate}::date, ${endDate}::date, ${b.currency})
            returning id`.execute(ctx.trx);
          return (await periodRows(ctx, rows[0]!.id)).rows[0];
        } catch (err) {
          if ((err as { code?: string }).code === '23505')
            throw new AppError('PERIOD_EXISTS', 409, 'توجد دورة لهذه المجموعة والشهر والعملة');
          throw err;
        }
      });
      res.status(201).json({ data });
    }),
  );
  router.get(
    '/periods/:id',
    requirePermission(`${P}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const r = (await periodRows(ctx, id)).rows[0];
        if (!r) throw notFound();
        return r;
      });
      res.json({ data });
    }),
  );
  router.delete(
    '/periods/:id',
    requirePermission(`${P}.create`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      await run(req, async (ctx) => {
        const p = await loadPeriod(ctx, id, true);
        assertDraft(p);
        const n = await sql<{
          n: number;
        }>`select count(*)::int as n from payslips where period_id = ${id} and has_manual`.execute(
          ctx.trx,
        );
        if (n.rows[0]!.n > 0)
          throw new AppError('HAS_MANUAL', 409, 'في الدورة قسائم بتعديلات يدوية؛ لا يمكن حذفها');
        await sql`delete from payroll_periods where id = ${id}`.execute(ctx.trx);
      });
      res.status(204).end();
    }),
  );

  router.post(
    '/periods/:id/calculate',
    requirePermission(`${P}.calculate`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) =>
        calculatePeriod(ctx, await loadPeriod(ctx, id, true)),
      );
      res.json({ data });
    }),
  );
  router.post(
    '/periods/:id/simulate',
    requirePermission(`${P}.calculate`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = simulateInput.parse(req.body ?? {});
      const data = await run(req, async (ctx) =>
        simulatePeriod(ctx, await loadPeriod(ctx, id), b.employeeIds),
      );
      res.json({ data });
    }),
  );

  const transition = (
    path: string,
    perm: string,
    from: Period['status'][],
    apply: (ctx: Ctx, p: Period, req: Request) => Promise<void>,
  ) =>
    router.post(
      `/periods/:id/${path}`,
      requirePermission(perm),
      wrap(async (req, res) => {
        const id = uuid.parse(req.params['id']);
        const data = await run(req, async (ctx) => {
          const p = await loadPeriod(ctx, id, true);
          if (!from.includes(p.status))
            throw new AppError('INVALID_STATE', 409, 'الإجراء غير متاح في حالة الدورة الحالية');
          await apply(ctx, p, req);
          return (await periodRows(ctx, id)).rows[0];
        });
        res.json({ data });
      }),
    );

  transition('approve', `${P}.approve`, ['draft'], async (ctx, p) => {
    const { rows } = await sql<Row>`
      select count(*)::int as total, count(*) filter (where status = 'error')::int as errors
        from payslips where period_id = ${p.id}`.execute(ctx.trx);
    const r = rows[0]!;
    const calc = await sql<{
      c: Date | null;
    }>`select calculated_at as c from payroll_periods where id = ${p.id}`.execute(ctx.trx);
    if (!calc.rows[0]?.c || Number(r.total) === 0)
      throw new AppError('NOT_CALCULATED', 409, 'احتسب الدورة أولاً');
    if (Number(r.errors) > 0)
      throw new AppError(
        'HAS_ERRORS',
        409,
        'في الدورة قسائم بأخطاء احتساب؛ عالجها ثم أعد الاحتساب',
      );
    await sql`update payroll_periods set status = 'approved', approved_by = ${ctx.userId}, approved_at = now(),
                     reopen_reason = null, version = version + 1 where id = ${p.id}`.execute(
      ctx.trx,
    );
  });
  transition('lock', `${P}.lock`, ['approved'], async (ctx, p) => {
    await sql`update payroll_periods set status = 'locked', locked_by = ${ctx.userId}, locked_at = now(),
                     version = version + 1 where id = ${p.id}`.execute(ctx.trx);
  });
  transition('reopen', `${P}.approve`, ['approved', 'locked'], async (ctx, p, req) => {
    const b = reopenInput.parse(req.body);
    if (p.status === 'locked') {
      const ok = req.auth?.grants.some((g) => g.code === `${P}.reopen`);
      if (!ok) throw new AppError('FORBIDDEN', 403, 'إعادة فتح دورة مقفلة تحتاج صلاحية خاصة');
    }
    await sql`update payroll_periods set status = 'draft', reopen_reason = ${b.reason}, approved_by = null,
                     approved_at = null, locked_by = null, locked_at = null, version = version + 1
               where id = ${p.id}`.execute(ctx.trx);
  });

  // ───── المدخلات اليدوية ─────
  router.get(
    '/periods/:id/inputs',
    requirePermission('payroll.input.read'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select i.employee_id, e.employee_no, e.full_name_ar as employee_name, i.key, i.value::text as value, i.note
            from payroll_inputs i join employees e on e.id = i.employee_id
           where i.period_id = ${id} and i.company_id = ${ctx.companyId} order by e.employee_no, i.key`.execute(
          ctx.trx,
        );
        return rows;
      });
      res.json({ data });
    }),
  );
  router.put(
    '/periods/:id/inputs',
    requirePermission('payroll.input.manage'),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = periodInputsPut.parse(req.body);
      await run(req, async (ctx) => {
        assertDraft(await loadPeriod(ctx, id, true));
        for (const it of b.items) {
          if (it.value === null)
            await sql`delete from payroll_inputs where period_id = ${id} and employee_id = ${it.employeeId} and key = ${it.key}`.execute(
              ctx.trx,
            );
          else {
            const e =
              await sql`select 1 from employees where id = ${it.employeeId} and company_id = ${ctx.companyId}`.execute(
                ctx.trx,
              );
            if (!e.rows.length) throw new AppError('INVALID_REFERENCE', 400, 'موظف غير موجود');
            await sql`
              insert into payroll_inputs (company_id, period_id, employee_id, key, value, note, updated_by)
              values (${ctx.companyId}, ${id}, ${it.employeeId}, ${it.key}, ${it.value}, ${it.note ?? null}, ${ctx.userId})
              on conflict (period_id, employee_id, key)
              do update set value = excluded.value, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`.execute(
              ctx.trx,
            );
          }
        }
      });
      res.status(204).end();
    }),
  );

  // ───── القسائم ─────
  router.get(
    '/periods/:id/payslips',
    requirePermission(`${SLIP}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const q = payslipListQuery.parse(req.query);
      const auth = req.auth as NonNullable<Request['auth']>;
      const out = await run(req, async (ctx) => {
        await loadPeriod(ctx, id);
        const scope = employeeScope(auth, `${SLIP}.read`);
        const like = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
        const where = sql`s.period_id = ${id} and s.company_id = ${ctx.companyId}
          ${scope ? sql`and ${scope}` : sql``}
          ${like ? sql`and (employees.full_name_ar ilike ${like} or employees.employee_no ilike ${like})` : sql``}
          ${q.manualOnly === 'true' ? sql`and s.has_manual` : sql``}`;
        const total = await sql<{ n: number }>`
          select count(*)::int as n from payslips s join employees on employees.id = s.employee_id where ${where}`.execute(
          ctx.trx,
        );
        const { rows } = await sql<Row>`
          select s.id, s.employee_id, employees.employee_no, employees.full_name_ar as employee_name, s.status,
                 s.basic_amount::text as basic_amount, s.gross_amount::text as gross_amount,
                 s.deductions_amount::text as deductions_amount, s.net_amount::text as net_amount,
                 s.employer_amount::text as employer_amount, s.has_manual, s.warnings, s.error
            from payslips s join employees on employees.id = s.employee_id
           where ${where} order by employees.employee_no
           limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`.execute(ctx.trx);
        return { rows, total: total.rows[0]!.n };
      });
      res.json({ data: out.rows, meta: { page: q.page, pageSize: q.pageSize, total: out.total } });
    }),
  );

  /** مقارنة صافي كل موظف بالدورة السابقة لنفس المجموعة والعملة */
  router.get(
    '/periods/:id/compare',
    requirePermission(`${SLIP}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const p = await loadPeriod(ctx, id);
        const prev = await sql<{ id: string }>`
          select id from payroll_periods
           where company_id = ${ctx.companyId} and pay_group_id = ${p.payGroupId} and currency = ${p.currency}
             and (year, month) < (${p.year}, ${p.month}) order by year desc, month desc limit 1`.execute(
          ctx.trx,
        );
        const prevId = prev.rows[0]?.id ?? null;
        const { rows } = await sql<Row>`
          select e.id as employee_id, e.employee_no, e.full_name_ar as employee_name,
                 cur.net_amount::text as net, old.net_amount::text as prev_net,
                 (coalesce(cur.net_amount, 0) - coalesce(old.net_amount, 0))::text as diff
            from payslips cur
            full join (select * from payslips where period_id = ${prevId}) old on old.employee_id = cur.employee_id
            join employees e on e.id = coalesce(cur.employee_id, old.employee_id)
           where cur.period_id = ${id} or (cur.id is null and old.id is not null)
           order by abs(coalesce(cur.net_amount, 0) - coalesce(old.net_amount, 0)) desc, e.employee_no`.execute(
          ctx.trx,
        );
        return { previousPeriodId: prevId, rows: rows.filter((r) => r.diff !== '0.0000') };
      });
      res.json({ data });
    }),
  );

  /** تقرير التعديلات اليدوية في الدورة */
  router.get(
    '/periods/:id/overrides',
    requirePermission(`${SLIP}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select l.id as line_id, s.id as payslip_id, e.employee_no, e.full_name_ar as employee_name, l.code, l.name_ar,
                 l.amount::text as amount, l.auto_amount::text as auto_amount, l.is_added,
                 r.name_ar as reason_name, l.override_note, l.override_at, u.email as override_by
            from payslip_lines l
            join payslips s on s.id = l.payslip_id join employees e on e.id = s.employee_id
            left join override_reasons r on r.id = l.override_reason_id
            left join users u on u.id = l.override_by
           where s.period_id = ${id} and s.company_id = ${ctx.companyId} and (l.is_manual or l.is_added)
           order by e.employee_no, l.code`.execute(ctx.trx);
        return rows;
      });
      res.json({ data });
    }),
  );

  const withSlip = async (ctx: Ctx, slipId: string, write: boolean) => {
    const { rows } = await sql<{ periodId: string; employeeId: string }>`
      select period_id, employee_id from payslips where id = ${slipId} and company_id = ${ctx.companyId}`.execute(
      ctx.trx,
    );
    if (!rows[0]) throw notFound();
    const p = await loadPeriod(ctx, rows[0].periodId, write);
    if (write) assertDraft(p);
    return { p, employeeId: rows[0].employeeId };
  };

  const checkReason = async (ctx: Ctx, reasonId: string) => {
    const r = await sql<{ active: boolean }>`
      select is_active as active from override_reasons where id = ${reasonId} and company_id = ${ctx.companyId}`.execute(
      ctx.trx,
    );
    if (!r.rows[0]?.active) throw new AppError('INVALID_REFERENCE', 400, 'سبب التجاوز غير صالح');
  };

  router.get(
    '/payslips/:id',
    requirePermission(`${SLIP}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const scope = employeeScope(auth, `${SLIP}.read`);
        if (scope) {
          const ok =
            await sql`select 1 from payslips s join employees on employees.id = s.employee_id
                                where s.id = ${id} and ${scope}`.execute(ctx.trx);
          if (!ok.rows.length) throw notFound();
        }
        return slipDetail(ctx, id);
      });
      res.json({ data });
    }),
  );
  router.post(
    '/payslips/:id/recalculate',
    requirePermission(`${P}.calculate`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const { p, employeeId } = await withSlip(ctx, id, true);
        const slipId = await recalcEmployee(ctx, p, employeeId);
        return slipDetail(ctx, slipId);
      });
      res.json({ data });
    }),
  );

  /** يعيد حساب الإجماليات بعد تعديل بنود يدوية (إعادة احتساب الموظف تحفظ التجاوزات) */
  router.patch(
    '/payslips/:id/lines/:lineId',
    requirePermission(`${SLIP}.override`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const lineId = uuid.parse(req.params['lineId']);
      const b = lineOverrideInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const { p, employeeId } = await withSlip(ctx, id, true);
        await checkReason(ctx, b.reasonId);
        const l = await sql<Row>`
          select code, is_added, is_manual, auto_amount::text as auto_amount from payslip_lines
           where id = ${lineId} and payslip_id = ${id}`.execute(ctx.trx);
        const line = l.rows[0];
        if (!line) throw notFound();
        if (line.isAdded) {
          await sql`update payslip_lines set amount = ${b.amount}, override_reason_id = ${b.reasonId},
                           override_note = ${b.note ?? null}, override_by = ${ctx.userId}, override_at = now()
                     where id = ${lineId}`.execute(ctx.trx);
        } else {
          await sql`update payslip_lines set amount = ${b.amount}, is_manual = true,
                           auto_at_override = coalesce(auto_at_override, auto_amount),
                           override_reason_id = ${b.reasonId}, override_note = ${b.note ?? null},
                           override_by = ${ctx.userId}, override_at = now()
                     where id = ${lineId}`.execute(ctx.trx);
        }
        // إعادة الاحتساب تُبقي القيم اليدوية وتُعيد المشتقات (أسس ونسب) على أساسها
        return slipDetail(ctx, await recalcEmployee(ctx, p, employeeId));
      });
      res.json({ data });
    }),
  );
  router.delete(
    '/payslips/:id/lines/:lineId/override',
    requirePermission(`${SLIP}.override`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const lineId = uuid.parse(req.params['lineId']);
      const data = await run(req, async (ctx) => {
        const { p, employeeId } = await withSlip(ctx, id, true);
        const r = await sql`
          update payslip_lines set is_manual = false, auto_at_override = null, override_reason_id = null,
                 override_note = null, override_by = null, override_at = null
           where id = ${lineId} and payslip_id = ${id} and is_manual and not is_added`.execute(
          ctx.trx,
        );
        if (!r.numAffectedRows) throw notFound();
        return slipDetail(ctx, await recalcEmployee(ctx, p, employeeId));
      });
      res.json({ data });
    }),
  );
  router.post(
    '/payslips/:id/lines',
    requirePermission(`${SLIP}.override`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = addLineInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const { p, employeeId } = await withSlip(ctx, id, true);
        await checkReason(ctx, b.reasonId);
        const code = `added_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        await sql`
          insert into payslip_lines (company_id, payslip_id, code, name_ar, name_en, kind, amount, is_manual, is_added,
                                     override_reason_id, override_note, override_by, override_at, sort_order)
          values (${ctx.companyId}, ${id}, ${code}, ${b.nameAr}, ${b.nameEn ?? null}, ${b.kind}, ${num(b.amount).toFixed(4)},
                  true, true, ${b.reasonId}, ${b.note ?? null}, ${ctx.userId}, now(), 1000)`.execute(
          ctx.trx,
        );
        return slipDetail(ctx, await recalcEmployee(ctx, p, employeeId));
      });
      res.status(201).json({ data });
    }),
  );
  router.delete(
    '/payslips/:id/lines/:lineId',
    requirePermission(`${SLIP}.override`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const lineId = uuid.parse(req.params['lineId']);
      const data = await run(req, async (ctx) => {
        const { p, employeeId } = await withSlip(ctx, id, true);
        const r =
          await sql`delete from payslip_lines where id = ${lineId} and payslip_id = ${id} and is_added`.execute(
            ctx.trx,
          );
        if (!r.numAffectedRows) throw notFound();
        return slipDetail(ctx, await recalcEmployee(ctx, p, employeeId));
      });
      res.json({ data });
    }),
  );

  return router;
};
