import { AppError } from './errors.js';

export type SortSpec = { key: string; column: string; desc: boolean };

/**
 * يحوّل `sort=-net` إلى عمود فعلي من قائمة بيضاء (لا يُمرَّر نص المستخدم إلى SQL أبداً).
 * مفتاح غير معروف: 400.
 */
export const parseSort = (
  sort: string | undefined,
  allowed: Record<string, string>,
  fallback: string,
): SortSpec => {
  const raw = sort ?? fallback;
  const desc = raw.startsWith('-');
  const key = desc ? raw.slice(1) : raw;
  const column = allowed[key];
  if (!column) throw new AppError('VALIDATION_ERROR', 400, 'حقل الفرز غير مدعوم', { sort: raw });
  return { key, column, desc };
};
