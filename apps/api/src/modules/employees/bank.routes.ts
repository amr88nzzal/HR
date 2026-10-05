import { Router, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { bankAccountInput, childUpdateInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { AppError } from '../../shared/errors.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import { requirePermission } from '../identity/index.js';
import { assertEmployeeVisible } from './access.js';
import { idOf, makeRun } from './children.routes.js';

const AAD = 'employee_bank_accounts.iban';
const updateSchema = childUpdateInput(bankAccountInput.shape).extend({
  iban: bankAccountInput.shape.iban.optional(),
});

/** عرض آمن: القيمة مقنّعة دائماً؛ المشفّر والبصمة لا يخرجان من الخادم. */
const view = (r: Record<string, unknown>) => ({
  id: r['id'],
  employeeId: r['employeeId'],
  bankName: r['bankName'],
  accountHolder: r['accountHolder'],
  ibanMasked: r['ibanMasked'],
  currency: r['currency'],
  isPrimary: r['isPrimary'],
  validFrom: r['validFrom'],
  validTo: r['validTo'],
  version: r['version'],
  createdAt: r['createdAt'],
});

export const maskIban = (iban: string): string =>
  `${iban.slice(0, 2)}${'•'.repeat(Math.max(iban.length - 6, 4))}${iban.slice(-4)}`;

export const createBankRouter = (
  db: Db,
  authenticate: RequestHandler,
  crypto: FieldCrypto | undefined,
): Router => {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  const run = makeRun(db);
  const needCrypto = (): FieldCrypto => {
    if (!crypto)
      throw new AppError('ENCRYPTION_NOT_CONFIGURED', 503, 'التشفير غير مهيّأ على الخادم');
    return crypto;
  };
  const READ = 'employees.bank_account.read';
  const MANAGE = 'employees.bank_account.manage';
  const REVEAL = 'employees.bank_account.reveal';

  const clearPrimary = async (
    ctx: Parameters<Parameters<typeof run>[1]>[0],
    employeeId: string,
    exceptId?: string,
  ) => {
    let q = ctx.trx
      .updateTable('employeeBankAccounts')
      .set({ isPrimary: false })
      .where('employeeId', '=', employeeId)
      .where('isPrimary', '=', true);
    if (exceptId) q = q.where('id', '!=', exceptId);
    await q.execute();
  };

  router.get('/', requirePermission(READ), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const rows = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, READ);
        return ctx.trx
          .selectFrom('employeeBankAccounts')
          .selectAll()
          .where('employeeId', '=', employeeId)
          .orderBy('isPrimary', 'desc')
          .orderBy('createdAt')
          .execute();
      });
      res.json({ data: rows.map(view) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const { iban, ...input } = bankAccountInput.parse(req.body);
      const c = needCrypto();
      const row = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        if (input.isPrimary) await clearPrimary(ctx, employeeId);
        return ctx.trx
          .insertInto('employeeBankAccounts')
          .values({
            companyId: ctx.companyId,
            employeeId,
            bankName: input.bankName,
            accountHolder: input.accountHolder ?? null,
            currency: input.currency,
            isPrimary: input.isPrimary,
            validFrom: input.validFrom ?? null,
            validTo: input.validTo ?? null,
            ibanEnc: c.encrypt(iban, AAD),
            ibanDigest: c.digest(iban),
            ibanMasked: maskIban(iban),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      res.status(201).json({ data: view(row) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      const { version, iban, ...changes } = updateSchema.parse(req.body);
      const row = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const current = await ctx.trx
          .selectFrom('employeeBankAccounts')
          .select(['id', 'isPrimary'])
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!current) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
        const defined = Object.fromEntries(
          Object.entries(changes).filter(([, v]) => v !== undefined),
        );
        if (changes.isPrimary) await clearPrimary(ctx, employeeId, id);
        const ibanCols = iban
          ? {
              ibanEnc: needCrypto().encrypt(iban, AAD),
              ibanDigest: needCrypto().digest(iban),
              ibanMasked: maskIban(iban),
            }
          : {};
        const updated = await ctx.trx
          .updateTable('employeeBankAccounts')
          .set({ ...defined, ...ibanCols, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!updated)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        if (iban) {
          await ctx.trx
            .insertInto('auditLogs')
            .values({
              companyId: ctx.companyId,
              userId: ctx.userId,
              entityType: 'employee_bank_accounts',
              entityId: id,
              action: 'iban_changed',
              changes: JSON.stringify({ masked: maskIban(iban) }),
              requestId: ctx.requestId,
              ip: null,
            })
            .execute();
        }
        return updated;
      });
      res.json({ data: view(row) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(MANAGE), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, MANAGE);
        const r = await ctx.trx
          .deleteFrom('employeeBankAccounts')
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!r.numDeletedRows) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // كشف الرقم الكامل: صلاحية مستقلة ويُسجَّل في التدقيق دائماً
  router.post('/:id/reveal', requirePermission(REVEAL), async (req, res, next) => {
    try {
      const employeeId = idOf(req.params['employeeId']);
      const id = idOf(req.params['id']);
      const c = needCrypto();
      const iban = await run(req, async (ctx, auth) => {
        await assertEmployeeVisible(ctx, auth, employeeId, REVEAL);
        const row = await ctx.trx
          .selectFrom('employeeBankAccounts')
          .select(['id', 'ibanEnc'])
          .where('id', '=', id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!row) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
        await ctx.trx
          .insertInto('auditLogs')
          .values({
            companyId: ctx.companyId,
            userId: ctx.userId,
            entityType: 'employee_bank_accounts',
            entityId: id,
            action: 'reveal',
            changes: JSON.stringify({ field: 'iban', employeeId }),
            requestId: ctx.requestId,
            ip: req.ip ?? null,
          })
          .execute();
        return c.decrypt(row.ibanEnc, AAD);
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { iban } });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
