import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { wrapLetterHtml } from '@hrms/shared';
import { AppError } from '../../shared/errors.js';
import type { Renderer } from '../letters/index.js';
import type { ReportColumn, Row } from './types.js';

export const EXPORT_FORMATS = ['csv', 'xlsx', 'html', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type Lang = 'ar' | 'en';

/** الحدود: PDF وHTML تُبنى في الذاكرة فتُقيَّد؛ CSV وXLSX تتدفق وتتحمل الكبير */
export const MAX_ROWS: Record<ExportFormat, number> = {
  csv: 100_000,
  xlsx: 100_000,
  html: 5_000,
  pdf: 500,
};
/** أكثر من هذا يُنفَّذ كمهمة خلفية بدل الرد المباشر */
export const DIRECT_ROWS_LIMIT = 2_000;

export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
};

const label = (c: ReportColumn, lang: Lang) => (lang === 'en' ? c.labelEn : c.labelAr);

/** نص الخلية للعرض (CSV وHTML): الـ enum بتسميته */
export const cellText = (c: ReportColumn, v: unknown, lang: Lang): string => {
  if (v === null || v === undefined) return '';
  if (c.type === 'enum') {
    const o = c.options?.find((x) => x.value === v);
    return o ? (lang === 'en' ? o.labelEn : o.labelAr) : String(v);
  }
  return String(v);
};

/** حماية من حقن الصيغ عند فتح الملف في Excel */
const safeText = (s: string): string =>
  /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;

const csvCell = (s: string): string => {
  const safe = safeText(s);
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export type ExportMeta = {
  title: string;
  lang: Lang;
  /** سطر وصف المرشحات المطبّقة (يظهر في HTML/PDF) */
  filtersText: string;
  letterhead?: { header?: string; footer?: string } | undefined;
  render?: Renderer | undefined;
};
export type Built = { buffer: Buffer; rows: number };

const guard = (format: ExportFormat, n: number) => {
  if (n > MAX_ROWS[format])
    throw new AppError(
      'REPORT_TOO_LARGE',
      413,
      `الحد الأقصى لصيغة ${format.toUpperCase()} هو ${MAX_ROWS[format]} صف؛ ضيّق المرشحات أو اختر CSV/Excel`,
    );
};

const buildCsv = async (
  cols: ReportColumn[],
  batches: AsyncIterable<Row[]>,
  lang: Lang,
): Promise<Built> => {
  const chunks: Buffer[] = [
    Buffer.from('﻿' + cols.map((c) => csvCell(label(c, lang))).join(',') + '\r\n'),
  ];
  let rows = 0;
  for await (const batch of batches) {
    rows += batch.length;
    guard('csv', rows);
    chunks.push(
      Buffer.from(
        batch
          .map((r) => cols.map((c) => csvCell(cellText(c, r[c.key], lang))).join(','))
          .join('\r\n') + '\r\n',
      ),
    );
  }
  return { buffer: Buffer.concat(chunks), rows };
};

/** XLSX بكتابة متدفقة إلى ملف مؤقت (لا يُبنى المصنف كله في الذاكرة) */
const buildXlsx = async (
  cols: ReportColumn[],
  batches: AsyncIterable<Row[]>,
  meta: ExportMeta,
): Promise<Built> => {
  const file = path.join(tmpdir(), `report-${randomUUID()}.xlsx`);
  try {
    const stream = createWriteStream(file, { mode: 0o600 });
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
    const ws = wb.addWorksheet(meta.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
      views: [{ rightToLeft: meta.lang === 'ar', state: 'frozen', ySplit: 1 }],
    });
    ws.columns = cols.map((c) => ({
      header: label(c, meta.lang),
      key: c.key,
      width: Math.max(12, Math.min(40, label(c, meta.lang).length + 6)),
      style: c.type === 'money' ? { numFmt: '#,##0.00##' } : {},
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).commit();
    let rows = 0;
    for await (const batch of batches) {
      rows += batch.length;
      guard('xlsx', rows);
      for (const r of batch) {
        ws.addRow(
          cols.map((c) => {
            const v = r[c.key];
            if (v === null || v === undefined) return null;
            if (c.type === 'money' || c.type === 'number') return Number(v);
            return safeText(cellText(c, v, meta.lang));
          }),
        ).commit();
      }
    }
    ws.commit();
    await wb.commit();
    await new Promise<void>((res, rej) => {
      if (stream.writableFinished) res();
      else {
        stream.once('finish', () => res());
        stream.once('error', rej);
      }
    });
    return { buffer: await readFile(file), rows };
  } finally {
    await rm(file, { force: true });
  }
};

export const buildHtmlPage = async (
  cols: ReportColumn[],
  batches: AsyncIterable<Row[]>,
  meta: ExportMeta,
  format: 'html' | 'pdf',
): Promise<{ html: string; rows: number }> => {
  const parts: string[] = [];
  let rows = 0;
  for await (const batch of batches) {
    rows += batch.length;
    guard(format, rows);
    for (const r of batch)
      parts.push(
        `<tr>${cols
          .map(
            (c) =>
              `<td${c.type === 'money' || c.type === 'number' ? ' dir="ltr" style="text-align:end"' : ''}>${esc(cellText(c, r[c.key], meta.lang))}</td>`,
          )
          .join('')}</tr>`,
      );
  }
  const body = `<h2 style="margin:0 0 4px">${esc(meta.title)}</h2>
<div style="font-size:10pt;color:#555;margin-bottom:8px">${esc(meta.filtersText)}</div>
<table style="width:100%;border-collapse:collapse;font-size:10pt">
<style>td,th{border:1px solid #bbb;padding:3px 6px}th{background:#f0f0f0}</style>
<thead><tr>${cols.map((c) => `<th style="text-align:start">${esc(label(c, meta.lang))}</th>`).join('')}</tr></thead>
<tbody>${parts.join('')}</tbody></table>
<div style="font-size:9pt;color:#777;margin-top:6px">${rows}</div>`;
  return { html: wrapLetterHtml(body, meta.lang, meta.letterhead), rows };
};

/** يبني الملف بالصيغة المطلوبة من دفعات الصفوف */
export const buildExport = async (
  format: ExportFormat,
  cols: ReportColumn[],
  batches: AsyncIterable<Row[]>,
  meta: ExportMeta,
): Promise<Built> => {
  switch (format) {
    case 'csv':
      return buildCsv(cols, batches, meta.lang);
    case 'xlsx':
      return buildXlsx(cols, batches, meta);
    case 'html': {
      const { html, rows } = await buildHtmlPage(cols, batches, meta, 'html');
      return { buffer: Buffer.from(html, 'utf8'), rows };
    }
    case 'pdf': {
      if (!meta.render)
        throw new AppError('RENDER_NOT_CONFIGURED', 503, 'خدمة تحويل PDF غير مهيّأة');
      const { html, rows } = await buildHtmlPage(cols, batches, meta, 'pdf');
      return { buffer: await meta.render(html), rows };
    }
  }
};
