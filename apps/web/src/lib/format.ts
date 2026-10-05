export type FormatSettings = {
  locale: 'ar' | 'en';
  timezone: string;
  calendar: 'gregorian' | 'hijri';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  timeFormat: '12h' | '24h';
  weekStart: number;
  numberDigits: 'western' | 'arabic';
  decimalSeparator: '.' | ',';
  thousandsSeparator: ',' | '.' | ' ' | '';
};

export const DEFAULT_FORMAT: FormatSettings = {
  locale: 'ar',
  timezone: 'Asia/Riyadh',
  calendar: 'gregorian',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12h',
  weekStart: 6,
  numberDigits: 'western',
  decimalSeparator: '.',
  thousandsSeparator: ',',
};

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const localizeDigits = (text: string, s: Pick<FormatSettings, 'numberDigits'>): string =>
  s.numberDigits === 'arabic'
    ? text.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] as string)
    : text;

const parts = (d: Date, s: FormatSettings, opts: Intl.DateTimeFormatOptions) => {
  const cal = s.calendar === 'hijri' ? 'islamic-umalqura' : 'gregory';
  const fmt = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, {
    timeZone: s.timezone,
    hourCycle: 'h23',
    ...opts,
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >;
};

const pad = (v: string | number, n = 2) => String(v).padStart(n, '0');

/** تاريخ بصيغة الإعدادات (ميلادي أو هجري) في منطقة الشركة الزمنية. */
export const formatDate = (
  value: string | Date | null | undefined,
  s: FormatSettings = DEFAULT_FORMAT,
): string => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d, s, { day: 'numeric', month: 'numeric', year: 'numeric' });
  const day = pad(p['day'] ?? '');
  const month = pad(p['month'] ?? '');
  const year = pad(p['year'] ?? '', 4);
  const out =
    s.dateFormat === 'YYYY-MM-DD'
      ? `${year}-${month}-${day}`
      : s.dateFormat === 'MM/DD/YYYY'
        ? `${month}/${day}/${year}`
        : `${day}/${month}/${year}`;
  return localizeDigits(out, s);
};

export const formatTime = (
  value: string | Date | null | undefined,
  s: FormatSettings = DEFAULT_FORMAT,
): string => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d, s, { hour: 'numeric', minute: 'numeric' });
  const h24 = Number(p['hour']);
  const minute = pad(p['minute'] ?? '');
  if (s.timeFormat === '24h') return localizeDigits(`${pad(h24)}:${minute}`, s);
  const suffix = h24 < 12 ? (s.locale === 'ar' ? 'ص' : 'AM') : s.locale === 'ar' ? 'م' : 'PM';
  return localizeDigits(`${h24 % 12 === 0 ? 12 : h24 % 12}:${minute} ${suffix}`, s);
};

export const formatDateTime = (
  value: string | Date | null | undefined,
  s: FormatSettings = DEFAULT_FORMAT,
): string => (value ? `${formatDate(value, s)} ${formatTime(value, s)}` : '');

/** رقم/مبلغ نصي عشري بدقة كاملة (لا تحويل لـ Number للمبالغ الكبيرة): الفواصل والأرقام حسب الإعدادات. */
export const formatNumber = (
  value: string | number | null | undefined,
  decimals: number,
  s: FormatSettings = DEFAULT_FORMAT,
): string => {
  if (value === null || value === undefined || value === '') return '';
  const fixed =
    typeof value === 'number' ? value.toFixed(decimals) : roundDecimalString(value, decimals);
  const negative = fixed.startsWith('-');
  const [intPart = '0', frac] = fixed.replace('-', '').split('.');
  const grouped = s.thousandsSeparator
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, s.thousandsSeparator)
    : intPart;
  const text = `${negative ? '-' : ''}${grouped}${frac ? s.decimalSeparator + frac : ''}`;
  return localizeDigits(text, s);
};

/** تقريب نصي (نصف لأعلى) دون المرور بـ float. */
const roundDecimalString = (value: string, decimals: number): string => {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const neg = value.startsWith('-');
  const [i = '0', f = ''] = value.replace('-', '').split('.');
  if (f.length <= decimals)
    return `${neg ? '-' : ''}${i}${decimals ? '.' + f.padEnd(decimals, '0') : ''}`;
  const keep = BigInt(i + f.slice(0, decimals));
  const up = (f.charCodeAt(decimals) ?? 48) >= 53 ? 1n : 0n;
  const r = (keep + up).toString().padStart(decimals + 1, '0');
  const body = decimals ? `${r.slice(0, -decimals)}.${r.slice(-decimals)}` : r;
  return `${neg ? '-' : ''}${body}`;
};
