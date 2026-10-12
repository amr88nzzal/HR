import { normalizeRefValue } from '@hrms/shared';

export type ColumnRef = number | string | null;
export type ParseProfile = {
  delimiter: string;
  encoding: 'auto' | 'utf-8' | 'windows-1256';
  hasHeader: 'auto' | 'yes' | 'no';
  columns: {
    branch: ColumnRef;
    department: ColumnRef;
    employee: ColumnRef;
    datetime: ColumnRef;
    type: ColumnRef;
  };
  dateOrder: 'auto' | 'ymd' | 'dmy' | 'mdy';
  directionMode: 'type' | 'ignore';
  inValues: string[];
  outValues: string[];
};

export const DEFAULT_PROFILE: ParseProfile = {
  delimiter: ';',
  encoding: 'auto',
  hasHeader: 'auto',
  columns: { branch: 0, department: 1, employee: 2, datetime: 3, type: 4 },
  dateOrder: 'auto',
  directionMode: 'type',
  inValues: ['0', 'in', 'i'],
  outValues: ['1', 'out', 'o'],
};

export type ParsedRow = {
  line: number;
  branch: string | null;
  department: string | null;
  employee: string;
  /** تاريخ محلي YYYY-MM-DD ووقت HH:MM (الثواني تُهمل) */
  date: string;
  time: string;
  direction: 'in' | 'out' | null;
};
export type ParseError = { line: number; message: string };
export type ParseResult = {
  encoding: 'utf-8' | 'windows-1256';
  hasHeader: boolean;
  total: number;
  rows: ParsedRow[];
  errors: ParseError[];
};

/** UTF-8 إن كان صالحاً وإلا Windows-1256 (أجهزة البصمة العربية القديمة). */
export const decodeText = (
  buf: Buffer,
  encoding: ParseProfile['encoding'],
): { text: string; encoding: 'utf-8' | 'windows-1256' } => {
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  if (encoding !== 'windows-1256') {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
    } catch {
      if (encoding === 'utf-8') throw new Error('الملف ليس UTF-8 صالحاً');
    }
  }
  return { text: new TextDecoder('windows-1256').decode(body), encoding: 'windows-1256' };
};

/** يقسم سطراً بفاصل مع دعم علامات الاقتباس المزدوجة. */
export const splitLine = (line: string, delimiter: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

const pad2 = (n: string) => n.padStart(2, '0');

/** يفسّر "تاريخ وقت" بالترتيب المطلوب؛ يعيد null إن لم يصلح. */
export const parseDateTime = (
  raw: string,
  order: ParseProfile['dateOrder'],
): { date: string; time: string } | null => {
  const m = normalizeRefValue(raw).match(
    /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/,
  );
  if (!m) return null;
  const [, a, b, c, hh, mi] = m as unknown as string[] as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const ord = order === 'auto' ? (a.length === 4 ? 'ymd' : 'dmy') : order;
  let y: string, mo: string, d: string;
  if (ord === 'ymd') [y, mo, d] = [a, b, c];
  else if (ord === 'dmy') [d, mo, y] = [a, b, c];
  else [mo, d, y] = [a, b, c];
  if (y.length !== 4) return null;
  const date = `${y}-${pad2(mo)}-${pad2(d)}`;
  const t = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date) return null;
  if (Number(hh) > 23 || Number(mi) > 59) return null;
  return { date, time: `${pad2(hh)}:${mi}` };
};

const directionOf = (raw: string | undefined, p: ParseProfile): 'in' | 'out' | null => {
  if (p.directionMode === 'ignore' || !raw) return null;
  const v = normalizeRefValue(raw).toLowerCase();
  if (p.inValues.some((x) => x.toLowerCase() === v)) return 'in';
  if (p.outValues.some((x) => x.toLowerCase() === v)) return 'out';
  return null;
};

export const parseCsv = (buf: Buffer, profile: ParseProfile): ParseResult => {
  const { text, encoding } = decodeText(buf, profile.encoding);
  const lines = text.split(/\r?\n/);
  const cells = lines.map((l, i) => ({ line: i + 1, raw: l })).filter((l) => l.raw.trim() !== '');
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];
  if (cells.length === 0) return { encoding, hasHeader: false, total: 0, rows, errors };

  const split = (l: string) => splitLine(l, profile.delimiter);
  const dtIsName = typeof profile.columns.datetime === 'string';
  const first = split(cells[0]!.raw);
  const firstDt = !dtIsName ? first[profile.columns.datetime as number] : undefined;
  const hasHeader =
    profile.hasHeader === 'yes'
      ? true
      : profile.hasHeader === 'no'
        ? false
        : dtIsName || !firstDt || !parseDateTime(firstDt, profile.dateOrder);

  const headerNames = hasHeader ? first.map((h) => normalizeRefValue(h).toLowerCase()) : [];
  const indexOf = (ref: ColumnRef): number | null => {
    if (ref === null) return null;
    if (typeof ref === 'number') return ref;
    const i = headerNames.indexOf(ref.toLowerCase());
    return i === -1 ? -1 : i;
  };
  const idx = {
    branch: indexOf(profile.columns.branch),
    department: indexOf(profile.columns.department),
    employee: indexOf(profile.columns.employee),
    datetime: indexOf(profile.columns.datetime),
    type: indexOf(profile.columns.type),
  };
  if (idx.employee === null || idx.employee < 0 || idx.datetime === null || idx.datetime < 0)
    throw new Error('عمودا الموظف والتاريخ غير موجودين في الملف حسب ملف الاستيراد');

  const data = hasHeader ? cells.slice(1) : cells;
  const cell = (parts: string[], i: number | null): string | undefined =>
    i === null || i < 0 ? undefined : parts[i];
  for (const { line, raw } of data) {
    const parts = split(raw);
    const employee = normalizeRefValue(cell(parts, idx.employee) ?? '');
    if (!employee) {
      errors.push({ line, message: 'رمز الموظف فارغ' });
      continue;
    }
    const dt = parseDateTime(cell(parts, idx.datetime) ?? '', profile.dateOrder);
    if (!dt) {
      errors.push({ line, message: 'تاريخ/وقت غير صالح' });
      continue;
    }
    const br = normalizeRefValue(cell(parts, idx.branch) ?? '');
    const dp = normalizeRefValue(cell(parts, idx.department) ?? '');
    rows.push({
      line,
      branch: br || null,
      department: dp || null,
      employee,
      ...dt,
      direction: directionOf(cell(parts, idx.type), profile),
    });
  }
  return { encoding, hasHeader, total: data.length, rows, errors };
};
