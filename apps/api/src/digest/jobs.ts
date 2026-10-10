import { z } from 'zod';
import { sql } from 'kysely';
import type { Ctx } from '../db/tenant.js';
import { defineJob } from '../jobs/types.js';
import { createNotifier } from '../notifications/service.js';

/** ساعة الإرسال بتوقيت الشركة؛ المهمة تعمل كل ساعة وتتجاوز ما قبلها (وتلحق إن فات الموعد) */
export const DIGEST_HOUR = 8;
/** أفق التذكير بالوثائق القادمة (أيام) */
export const DIGEST_LOOKAHEAD_DAYS = 30;
const MAX_LINES = 5;

type Locale = 'ar' | 'en';
const T = {
  ar: {
    overdue: (n: number) => `وثائق متأخرة: ${n}`,
    soon: (n: number, days: number) => `وثائق تستحق خلال ${days} يوماً: ${n}`,
    approvals: (n: number) => `طلبات موافقة بانتظار إجرائك: ${n}`,
    more: (n: number) => `…و${n} أخرى`,
  },
  en: {
    overdue: (n: number) => `Overdue documents: ${n}`,
    soon: (n: number, days: number) => `Documents due within ${days} days: ${n}`,
    approvals: (n: number) => `Approval requests awaiting you: ${n}`,
    more: (n: number) => `…and ${n} more`,
  },
} as const;

type Item = { typeName: string; owner: string | null; dueDate: string };

/** تذكيرات الأرشيف المعلّقة: المتأخرة والقادمة ضمن الأفق (على مستوى الشركة) */
const loadArchive = async (ctx: Ctx, locale: Locale) => {
  const today = (
    await sql<{ d: string }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx)
  ).rows[0]?.d as string;
  const { rows } = await sql<{
    dueDate: string;
    typeName: string;
    owner: string | null;
    overdue: boolean;
  }>`
    select r.due_date::text as due_date,
           case when ${locale} = 'en' then coalesce(t.name_en, t.name_ar) else t.name_ar end as type_name,
           case d.owner_type
             when 'employee' then (select case when ${locale} = 'en' then coalesce(e.full_name_en, e.full_name_ar) else e.full_name_ar end from employees e where e.id = d.owner_id)
             when 'branch' then (select case when ${locale} = 'en' then coalesce(b.name_en, b.name_ar) else b.name_ar end from branches b where b.id = d.owner_id)
             else null end as owner,
           (r.due_date < ${today}::date) as overdue
      from document_reminders r
      join documents d on d.id = r.document_id and d.status = 'active'
      join document_types t on t.id = d.document_type_id
     where r.company_id = ${ctx.companyId}
       and r.status = 'pending'
       and r.due_date <= (${today}::date + ${DIGEST_LOOKAHEAD_DAYS}::int)
     order by r.due_date, r.id`.execute(ctx.trx);
  const overdue = rows.filter((r) => r.overdue);
  const soon = rows.filter((r) => !r.overdue);
  const lines = (list: typeof rows): Item[] =>
    list
      .slice(0, MAX_LINES)
      .map((r) => ({ typeName: r.typeName, owner: r.owner, dueDate: r.dueDate }));
  return {
    overdue: overdue.length,
    soon: soon.length,
    items: [...lines(overdue), ...lines(soon)].slice(0, MAX_LINES),
    total: rows.length,
  };
};

/** المستخدمون الفعّالون الذين يملكون قراءة الأرشيف بنطاق الشركة (يرون كل التذكيرات) */
const archiveRecipients = async (ctx: Ctx): Promise<Set<string>> => {
  const { rows } = await sql<{ id: string }>`
    select distinct u.id
      from users u
      join user_role_assignments a on a.user_id = u.id and a.scope_type = 'company'
      join role_permissions rp on rp.role_id = a.role_id
      join permissions p on p.id = rp.permission_id and p.code = 'archive.document.read'
     where u.company_id = ${ctx.companyId} and u.status = 'active'`.execute(ctx.trx);
  return new Set(rows.map((r) => r.id));
};

/** عدد طلبات الموافقة المعلقة لدى كل مستخدم */
const pendingApprovals = async (ctx: Ctx): Promise<Map<string, number>> => {
  const { rows } = await sql<{ userId: string; n: string }>`
    select a.user_id, count(distinct r.id)::text as n
      from approval_requests r
      join approval_request_assignees a
        on a.request_id = r.id and a.position = r.current_position and a.status = 'pending'
     where r.company_id = ${ctx.companyId} and r.status = 'pending'
     group by a.user_id`.execute(ctx.trx);
  return new Map(rows.map((r) => [r.userId, Number(r.n)]));
};

/**
 * الملخص اليومي: إشعار واحد لكل مستخدم عنده ما يستحق الذكر (وثائق متأخرة/قادمة، طلبات موافقة).
 * لا يرسل مرتين في اليوم نفسه (بتوقيت الشركة) ولا قبل ساعة الإرسال.
 */
export const digestJobs = () => [
  defineJob({
    name: 'digest.daily',
    queue: 'bulk',
    // minHour: للاختبارات وللتشغيل اليدوي فقط
    parse: (d) =>
      z
        .object({ minHour: z.number().int().min(0).max(23).optional() })
        .strict()
        .parse(d ?? {}),
    handle: async (ctx, data, info) => {
      const company = await ctx.trx
        .selectFrom('companies')
        .select(['defaultLocale', 'timezone'])
        .where('id', '=', ctx.companyId)
        .executeTakeFirstOrThrow();
      const hour = Number(
        (
          await sql<{
            h: string;
          }>`select extract(hour from now() at time zone ${company.timezone})::int::text as h`.execute(
            ctx.trx,
          )
        ).rows[0]?.h,
      );
      if (hour < (data.minHour ?? DIGEST_HOUR)) return { skipped: 'before_hour' };

      const locale: Locale = company.defaultLocale === 'en' ? 'en' : 'ar';
      const tx = T[locale];
      const archive = await loadArchive(ctx, locale);
      const recipients = await archiveRecipients(ctx);
      const approvals = await pendingApprovals(ctx);
      const users = new Set([...(archive.total ? recipients : []), ...approvals.keys()]);
      if (!users.size) return { sent: 0 };

      const already = await sql<{ userId: string }>`
        select distinct user_id from notifications
         where company_id = ${ctx.companyId} and event_key = 'digest.daily'
           and (created_at at time zone ${company.timezone})::date = company_today(${ctx.companyId})`.execute(
        ctx.trx,
      );
      const done = new Set(already.rows.map((r) => r.userId));
      const names = await ctx.trx
        .selectFrom('users')
        .select(['id', 'displayName'])
        .where('companyId', '=', ctx.companyId)
        .where('id', 'in', [...users])
        .execute();
      const notifier = createNotifier(info.queue);

      let sent = 0;
      for (const u of names) {
        if (done.has(u.id)) continue;
        const lines: string[] = [];
        const showArchive = recipients.has(u.id) && archive.total > 0;
        if (showArchive) {
          if (archive.overdue) lines.push(tx.overdue(archive.overdue));
          if (archive.soon) lines.push(tx.soon(archive.soon, DIGEST_LOOKAHEAD_DAYS));
          for (const it of archive.items)
            lines.push(`• ${it.typeName}${it.owner ? ` — ${it.owner}` : ''} — ${it.dueDate}`);
          if (archive.total > archive.items.length)
            lines.push(tx.more(archive.total - archive.items.length));
        }
        const pending = approvals.get(u.id) ?? 0;
        if (pending) lines.push(tx.approvals(pending));
        if (!lines.length) continue;
        await notifier.notify(ctx, {
          userId: u.id,
          event: 'digest.daily',
          vars: { user: u.displayName, summary: lines.join('\n') },
          link: pending && !showArchive ? '/approvals' : '/archive/documents',
          data: { archive: showArchive ? archive.total : 0, approvals: pending },
        });
        sent += 1;
      }
      return { sent };
    },
  }),
];
