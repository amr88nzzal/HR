import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  buildSchedule,
  installmentDeferInput,
  loanCancelInput,
  loanInput,
  loanListQuery,
  paymentBulkInput,
  paymentListQuery,
  paymentMarkInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { recalcEmployee, type Period } from './calc.js';
import { deferInstallment, refreshLoanStatuses } from './loans.js';
import { makeRun } from './setup.routes.js';

type Row = Record<string, unknown>;
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const L = 'payroll.loan';
const PAY = 'payroll.payment';

const loanRow = async (ctx: Ctx, id: string) => {
  const { rows } = await sql<Row>`
    select l.id, l.employee_id, e.employee_no, e.full_name_ar as employee_name, l.kind, l.currency,
           l.principal::text as principal, l.installments_count, l.first_year, l.first_month, l.reason,
           l.status, l.cancel_reason, l.version, l.created_at,
           coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'deducted'), 0)::text as repaid,
           coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'scheduled'), 0)::text as remaining
      from loans l join employees e on e.id = l.employee_id
     where l.id = ${id} and l.company_id = ${ctx.companyId}`.execute(ctx.trx);
  if (!rows[0]) throw new AppError('NOT_FOUND', 404, 'السلفة غير موجودة');
  return rows[0];
};

/** يفصل أقساطاً من قسائم دورات المسودة ويعيد احتساب أصحابها؛ ويرفض إن كانت الدورة معتمدة/مقفلة. */
const detachFromDrafts = async (ctx: Ctx, installmentIds: string[]): Promise<void> => {
  if (!installmentIds.length) return;
  const { rows } = await sql<Row>`
    select distinct p.status
      from payslip_loan_items it
      join payslips s on s.id = it.payslip_id
      join payroll_periods p on p.id = s.period_id
     where it.installment_id = any(${installmentIds}::uuid[])`.execute(ctx.trx);
  if (rows.some((r) => r.status !== 'draft'))
    throw new AppError(
      'PERIOD_LOCKED',
      409,
      'القسط داخل دورة معتمدة أو مقفلة؛ أعد فتح الدورة أولاً',
    );
  await sql`delete from payslip_loan_items where installment_id = any(${installmentIds}::uuid[])`.execute(
    ctx.trx,
  );
};

const redo = async (ctx: Ctx, installmentIds: string[]): Promise<void> => {
  const { rows } = await sql<Row>`
    select distinct s.employee_id, p.id, p.pay_group_id, p.year, p.month, p.start_date::text as start_date,
           p.end_date::text as end_date, p.currency, p.status
      from payslips s join payroll_periods p on p.id = s.period_id
      join loan_installments i on i.company_id = s.company_id
     where i.id = any(${installmentIds}::uuid[]) and p.status = 'draft'
       and exists (select 1 from loans l where l.id = i.loan_id and l.employee_id = s.employee_id)`.execute(
    ctx.trx,
  );
  for (const r of rows) await recalcEmployee(ctx, r as unknown as Period, r.employeeId as string);
};

export const createLoansRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  // ───── السلف ─────
  router.get(
    '/loans',
    requirePermission(`${L}.read`),
    wrap(async (req, res) => {
      const q = loanListQuery.parse(req.query);
      const out = await run(req, async (ctx) => {
        const where = sql`l.company_id = ${ctx.companyId}
          ${q.employeeId ? sql`and l.employee_id = ${q.employeeId}` : sql``}
          ${q.status ? sql`and l.status = ${q.status}` : sql``}`;
        const total = await sql<{
          n: number;
        }>`select count(*)::int as n from loans l where ${where}`.execute(ctx.trx);
        const { rows } = await sql<Row>`
          select l.id, l.employee_id, e.employee_no, e.full_name_ar as employee_name, l.kind, l.currency,
                 l.principal::text as principal, l.installments_count, l.first_year, l.first_month, l.status,
                 coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'deducted'), 0)::text as repaid,
                 coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'scheduled'), 0)::text as remaining
            from loans l join employees e on e.id = l.employee_id
           where ${where} order by l.created_at desc
           limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`.execute(ctx.trx);
        return { rows, total: total.rows[0]!.n };
      });
      res.json({ data: out.rows, meta: { page: q.page, pageSize: q.pageSize, total: out.total } });
    }),
  );

  router.post(
    '/loans',
    requirePermission(`${L}.create`),
    wrap(async (req, res) => {
      const b = loanInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const emp = await sql<Row>`
          select id from employees where id = ${b.employeeId} and company_id = ${ctx.companyId}`.execute(
          ctx.trx,
        );
        if (!emp.rows[0]) throw new AppError('NOT_FOUND', 404, 'الموظف غير موجود');
        const { rows } = await sql<{ id: string }>`
          insert into loans (company_id, employee_id, kind, currency, principal, installments_count,
                             first_year, first_month, reason, created_by)
          values (${ctx.companyId}, ${b.employeeId}, ${b.kind}, ${b.currency}, ${b.principal},
                  ${b.installmentsCount}, ${b.firstYear}, ${b.firstMonth}, ${b.reason ?? null}, ${ctx.userId})
          returning id`.execute(ctx.trx);
        const id = rows[0]!.id;
        for (const it of buildSchedule(b.principal, b.installmentsCount, b.firstYear, b.firstMonth))
          await sql`insert into loan_installments (company_id, loan_id, no, due_year, due_month, amount)
                    values (${ctx.companyId}, ${id}, ${it.no}, ${it.year}, ${it.month}, ${it.amount})`.execute(
            ctx.trx,
          );
        // دفعة صرف السلفة للموظف (معلّقة حتى تُعلَّم مدفوعة)
        await sql`insert into payments (company_id, kind, employee_id, loan_id, amount, currency)
                  values (${ctx.companyId}, 'loan', ${b.employeeId}, ${id}, ${b.principal}, ${b.currency})`.execute(
          ctx.trx,
        );
        return loanRow(ctx, id);
      });
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/loans/:id',
    requirePermission(`${L}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const loan = await loanRow(ctx, id);
        const { rows: installments } = await sql<Row>`
          select i.id, i.no, i.due_year, i.due_month, i.amount::text as amount, i.status, i.period_id,
                 i.deferred_reason, i.system_deferred, i.moved_to_id
            from loan_installments i where i.loan_id = ${id} order by i.no`.execute(ctx.trx);
        const { rows: payments } = await sql<Row>`
          select id, status, method, reference, paid_at::text as paid_at, amount::text as amount
            from payments where loan_id = ${id}`.execute(ctx.trx);
        return { ...loan, installments, payments };
      });
      res.json({ data });
    }),
  );

  router.post(
    '/loans/:id/cancel',
    requirePermission(`${L}.manage`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = loanCancelInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const loan = await loanRow(ctx, id);
        if (loan['status'] !== 'active')
          throw new AppError('INVALID_STATE', 409, 'تُلغى السلفة النشطة فقط');
        const { rows } = await sql<{ id: string }>`
          select id from loan_installments where loan_id = ${id} and status = 'scheduled'`.execute(
          ctx.trx,
        );
        const ids = rows.map((r) => r.id);
        await detachFromDrafts(ctx, ids);
        await sql`update loan_installments set status = 'cancelled' where loan_id = ${id} and status = 'scheduled'`.execute(
          ctx.trx,
        );
        await sql`update loans set status = 'cancelled', cancel_reason = ${b.reason}, version = version + 1
                   where id = ${id}`.execute(ctx.trx);
        // دفعة الصرف غير المنفذة لا معنى لها بعد الإلغاء
        await sql`delete from payments where loan_id = ${id} and kind = 'loan' and status = 'pending'`.execute(
          ctx.trx,
        );
        await redo(ctx, ids);
        return loanRow(ctx, id);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/loan-installments/:id/defer',
    requirePermission(`${L}.manage`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = installmentDeferInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        // التوزيع على المتبقي يعدّل أقساطاً لاحقة أيضاً فتُفصل عن المسودات وتُحتسب من جديد
        const affected =
          b.mode === 'remaining'
            ? (
                await sql<Row>`
                  select i.id from loan_installments i
                   where i.status = 'scheduled' and i.loan_id = (select loan_id from loan_installments where id = ${id})`.execute(
                  ctx.trx,
                )
              ).rows.map((r) => r.id as string)
            : [id];
        await detachFromDrafts(ctx, affected);
        await deferInstallment(ctx, id, {
          reason: b.reason,
          amount: b.amount,
          mode: b.mode,
          count: b.count,
          target:
            b.targetYear !== undefined && b.targetMonth !== undefined
              ? { year: b.targetYear, month: b.targetMonth }
              : undefined,
        });
        await redo(ctx, affected);
        const { rows } =
          await sql<Row>`select loan_id from loan_installments where id = ${id}`.execute(ctx.trx);
        await refreshLoanStatuses(ctx, [rows[0]!.loanId as string]);
        return loanRow(ctx, rows[0]!.loanId as string);
      });
      res.json({ data });
    }),
  );

  // ───── المدفوعات ─────
  const paymentSelect = sql`
    select pm.id, pm.kind, pm.employee_id, e.employee_no, e.full_name_ar as employee_name, pm.period_id,
           pm.payslip_id, pm.loan_id, pm.amount::text as amount, pm.currency, pm.status, pm.method,
           pm.reference, pm.paid_at::text as paid_at, pm.note, pm.version
      from payments pm join employees e on e.id = pm.employee_id`;

  router.get(
    '/payments',
    requirePermission(`${PAY}.read`),
    wrap(async (req, res) => {
      const q = paymentListQuery.parse(req.query);
      const out = await run(req, async (ctx) => {
        const where = sql`pm.company_id = ${ctx.companyId}
          ${q.periodId ? sql`and pm.period_id = ${q.periodId}` : sql``}
          ${q.kind ? sql`and pm.kind = ${q.kind}` : sql``}
          ${q.status ? sql`and pm.status = ${q.status}` : sql``}
          ${q.employeeId ? sql`and pm.employee_id = ${q.employeeId}` : sql``}`;
        const total = await sql<{
          n: number;
        }>`select count(*)::int as n from payments pm where ${where}`.execute(ctx.trx);
        const { rows } = await sql<Row>`${paymentSelect} where ${where}
          order by e.employee_no nulls last, pm.created_at
          limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`.execute(ctx.trx);
        return { rows, total: total.rows[0]!.n };
      });
      res.json({ data: out.rows, meta: { page: q.page, pageSize: q.pageSize, total: out.total } });
    }),
  );

  router.post(
    '/payments/mark',
    requirePermission(`${PAY}.manage`),
    wrap(async (req, res) => {
      const b = paymentBulkInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const r = await sql`
          update payments set status = 'paid', method = ${b.method}, reference = ${b.reference ?? null},
                 paid_at = ${b.paidAt}::date, paid_by = ${ctx.userId}, version = version + 1
           where company_id = ${ctx.companyId} and id = any(${b.ids}::uuid[]) and status = 'pending'`.execute(
          ctx.trx,
        );
        return { updated: Number(r.numAffectedRows ?? 0) };
      });
      res.json({ data });
    }),
  );
  router.post(
    '/payments/:id/mark',
    requirePermission(`${PAY}.manage`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = paymentMarkInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const r = await sql`
          update payments set status = 'paid', method = ${b.method}, reference = ${b.reference ?? null},
                 paid_at = ${b.paidAt}::date, note = ${b.note ?? null}, paid_by = ${ctx.userId},
                 version = version + 1
           where id = ${id} and company_id = ${ctx.companyId} and status = 'pending'`.execute(
          ctx.trx,
        );
        if (!Number(r.numAffectedRows ?? 0))
          throw new AppError('INVALID_STATE', 409, 'الدفعة غير موجودة أو مدفوعة مسبقاً');
        return (await sql<Row>`${paymentSelect} where pm.id = ${id}`.execute(ctx.trx)).rows[0];
      });
      res.json({ data });
    }),
  );
  router.post(
    '/payments/:id/unmark',
    requirePermission(`${PAY}.manage`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        const r = await sql`
          update payments set status = 'pending', method = null, reference = null, paid_at = null,
                 paid_by = null, version = version + 1
           where id = ${id} and company_id = ${ctx.companyId} and status = 'paid'`.execute(ctx.trx);
        if (!Number(r.numAffectedRows ?? 0))
          throw new AppError('INVALID_STATE', 409, 'الدفعة غير موجودة أو غير مدفوعة');
        return (await sql<Row>`${paymentSelect} where pm.id = ${id}`.execute(ctx.trx)).rows[0];
      });
      res.json({ data });
    }),
  );

  /** تصدير دفعات الدورة CSV (مع رقم الموظف في المحاسبة) */
  router.get(
    '/periods/:id/payments.csv',
    requirePermission(`${PAY}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const rows = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select e.employee_no, e.full_name_ar as name, r.value as accounting_no, pm.amount::text as amount,
                 pm.currency, pm.status, coalesce(pm.method, '') as method, coalesce(pm.reference, '') as reference,
                 coalesce(pm.paid_at::text, '') as paid_at
            from payments pm join employees e on e.id = pm.employee_id
            left join lateral (
              select x.value from employee_external_refs x
                join external_systems s on s.id = x.system_id and s.key = 'accounting'
               where x.employee_id = e.id order by x.is_primary desc, x.created_at limit 1
            ) r on true
           where pm.period_id = ${id} and pm.company_id = ${ctx.companyId} and pm.kind = 'payslip'
           order by e.employee_no nulls last`.execute(ctx.trx);
        return rows;
      });
      const esc = (v: unknown) => {
        let s = String(v ?? '');
        // منع حقن الصيغ عند فتح الملف في Excel
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = [
        'employee_no',
        'name',
        'accounting_no',
        'amount',
        'currency',
        'status',
        'method',
        'reference',
        'paid_at',
      ];
      const body = rows.map((r) =>
        [
          r.employeeNo,
          r.name,
          r.accountingNo,
          r.amount,
          r.currency,
          r.status,
          r.method,
          r.reference,
          r.paidAt,
        ]
          .map(esc)
          .join(','),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
      res.send('﻿' + [head.join(','), ...body].join('\r\n'));
    }),
  );

  return router;
};
