import { isValidElement, type ReactNode } from 'react';

/** نص العرض من عقدة React (لأعمدة بلا `exportValue`)؛ الأيقونات بلا أطفال تُهمل. */
export const nodeText = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(' ').replace(/\s+/g, ' ').trim();
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
};

const NUM = /^-?\d[\d,]*(\.\d+)?$/;

/** مقارنة للفرز: أرقام كأرقام (بما فيها 1,234.50)، والباقي نصياً بالعربية مع احترام الأرقام. */
export const compareValues = (a: unknown, b: unknown, locale = 'ar'): number => {
  const empty = (v: unknown) => v === null || v === undefined || v === '' || v === '—';
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1; // الفارغ أخيراً
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (NUM.test(sa) && NUM.test(sb))
    return Number(sa.replace(/,/g, '')) - Number(sb.replace(/,/g, ''));
  return sa.localeCompare(sb, locale, { numeric: true, sensitivity: 'base' });
};

export type ColPref = { order: string[]; hidden: string[] };

/** يطبّق التفضيل: المرتّب أولاً ثم الباقي بترتيبه الافتراضي، وتُحذف المخفية (مع إبقاء عمود واحد على الأقل). */
export const applyPrefs = <T extends { key: string }>(cols: T[], pref: ColPref): T[] => {
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const ordered = [
    ...pref.order.map((k) => byKey.get(k)).filter((c): c is T => !!c),
    ...cols.filter((c) => !pref.order.includes(c.key)),
  ];
  const shown = ordered.filter((c) => !pref.hidden.includes(c.key));
  return shown.length ? shown : ordered.slice(0, 1);
};

/** ترتيب كامل بعد نقل عنصر من موضع إلى آخر */
export const moveKey = (keys: string[], from: number, to: number): string[] => {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return keys;
  const next = [...keys];
  const [k] = next.splice(from, 1);
  next.splice(to, 0, k!);
  return next;
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** ترويسة الشركة في أعلى صفحة الطباعة: شعار (data URL) واسم وأسطر تواصل */
export type PrintHeader = { name: string; lines: string[]; logo?: string | null };

const headerHtml = (h: PrintHeader | null | undefined): string =>
  h
    ? `<div class="brand">${h.logo ? `<img src="${esc(h.logo)}" alt="">` : ''}<div><div class="bn">${esc(h.name)}</div>${h.lines
        .filter(Boolean)
        .map((l) => `<div class="bl">${esc(l)}</div>`)
        .join('')}</div></div>`
    : '';

/** صفحة HTML للطباعة (اتجاه RTL، ترويسة بالعنوان والتاريخ) */
export const printHtml = (
  title: string,
  headers: string[],
  rows: string[][],
  opts: { rtl: boolean; date: string; header?: PrintHeader | null },
): string =>
  `<!doctype html><html dir="${opts.rtl ? 'rtl' : 'ltr'}" lang="${opts.rtl ? 'ar' : 'en'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:system-ui,'Segoe UI',Tahoma,sans-serif;margin:24px;color:#111}
h1{font-size:18px;margin:0 0 4px}.meta{color:#666;font-size:12px;margin-bottom:12px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:4px 6px;text-align:start;vertical-align:top}
th{background:#eee}.brand{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:14px}.brand img{max-height:64px;max-width:200px;object-fit:contain}.bn{font-size:17px;font-weight:700}.bl{font-size:11px;color:#444}tr:nth-child(even) td{background:#fafafa}thead{display:table-header-group}tr{page-break-inside:avoid}
@page{margin:12mm}</style></head><body>${headerHtml(opts.header)}<h1>${esc(title)}</h1><div class="meta">${esc(opts.date)} · ${rows.length}</div>
<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></body></html>`;
