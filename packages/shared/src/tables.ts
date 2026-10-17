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
