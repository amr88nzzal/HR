import { normalizeRefValue } from '@hrms/shared';

export type PastedPunch = {
  line: number;
  employeeNo: string;
  date: string;
  time: string;
  direction: 'in' | 'out' | null;
  error?: string;
};

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

const toDate = (raw: string): string | null => {
  const s = normalizeRefValue(raw);
  let y: string, m: string, d: string;
  const a = s.match(ISO);
  const b = s.match(DMY);
  if (a) [, y, m, d] = a as unknown as string[] as [string, string, string, string];
  else if (b) [, d, m, y] = b as unknown as string[] as [string, string, string, string];
  else return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
};

const toTime = (raw: string): string | null => {
  const m = normalizeRefValue(raw).match(TIME);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

const toDirection = (raw: string | undefined): 'in' | 'out' | null | undefined => {
  const v = normalizeRefValue(raw ?? '').toLowerCase();
  if (!v) return null;
  if (['in', 'i', '0', 'دخول'].includes(v)) return 'in';
  if (['out', 'o', '1', 'خروج'].includes(v)) return 'out';
  return undefined; // قيمة غير مفهومة
};

/**
 * يحوّل نصاً ملصوقاً من Excel (تبويب أو ; أو ,) إلى بصمات.
 * الأعمدة: رقم الموظف، ثم تاريخ ووقت (عمودان أو عمود واحد "تاريخ وقت")، ثم اتجاه اختياري.
 */
export const parsePunchPaste = (text: string): PastedPunch[] => {
  const out: PastedPunch[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const sep = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ',';
    const cells = raw.split(sep).map((c) => c.trim());
    const employeeNo = normalizeRefValue(cells[0] ?? '');
    let dateRaw = cells[1] ?? '';
    let timeRaw = cells[2] ?? '';
    let dirRaw: string | undefined = cells[3];
    if (/\s/.test(dateRaw.trim()) && !TIME.test(normalizeRefValue(timeRaw))) {
      // عمود واحد "تاريخ وقت": الثالث (إن وُجد) هو الاتجاه
      const [d, ...rest] = dateRaw.trim().split(/\s+/);
      dirRaw = cells[2];
      dateRaw = d ?? '';
      timeRaw = rest.join(' ');
    }
    const date = toDate(dateRaw);
    const time = toTime(timeRaw);
    if (out.length === 0 && i === 0 && (!date || !time) && /[^\d\s:/.\-;,\t]/.test(raw)) return; // ترويسة
    const direction = toDirection(dirRaw);
    const error = !employeeNo
      ? 'employeeNo'
      : !date
        ? 'date'
        : !time
          ? 'time'
          : direction === undefined
            ? 'direction'
            : undefined;
    out.push({
      line: i + 1,
      employeeNo,
      date: date ?? dateRaw,
      time: time ?? timeRaw,
      direction: direction ?? null,
      ...(error ? { error } : {}),
    });
  });
  return out;
};
