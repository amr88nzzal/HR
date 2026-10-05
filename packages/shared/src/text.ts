const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = /[٠-٩]/g;
const EXT_INDIC = /[۰-۹]/g;

/**
 * تطبيع نص للبحث: حذف التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة،
 * تحويل الأرقام الهندية إلى لاتينية، حروف صغيرة، وضغط المسافات.
 */
export const normalizeSearch = (input: string): string =>
  input
    .normalize('NFKC')
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXT_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** صيغة الرقم الوظيفي: تتطلب {seq:N}، وتدعم {yy} و{yyyy}. */
export const EMPLOYEE_NO_FORMAT_RE = /\{seq:([1-9])\}/;

export const isValidEmployeeNoFormat = (format: string): boolean =>
  EMPLOYEE_NO_FORMAT_RE.test(format) && format.length <= 40 && /^[A-Za-z0-9_\-{}:]+$/.test(format);

export const formatEmployeeNo = (format: string, seq: number, now: Date = new Date()): string =>
  format
    .replace(/\{yyyy\}/g, String(now.getUTCFullYear()))
    .replace(/\{yy\}/g, String(now.getUTCFullYear()).slice(-2))
    .replace(/\{seq:([1-9])\}/g, (_m, n: string) => String(seq).padStart(Number(n), '0'));
