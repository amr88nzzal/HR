import type { ExportFormat } from './export.js';
import type { Filters, ReportManifest } from './types.js';

/** اسم الملف الناتج: رمز التقرير + تاريخ اليوم (لاتيني، آمن) */
export const outName = (code: string, format: ExportFormat): string =>
  `${code.replace(/[^A-Za-z0-9_.-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.${format}`;

/** وصف مقروء للمرشحات المطبّقة (لرأس HTML/PDF) */
export const filtersText = (m: ReportManifest, f: Filters, lang: 'ar' | 'en'): string =>
  m.filters
    .flatMap((x) => {
      const v = f[x.key];
      if (!v) return [];
      const opt = x.options?.find((o) => o.value === v);
      const shown = opt ? (lang === 'en' ? opt.labelEn : opt.labelAr) : v;
      return [`${lang === 'en' ? x.labelEn : x.labelAr}: ${shown}`];
    })
    .join(' · ');
