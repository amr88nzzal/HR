import {
  num,
  type PayslipConfig,
  type PayslipHeaderField,
  type PayslipSection,
} from '@hrms/shared';
import { fmtAmount, type Lang, type PayslipDoc } from './payslip-doc.js';

/**
 * بيانات إضافية لرأس القسيمة وأقسامها الاختيارية (تُحمَّل عند الحاجة).
 * Extra data for the header and optional sections (loaded on demand).
 */
export type PayslipExtras = {
  jobTitle: { ar: string; en: string | null } | null;
  department: { ar: string; en: string | null } | null;
  branch: { ar: string; en: string | null } | null;
  hireDate: string | null;
  basicSalary: string | null;
  /** مجموع السنة حتى هذا الشهر / year-to-date through this month */
  ytd: { gross: string; deductions: string; net: string } | null;
  /** نص جاهز بمنطقة الشركة الزمنية / preformatted in the company time zone */
  printedAt: string;
  /** رمز التحقق (صورة data: ورابطه)؛ null = لا عنوان عام مهيّأ / verification QR; null = no public URL configured */
  qr: { dataUrl: string; url: string } | null;
};

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const ltr = (s: string): string => `<span dir="ltr" style="unicode-bidi:isolate">${esc(s)}</span>`;

const T = {
  ar: {
    title: 'قسيمة راتب',
    employeeName: 'الاسم',
    employeeNo: 'الرقم الوظيفي',
    jobTitle: 'الوظيفة',
    department: 'القسم',
    branch: 'الفرع',
    hireDate: 'تاريخ التعيين',
    month: 'الشهر',
    currency: 'العملة',
    basicSalary: 'الراتب الأساسي',
    earnings: 'الدخل',
    deductions: 'الاقتطاعات',
    statement: 'البيان',
    code: 'الرمز',
    amount: 'المبلغ',
    gross: 'إجمالي الدخل',
    totalDed: 'إجمالي الاقتطاعات',
    net: 'صافي الراتب',
    loans: 'قسط السلفة',
    payable: 'المستحق للدفع',
    loanLine: 'السلفة',
    deferred: 'مؤجَّل لعدم كفاية الصافي',
    ytd: 'الأرقام التراكمية للسنة',
    printedAt: 'تاريخ الطباعة',
    signature: 'توقيع الموظف',
    qrCaption: 'امسح الرمز للتحقق من صحة القسيمة',
    date: 'التاريخ',
    defaultNote: 'صدرت هذه القسيمة إلكترونياً.',
  },
  en: {
    title: 'Payslip',
    employeeName: 'Name',
    employeeNo: 'Employee No.',
    jobTitle: 'Job title',
    department: 'Department',
    branch: 'Branch',
    hireDate: 'Hire date',
    month: 'Month',
    currency: 'Currency',
    basicSalary: 'Basic salary',
    earnings: 'Earnings',
    deductions: 'Deductions',
    statement: 'Item',
    code: 'Code',
    amount: 'Amount',
    gross: 'Total earnings',
    totalDed: 'Total deductions',
    net: 'Net salary',
    loans: 'Loan installment',
    payable: 'Payable',
    loanLine: 'Loan',
    deferred: 'Deferred: insufficient net',
    ytd: 'Year-to-date totals',
    printedAt: 'Printed on',
    signature: 'Employee signature',
    qrCaption: 'Scan to verify this payslip',
    date: 'Date',
    defaultNote: 'This payslip was issued electronically.',
  },
} as const;

/** أولوية اللغة: صريحة (?lang) ثم لغة القالب ثم لغة الشركة / precedence: explicit, then template, then company */
export const resolveLang = (
  config: PayslipConfig,
  explicit: Lang | undefined,
  company: Lang,
): Lang => explicit ?? (config.language === 'company' ? company : config.language);

const pick = (v: { ar: string; en: string | null } | null, lang: Lang): string =>
  v ? (lang === 'en' ? v.en || v.ar : v.ar || v.en || '') : '';

/** يبني جسم القسيمة (بلا ترويسة الشركة) من البيانات والإعدادات / builds the payslip body (without letterhead) */
export const renderPayslipBody = (
  d: PayslipDoc,
  extras: PayslipExtras,
  config: PayslipConfig,
  lang: Lang,
): string => {
  const t = T[lang];
  const accent = config.accent;
  const grid = config.borders === 'grid';
  const line = '1px solid #bbb';
  const cell = (extra = '') =>
    `padding:4px 6px;${grid ? `border:${line};` : `border-bottom:${line};`}${extra}`;
  const th = (extra = '') => `${cell(`background:${accent};color:#fff;font-weight:bold;${extra}`)}`;
  const amt = (v: string) => ltr(fmtAmount(v));
  const label = (l: { nameAr: string; nameEn: string | null }) =>
    esc(lang === 'en' ? l.nameEn || l.nameAr : l.nameAr || l.nameEn || '');
  const lines = (list: PayslipDoc['earnings']) =>
    config.hideZeroLines ? list.filter((l) => num(l.amount).gt(0)) : list;
  const earnings = lines(d.earnings);
  const deds = lines(d.deductionLines);
  const tableCss = 'width:100%;border-collapse:collapse;margin-top:10px';

  // ---------- الرأس ----------
  const name = lang === 'en' ? d.nameEn || d.nameAr : d.nameAr || d.nameEn || '';
  const month = `${d.year}-${String(d.month).padStart(2, '0')}`;
  const headerValue: Record<PayslipHeaderField, string> = {
    employeeName: esc(name),
    employeeNo: ltr(d.employeeNo ?? '—'),
    jobTitle: esc(pick(extras.jobTitle, lang) || '—'),
    department: esc(pick(extras.department, lang) || '—'),
    branch: esc(pick(extras.branch, lang) || '—'),
    hireDate: extras.hireDate ? ltr(extras.hireDate) : '—',
    month: ltr(month),
    currency: ltr(d.currency),
    basicSalary: extras.basicSalary ? ltr(`${fmtAmount(extras.basicSalary)} ${d.currency}`) : '—',
  };
  const header = (): string => {
    const per = config.headerColumns;
    const rows: string[] = [];
    for (let i = 0; i < config.headerFields.length; i += per) {
      const cells = config.headerFields
        .slice(i, i + per)
        .map(
          (f) =>
            `<td style="${cell('font-weight:bold;width:18%;background:#f4f4f4')}">${t[f]}</td><td style="${cell()}">${headerValue[f]}</td>`,
        );
      // صف ناقص: نملأ الخلايا كي لا يختل الجدول / pad a short row so the grid stays aligned
      if (cells.length < per) cells.push(`<td style="${cell()}"></td><td style="${cell()}"></td>`);
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<table style="${tableCss}"><tbody>${rows.join('')}</tbody></table>`;
  };

  // ---------- البنود ----------
  const itemRow = (l: PayslipDoc['earnings'][number]) =>
    `<td style="${cell()}">${config.showLineCodes ? `${ltr(l.code)} ` : ''}${label(l)}</td><td style="${cell('text-align:end;width:100px')}">${amt(l.amount)}</td>`;
  const stackedTable = (title: string, list: PayslipDoc['earnings']) =>
    list.length
      ? `<table style="${tableCss}"><thead><tr><th style="${th('text-align:start')}">${esc(title)}</th><th style="${th('text-align:end;width:100px')}">${t.amount}</th></tr></thead><tbody>${list
          .map((l) => `<tr>${itemRow(l)}</tr>`)
          .join('')}</tbody></table>`
      : '';
  const linesSection = (): string => {
    if (config.layout === 'stacked')
      return stackedTable(t.earnings, earnings) + stackedTable(t.deductions, deds);
    const n = Math.max(earnings.length, deds.length);
    const empty = `<td style="${cell()}"></td><td style="${cell()}"></td>`;
    const rows = Array.from(
      { length: n },
      (_, i) =>
        `<tr>${earnings[i] ? itemRow(earnings[i]) : empty}${deds[i] ? itemRow(deds[i]) : empty}</tr>`,
    ).join('');
    return `<table style="${tableCss}"><thead>
<tr><th colspan="2" style="${th('text-align:center')}">${t.earnings}</th><th colspan="2" style="${th('text-align:center')}">${t.deductions}</th></tr>
<tr><th style="${th('background:#e6e6e6;color:#000;text-align:start')}">${t.statement}</th><th style="${th('background:#e6e6e6;color:#000;text-align:end;width:100px')}">${t.amount}</th><th style="${th('background:#e6e6e6;color:#000;text-align:start')}">${t.statement}</th><th style="${th('background:#e6e6e6;color:#000;text-align:end;width:100px')}">${t.amount}</th></tr>
</thead><tbody>${rows}</tbody></table>`;
  };

  // ---------- الإجماليات ----------
  const netBox = `<table style="${tableCss}"><tbody><tr><td style="padding:8px 10px;border:2px solid ${accent};font-weight:bold;font-size:1.2em">${t.net}</td><td style="padding:8px 10px;border:2px solid ${accent};font-weight:bold;font-size:1.2em;text-align:end">${amt(d.net)} ${ltr(d.currency)}</td></tr></tbody></table>`;
  const totalsSection = (): string => {
    const row = (title: string, v: string) =>
      `<tr><td style="${cell('font-weight:bold;background:#f4f4f4')}">${title}</td><td style="${cell('text-align:end;width:140px;font-weight:bold')}">${amt(v)}</td></tr>`;
    const sums =
      config.layout === 'side_by_side'
        ? `<table style="${tableCss}"><tbody><tr><td style="${cell('font-weight:bold;background:#f4f4f4')}">${t.gross}</td><td style="${cell('text-align:end;font-weight:bold')}">${amt(d.gross)}</td><td style="${cell('font-weight:bold;background:#f4f4f4')}">${t.totalDed}</td><td style="${cell('text-align:end;font-weight:bold')}">${amt(d.deductions)}</td></tr></tbody></table>`
        : `<table style="${tableCss}"><tbody>${row(t.gross, d.gross)}${row(t.totalDed, d.deductions)}</tbody></table>`;
    return sums + netBox;
  };

  // ---------- السلف ----------
  const loansSection = (): string => {
    if (!d.loanItems.length) return '';
    const notes = d.loanItems
      .map(
        (i) =>
          `<div style="font-size:0.9em;color:#444;margin-top:2px">${esc(lang === 'ar' ? i.typeNameAr : i.typeNameEn)}${i.reference ? ` ${ltr(esc(i.reference))}` : ''} ${ltr(i.eventDate)}${i.count > 1 ? ` · ${t.loanLine} ${ltr(`${i.no}/${i.count}`)}` : ''}: ${amt(i.amount)}${i.overCap ? ` — ${t.deferred}` : ''}</div>`,
      )
      .join('');
    const row = (title: string, v: string, strong = false) =>
      `<tr><td style="${cell(strong ? 'font-weight:bold' : '')}">${title}</td><td style="${cell(`text-align:end;width:140px;${strong ? 'font-weight:bold' : ''}`)}">${amt(v)}</td></tr>`;
    return `<table style="${tableCss}"><tbody>${row(t.loans, d.loans)}${row(t.payable, d.payable, true)}</tbody></table>${notes}`;
  };

  // ---------- أقسام اختيارية ----------
  const ytdSection = (): string =>
    extras.ytd
      ? `<table style="${tableCss}"><thead><tr><th colspan="2" style="${th('text-align:start')}">${t.ytd}</th></tr></thead><tbody>
<tr><td style="${cell()}">${t.gross}</td><td style="${cell('text-align:end;width:140px')}">${amt(extras.ytd.gross)}</td></tr>
<tr><td style="${cell()}">${t.totalDed}</td><td style="${cell('text-align:end;width:140px')}">${amt(extras.ytd.deductions)}</td></tr>
<tr><td style="${cell('font-weight:bold')}">${t.net}</td><td style="${cell('text-align:end;width:140px;font-weight:bold')}">${amt(extras.ytd.net)}</td></tr></tbody></table>`
      : '';
  const notesSection = (): string => {
    const custom = config.notes[lang] || config.notes[lang === 'ar' ? 'en' : 'ar'];
    return `<p style="font-size:0.9em;color:#555;margin:14px 0 0">${esc(custom || t.defaultNote)}</p>`;
  };
  const signatureSection = (): string =>
    `<table style="${tableCss};margin-top:26px"><tbody><tr><td style="padding:22px 6px 4px;border-top:${line};width:50%">${t.signature}</td><td style="padding:22px 6px 4px;border-top:${line}">${t.date}</td></tr></tbody></table>`;

  const qrSection = (): string =>
    extras.qr
      ? `<table style="${tableCss};margin-top:14px"><tbody><tr><td style="width:96px;padding:0;vertical-align:middle"><img src="${extras.qr.dataUrl}" alt="QR" style="width:90px;height:90px;display:block"/></td><td style="padding:0 10px;font-size:0.85em;color:#555;vertical-align:middle">${t.qrCaption}</td></tr></tbody></table>`
      : '';

  const render: Record<PayslipSection, () => string> = {
    header,
    lines: linesSection,
    totals: totalsSection,
    loans: loansSection,
    ytd: ytdSection,
    notes: notesSection,
    signature: signatureSection,
    qr: qrSection,
  };

  const title = config.title[lang] || config.title[lang === 'ar' ? 'en' : 'ar'] || t.title;
  const printed = config.showPrintedAt
    ? `<div style="font-size:0.85em;color:#555;margin-top:10px">${t.printedAt}: ${ltr(extras.printedAt)}</div>`
    : '';
  const footer =
    config.footer[lang] || config.footer[lang === 'ar' ? 'en' : 'ar']
      ? `<div style="font-size:0.85em;color:#555;margin-top:10px;text-align:center">${esc(config.footer[lang] || config.footer[lang === 'ar' ? 'en' : 'ar'])}</div>`
      : '';
  return `<div style="font-size:${config.fontSize}pt">
<h2 style="text-align:center;margin:0 0 8px;color:${accent}">${esc(title)}</h2>
${config.sections.map((s) => render[s]()).join('\n')}
${printed}${footer}
</div>`;
};
