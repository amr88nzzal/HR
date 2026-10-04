import { sql, type Transaction } from 'kysely';
import type { Db } from './index.js';
import type { Database } from './types.js';

export type Trx = Transaction<Database>;

/** سياق الطلب: يُمرَّر أول معامل لكل خدمة. */
export type Ctx = {
  trx: Trx;
  companyId: string;
  userId: string | null;
  requestId: string;
};

export type TenantScope = { companyId: string; userId?: string | null; requestId?: string };

/**
 * ينفّذ العمل داخل معاملة تضبط سياق RLS (app.company_id / app.user_id)
 * لمدة المعاملة فقط، فلا يتسرّب بين طلبات المجمّع (pool).
 */
export const withTenant = <T>(
  db: Db,
  scope: TenantScope,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> =>
  db.transaction().execute(async (trx) => {
    const userId = scope.userId ?? null;
    const requestId = scope.requestId ?? '';
    await sql`select set_config('app.company_id', ${scope.companyId}, true),
                     set_config('app.user_id', ${userId ?? ''}, true),
                     set_config('app.request_id', ${requestId}, true)`.execute(trx);
    return fn({ trx, companyId: scope.companyId, userId, requestId });
  });
