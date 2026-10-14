import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import QRCode from 'qrcode';
import type { Ctx } from '../../db/tenant.js';

/** الرقم التالي: رمز-سنة-000123 (تسلسل سنوي لكل قالب، ذرّي عبر upsert). */
export const nextDocNumber = async (ctx: Ctx, templateCode: string): Promise<string> => {
  const { rows: y } = await sql<{ y: number }>`
    select extract(year from company_today(${ctx.companyId}))::int as y`.execute(ctx.trx);
  const year = y[0]?.y as number;
  const key = `letter:${templateCode}:${year}`;
  const { rows } = await sql<{ n: string }>`
    insert into numbering_sequences (company_id, key, next_value)
    values (${ctx.companyId}, ${key}, 2)
    on conflict (company_id, key)
    do update set next_value = numbering_sequences.next_value + 1
    returning (next_value - 1)::text as n`.execute(ctx.trx);
  return `${templateCode}-${year}-${String(rows[0]?.n).padStart(6, '0')}`;
};

/** رمز تحقق عشوائي طويل لا يمكن تخمينه (192 بت). */
export const newVerifyToken = (): string => randomBytes(24).toString('base64url');

export const verifyUrlOf = (publicUrl: string | undefined, token: string): string | null =>
  publicUrl ? `${publicUrl.replace(/\/$/, '')}/verify/${token}` : null;

export const qrDataUrl = (url: string): Promise<string> =>
  QRCode.toDataURL(url, { margin: 0, width: 220, errorCorrectionLevel: 'M' });

/** يقنّع الاسم: أول حرفين من كل كلمة ثم *** (لا كشف كامل لحامل الرابط). */
export const maskName = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => `${Array.from(w).slice(0, 2).join('')}***`)
    .join(' ');
