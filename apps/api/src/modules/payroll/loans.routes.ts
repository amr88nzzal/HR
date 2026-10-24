import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  buildSchedule,
  installmentDeferInput,
  loanBulkInput,
  loanCancelInput,
  loanInput,
  loanListQuery,
  loanSettleInput,
  MAX_FILE_BYTES,
  num,
  paymentBulkInput,
  paymentListQuery,
  paymentMarkInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import {
  readStoredFile,
  saveStoredFile,
  validateUpload,
  type FileDeps,
} from '../../shared/stored-files.js';
import { requirePermission } from '../identity/index.js';
import { recalcEmployee, type Period } from './calc.js';
import { deferInstallment, refreshLoanStatuses } from './loans.js';
import { monthlyLimitWarning, planDates, resolveLoanType } from './loan-types.js';
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
           l.type_id, lt.code as type_code, lt.name_ar as type_name_ar, lt.name_en as type_name_en,
           lt.color as type_color, l.event_date::text as event_date, l.reference,
           l.principal::text as principal, l.installments_count, l.first_year, l.first_month, l.reason,
           l.status, l.cancel_reason, l.version, l.created_at, l.settlement_mode, l.settlement_amount::text as settlement_amount,
           l.settlement_reference, l.settlement_note, l.settled_at, lt.requires_attachment,
           (select count(*)::int from loan_attachments a where a.loan_id = l.id) as attachments_count,
           coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'deducted'), 0)::text as repaid,
           coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'scheduled'), 0)::text as remaining
      from loans l join employees e on e.id = l.employee_id join loan_types lt on lt.id = l.type_id
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

export const createLoansRouter = (
  db: Db,
  authenticate: RequestHandler,
  files: FileDeps,
): Router => {
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
          ${q.typeId ? sql`and l.type_id = ${q.typeId}` : sql``}
          ${q.status ? sql`and l.status = ${q.status}` : sql``}`;
        const total = await sql<{
          n: number;
        }>`select count(*)::int as n from loans l where ${where}`.execute(ctx.trx);
        const { rows } = await sql<Row>`
          select l.id, l.employee_id, e.employee_no, e.full_name_ar as employee_name, l.kind, l.currency,
           l.type_id, lt.code as type_code, lt.name_ar as type_name_ar, lt.name_en as type_name_en,
           lt.color as type_color, l.event_date::text as event_date, l.reference,
                 l.principal::text as principal, l.installments_count, l.first_year, l.first_month, l.status,
                 lt.requires_attachment,
                 (select count(*)::int from loan_attachments a where a.loan_id = l.id) as attachments_count,
                 coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'deducted'), 0)::text as repaid,
                 coalesce((select sum(i.amount) from loan_installments i where i.loan_id = l.id and i.status = 'scheduled'), 0)::text as remaining
            from loans l join employees e on e.id = l.employee_id join loan_types lt on lt.id = l.type_id
           where ${where} order by l.event_date desc, l.created_at desc
           limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`.execute(ctx.trx);
        return { rows, total: total.rows[0]!.n };
      });
      res.json({ data: out.rows, meta: { page: q.page, pageSize: q.pageSize, total: out.total } });
    }),
  );

  /** ينشئ سلفة/قرضاً/فاتورة ذمم مع جدول أقساطها؛ يعيد تنبيه الحد الشهري إن وُجد. */
  /** Creates a loan/advance/receivable with its schedule; returns the monthly-limit warning if any. */
  const createOne = async (
    ctx: Ctx,
    b: {
      employeeId: string;
      currency: string;
      principal: string;
      installmentsCount: number;
      reason?: string | null | undefined;
      reference?: string | null | undefined;
      eventDate?: string | undefined;
      firstYear?: number | undefined;
      firstMonth?: number | undefined;
    },
    type: Awaited<ReturnType<typeof resolveLoanType>>,
  ): Promise<{ id: string; warning: string | null }> => {
    if (b.installmentsCount > type.maxInstallments)
      throw new AppError(
        'TOO_MANY_INSTALLMENTS',
        400,
        'عدد الأقساط يتجاوز الحد المسموح لهذا النوع',
      );
    const plan = planDates(b);
    const warning = await monthlyLimitWarning(
      ctx,
      type,
      b.employeeId,
      b.principal,
      b.installmentsCount,
      plan.firstYear,
      plan.firstMonth,
    );
    const { rows } = await sql<{ id: string }>`
      insert into loans (company_id, employee_id, kind, type_id, event_date, reference, currency, principal,
                         installments_count, first_year, first_month, reason, created_by)
      values (${ctx.companyId}, ${b.employeeId}, ${type.code}, ${type.id}, ${plan.eventDate}::date,
              ${b.reference ?? null}, ${b.currency}, ${b.principal}, ${b.installmentsCount},
              ${plan.firstYear}, ${plan.firstMonth}, ${b.reason ?? null}, ${ctx.userId})
      returning id`.execute(ctx.trx);
    const id = rows[0]!.id;
    for (const it of buildSchedule(
      b.principal,
      b.installmentsCount,
      plan.firstYear,
      plan.firstMonth,
    ))
      await sql`insert into loan_installments (company_id, loan_id, no, due_year, due_month, amount)
                values (${ctx.companyId}, ${id}, ${it.no}, ${it.year}, ${it.month}, ${it.amount})`.execute(
        ctx.trx,
      );
    // دفعة صرف للموظف (معلّقة حتى تُعلَّم مدفوعة)؛ الذمم لا صرف فيها فلا دفعة
    // A disbursement payment (pending until marked paid); receivables pay nothing out, so no payment row
    if (type.disburses)
      await sql`insert into payments (company_id, kind, employee_id, loan_id, amount, currency)
                values (${ctx.companyId}, 'loan', ${b.employeeId}, ${id}, ${b.principal}, ${b.currency})`.execute(
        ctx.trx,
      );
    return { id, warning };
  };

  const employeeExists = async (ctx: Ctx, employeeId: string): Promise<void> => {
    const emp = await sql<Row>`
      select id from employees where id = ${employeeId} and company_id = ${ctx.companyId}`.execute(
      ctx.trx,
    );
    if (!emp.rows[0]) throw new AppError('NOT_FOUND', 404, 'الموظف غير موجود');
  };

  router.post(
    '/loans',
    requirePermission(`${L}.create`),
    wrap(async (req, res) => {
      const b = loanInput.parse(req.body);
      const out = await run(req, async (ctx) => {
        await employeeExists(ctx, b.employeeId);
        const type = await resolveLoanType(ctx, b);
        const { id, warning } = await createOne(ctx, b, type);
        return { loan: await loanRow(ctx, id), warning };
      });
      res
        .status(201)
        .json({ data: out.loan, meta: { warnings: out.warning ? [out.warning] : [] } });
    }),
  );

  /** إدخال عدة فواتير/سلف لموظف دفعة واحدة (كل بند سجل مستقل بقسط واحد). */
  /** Enters several invoices/advances for one employee at once (each item is its own single-installment record). */
  router.post(
    '/loans/bulk',
    requirePermission(`${L}.create`),
    wrap(async (req, res) => {
      const b = loanBulkInput.parse(req.body);
      const out = await run(req, async (ctx) => {
        await employeeExists(ctx, b.employeeId);
        const type = await resolveLoanType(ctx, { typeId: b.typeId });
        const ids: string[] = [];
        const warnings = new Set<string>();
        for (const it of b.items) {
          const { id, warning } = await createOne(
            ctx,
            {
              ...it,
              principal: it.amount,
              employeeId: b.employeeId,
              currency: b.currency,
              installmentsCount: 1,
            },
            type,
          );
          ids.push(id);
          if (warning) warnings.add(warning);
        }
        return { ids, warnings: [...warnings] };
      });
      res.status(201).json({ data: { ids: out.ids }, meta: { warnings: out.warnings } });
    }),
  );

  // ───── مرفقات السلفة/الفاتورة (اختيارية دائماً؛ التنبيه في الواجهة عند «يتطلب مرفقاً») ─────
  const attParams = z.object({ id: uuid, attId: uuid });
  const MAX_ATTACHMENTS = 5;
  const loanExists = async (ctx: Ctx, id: string) => {
    const r = await ctx.trx
      .selectFrom('loans')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 404, 'السلفة غير موجودة');
  };
  router.get(
    '/loans/:id/attachments',
    requirePermission(`${L}.read`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const data = await run(req, async (ctx) => {
        await loanExists(ctx, id);
        return ctx.trx
          .selectFrom('loanAttachments as x')
          .innerJoin('storedFiles as f', 'f.id', 'x.fileId')
          .select(['x.id', 'f.originalName as name', 'f.mimeType', 'f.sizeBytes', 'x.createdAt'])
          .where('x.companyId', '=', ctx.companyId)
          .where('x.loanId', '=', id)
          .orderBy('x.createdAt')
          .execute();
      });
      res.json({ data });
    }),
  );
  router.post(
    '/loans/:id/attachments',
    requirePermission(`${L}.create`),
    express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const body = req.body as unknown;
      const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      const mime = validateUpload(buf, ['application/pdf', 'image/jpeg', 'image/png']);
      // الاسم من X-File-Name (مرمَّز URI من عميل الويب) أو ?name / name from X-File-Name or ?name
      const header = req.header('x-file-name');
      const rawName = header ? decodeURIComponent(header) : (req.query['name'] ?? 'attachment');
      const name = z.string().trim().min(1).max(200).parse(rawName);
      const data = await run(req, async (ctx) => {
        await loanExists(ctx, id);
        const n = await ctx.trx
          .selectFrom('loanAttachments')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('companyId', '=', ctx.companyId)
          .where('loanId', '=', id)
          .executeTakeFirstOrThrow();
        if (Number(n.n) >= MAX_ATTACHMENTS)
          throw new AppError(
            'TOO_MANY_ATTACHMENTS',
            409,
            `الحد الأقصى ${MAX_ATTACHMENTS} مرفقات للسلفة`,
          );
        const file = await saveStoredFile(ctx, files, {
          buffer: buf,
          mime,
          originalName: name,
          purpose: 'loan',
          encrypt: !!files.crypto,
        });
        return ctx.trx
          .insertInto('loanAttachments')
          .values({
            companyId: ctx.companyId,
            loanId: id,
            fileId: file.id,
            uploadedBy: ctx.userId ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );
  router.get(
    '/loans/:id/attachments/:attId/content',
    requirePermission(`${L}.read`),
    wrap(async (req, res) => {
      const { id, attId } = attParams.parse(req.params);
      const file = await run(req, async (ctx) => {
        const f = await ctx.trx
          .selectFrom('loanAttachments as x')
          .innerJoin('storedFiles as f', 'f.id', 'x.fileId')
          .selectAll('f')
          .where('x.companyId', '=', ctx.companyId)
          .where('x.loanId', '=', id)
          .where('x.id', '=', attId)
          .executeTakeFirst();
        if (!f) throw new AppError('NOT_FOUND', 404, 'المرفق غير موجود');
        return f;
      });
      const bytes = await readStoredFile(files, file);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(bytes);
    }),
  );
  router.delete(
    '/loans/:id/attachments/:attId',
    requirePermission(`${L}.create`),
    wrap(async (req, res) => {
      const { id, attId } = attParams.parse(req.params);
      await run(req, async (ctx) => {
        const r = await ctx.trx
          .deleteFrom('loanAttachments')
          .where('companyId', '=', ctx.companyId)
          .where('loanId', '=', id)
          .where('id', '=', attId)
          .executeTakeFirst();
        if (!r.numDeletedRows) throw new AppError('NOT_FOUND', 404, 'المرفق غير موجود');
      });
      res.status(204).end();
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
    '/loans/:id/settle',
    requirePermission(`${L}.manage`),
    wrap(async (req, res) => {
      const id = uuid.parse(req.params['id']);
      const b = loanSettleInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const loan = await loanRow(ctx, id);
        if (loan['status'] !== 'active')
          throw new AppError('INVALID_STATE', 409, 'تُسوّى السلفة النشطة فقط');
        const { rows } = await sql<{ id: string; amount: string }>`
          select id, amount::text as amount from loan_installments
           where loan_id = ${id} and status = 'scheduled'
           order by due_year, due_month, no for update`.execute(ctx.trx);
        if (!rows.length) throw new AppError('NOTHING_TO_SETTLE', 409, 'لا أقساط متبقية للتسوية');
        const ids = rows.map((r) => r.id);
        const total = rows.reduce((a, r) => a.plus(num(r.amount)), num(0)).toFixed(4);
        // الأقساط داخل مسودات تُفصل وتُحتسب من جديد؛ والمعتمدة/المقفلة ترفض
        await detachFromDrafts(ctx, ids);
        if (b.mode === 'payroll') {
          // تُدمج في أول قسط بشهر الخصم المختار وتُلغى البقية (تُربط به للتتبع)
          // Merged into the first installment at the chosen month; the rest are cancelled (linked for tracing)
          const [first, ...rest] = rows;
          await sql`update loan_installments
                       set amount = ${total}::numeric, due_year = ${b.targetYear}, due_month = ${b.targetMonth},
                           deferred_reason = ${b.reason}
                     where id = ${first!.id}`.execute(ctx.trx);
          if (rest.length)
            await sql`update loan_installments
                         set status = 'cancelled', deferred_reason = ${b.reason}, moved_to_id = ${first!.id}
                       where id = any(${rest.map((r) => r.id)}::uuid[])`.execute(ctx.trx);
        } else {
          await sql`update loan_installments set status = 'cancelled', deferred_reason = ${b.reason}
                     where id = any(${ids}::uuid[])`.execute(ctx.trx);
          await sql`update loans
                       set settlement_mode = 'cash', settlement_amount = ${total}::numeric,
                           settlement_reference = ${b.reference ?? null}, settlement_note = ${b.reason},
                           settled_at = now(), version = version + 1
                     where id = ${id}`.execute(ctx.trx);
          // دفعة الصرف غير المنفذة بلا معنى بعد إغلاق السلفة
          await sql`delete from payments where loan_id = ${id} and kind = 'loan' and status = 'pending'`.execute(
            ctx.trx,
          );
        }
        await redo(ctx, ids);
        await refreshLoanStatuses(ctx, [id]);
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
