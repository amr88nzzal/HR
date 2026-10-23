import { z } from 'zod';

/** معرّف الجدول في الواجهة (مثل `employees` أو `payroll.slips`) */
export const tableIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/);
const colKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);

/** تفضيلات المستخدم لجدول: ترتيب الأعمدة والمخفي منها */
export const tablePrefInput = z.object({
  order: z.array(colKey).max(100).default([]),
  hidden: z.array(colKey).max(100).default([]),
});
export type TablePref = z.infer<typeof tablePrefInput>;

/**
 * تفضيلات القائمة الجانبية لكل مستخدم: وضع العرض، ترتيب المجموعات والعناصر، المخفي، والمفضلة.
 * القيم مفاتيح مجموعات ومسارات عناصر؛ ما لا يعرفه النظام (عنصر حُذف/بلا صلاحية) يُتجاهل عند التطبيق.
 * Per-user sidebar preferences: display mode, group/item order, hidden items and favourites.
 * Values are group keys and item paths; anything unknown (removed / no permission) is ignored on apply.
 */
const navKey = z.string().regex(/^[A-Za-z0-9/_.:-]{1,80}$/);
export const NAV_MODES = ['full', 'icons', 'hidden'] as const;
export const navPrefInput = z.object({
  mode: z.enum(NAV_MODES).default('full'),
  groupOrder: z.array(navKey).max(100).default([]),
  itemOrder: z.record(navKey, z.array(navKey).max(100)).default({}),
  hidden: z.array(navKey).max(300).default([]),
  favorites: z.array(navKey).max(12).default([]),
});
export type NavPref = z.infer<typeof navPrefInput>;
