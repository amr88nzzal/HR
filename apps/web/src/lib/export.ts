import type { ApiClient } from '../api/client';
import { api as defaultApi } from '../api/client';

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // حماية من حقن الصيغ عند الفتح في Excel
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV بـ BOM ليفتحه Excel بالعربية صحيحاً. */
export const toCsv = <T>(columns: ExportColumn<T>[], rows: T[]): string =>
  '﻿' +
  [
    columns.map((c) => csvCell(c.header)).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(',')),
  ].join('\r\n');

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportCsv = <T>(fileName: string, columns: ExportColumn<T>[], rows: T[]): void =>
  downloadBlob(
    new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }),
    `${fileName}.csv`,
  );

/** Excel (يُحمَّل عند الحاجة فقط حتى لا يثقل الحزمة الرئيسية). */
export const exportXlsx = async <T>(
  fileName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  rtl: boolean,
): Promise<void> => {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [
    columns.map((c) => ({ value: c.header, fontWeight: 'bold' as const })),
    ...rows.map((r) =>
      columns.map((c) => {
        const v = c.value(r);
        return v === null || v === undefined
          ? null
          : typeof v === 'number' || typeof v === 'boolean'
            ? v
            : String(v);
      }),
    ),
  ];
  await writeXlsxFile(data as never, { rightToLeft: rtl }).toFile(`${fileName}.xlsx`);
};

/** يجلب كل صفحات قائمة (حتى سقف) لأجل التصدير. */
export const fetchAllRows = async <T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  client: ApiClient = defaultApi,
  cap = 20_000,
): Promise<T[]> => {
  const out: T[] = [];
  for (let page = 1; out.length < cap; page += 1) {
    const res = await client.get<T[]>(path, { ...query, page, pageSize: 200 });
    out.push(...res.data);
    const total = Number((res.meta as { total?: number } | undefined)?.total ?? 0);
    if (res.data.length === 0 || out.length >= total) break;
  }
  return out;
};
