/**
 * نواة محرك الإجازات: دوال نقية بلا قاعدة بيانات.
 * كل الكميات بالسنتي (جزء من مئة من اليوم) أعداداً صحيحة لتفادي أخطاء الفاصلة العائمة.
 */

export const toCents = (days: number | string): number => Math.round(Number(days) * 100);
export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

// ---------- التواريخ (نصوص YYYY-MM-DD، حساب UTC) ----------
const parse = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date): string => d.toISOString().slice(0, 10);

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const daysInYear = (year: number): number => (daysInMonth(year, 2) === 29 ? 366 : 365);

/** يضيف أشهراً مع تثبيت اليوم على آخر الشهر الهدف إن لزم (31 يناير + شهر = 28/29 فبراير) */
export const addMonths = (iso: string, months: number): string => {
  const d = parse(iso);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(y, m + 1));
  return fmt(new Date(Date.UTC(y, m, day)));
};

const ymOf = (iso: string): { y: number; m: number; d: number } => ({
  y: Number(iso.slice(0, 4)),
  m: Number(iso.slice(5, 7)),
  d: Number(iso.slice(8, 10)),
});
const pad = (n: number) => String(n).padStart(2, '0');

// ---------- الاستحقاق ----------
export type AccrualPolicy = {
  annualEntitlement: number | string;
  accrualMethod: 'monthly' | 'upfront';
  minServiceMonths: number;
};

export type AccrualDue = {
  /** مفتاح عدم التكرار: YYYY-MM للشهري، YYYY للدفعة الواحدة */
  period: string;
  cents: number;
  effectiveDate: string;
};

/** بداية الاستحقاق الفعلي: تاريخ التعيين + مدة الخدمة الدنيا */
export const accrualStart = (hireDate: string, minServiceMonths: number): string =>
  minServiceMonths > 0 ? addMonths(hireDate, minServiceMonths) : hireDate;

/**
 * الاستحقاقات المستحقة حتى `today` ضمن سنة `today` (تعويض الفائت تلقائياً):
 * - monthly: 1/12 في أول كل شهر، وبالتناسب بأيام الشهر المتبقية لشهر بداية الاستحقاق.
 *   يُوزَّع التراكمي بالتقريب فيجتمع الاستحقاق السنوي بالضبط دون انجراف.
 * - upfront: دفعة واحدة بداية السنة (أو عند بداية الاستحقاق بالتناسب بأيام السنة).
 */
export const dueAccruals = (
  policy: AccrualPolicy,
  hireDate: string,
  today: string,
): AccrualDue[] => {
  const annual = toCents(policy.annualEntitlement);
  if (annual <= 0) return [];
  const start = accrualStart(hireDate, policy.minServiceMonths);
  const t = ymOf(today);
  const s = ymOf(start);
  if (s.y > t.y) return [];

  if (policy.accrualMethod === 'upfront') {
    if (start > today) return [];
    if (s.y < t.y) return [{ period: String(t.y), cents: annual, effectiveDate: `${t.y}-01-01` }];
    const startOrdinal = Math.round((parse(start).getTime() - Date.UTC(t.y, 0, 1)) / 86_400_000);
    const remaining = daysInYear(t.y) - startOrdinal;
    return [
      {
        period: String(t.y),
        cents: Math.round((annual * remaining) / daysInYear(t.y)),
        effectiveDate: start,
      },
    ];
  }

  const cum = (m: number) => Math.round((annual * m) / 12);
  const out: AccrualDue[] = [];
  for (let m = 1; m <= t.m; m += 1) {
    const monthStart = `${t.y}-${pad(m)}-01`;
    // الشهر يستحق عند بدايته، وشهر بداية الاستحقاق عند اليوم نفسه
    if (s.y === t.y && m < s.m) continue;
    const share = cum(m) - cum(m - 1);
    if (s.y === t.y && m === s.m) {
      if (start > today) continue;
      const dim = daysInMonth(t.y, m);
      const remaining = dim - s.d + 1;
      out.push({
        period: `${t.y}-${pad(m)}`,
        cents: Math.round((share * remaining) / dim),
        effectiveDate: start,
      });
    } else {
      out.push({ period: `${t.y}-${pad(m)}`, cents: share, effectiveDate: monthStart });
    }
  }
  return out.filter((a) => a.cents > 0);
};

// ---------- الترحيل ----------
export type CarryOverPolicy = {
  carryOverMax: number | string;
  carryOverValidMonths: number | null;
};

/** عند بداية سنة جديدة: يُرحَّل min(المتبقي القابل للترحيل، السقف)، والباقي ينتهي. */
export const carryOver = (
  carryableCents: number,
  policy: CarryOverPolicy,
  newYear: number,
): { carryCents: number; expiresOn: string | null } => {
  const carryCents = Math.max(0, Math.min(carryableCents, toCents(policy.carryOverMax)));
  const expiresOn =
    carryCents > 0 && policy.carryOverValidMonths
      ? addMonths(`${newYear}-01-01`, policy.carryOverValidMonths)
      : null;
  return { carryCents, expiresOn };
};

// ---------- الاستهلاك FIFO ----------
export type Lot = {
  id: string;
  remainingCents: number;
  effectiveDate: string;
  expiresOn: string | null;
};

/**
 * يوزّع خصماً على الدفعات الأقدم أولاً (بتاريخ السريان ثم الترتيب المعطى).
 * الدفعات المنتهية بتاريخ `onDate` لا تُستعمل. ما لا تغطيه الدفعات يعود في shortfall.
 */
export const allocateFifo = (
  lots: readonly Lot[],
  cents: number,
  onDate: string,
): { allocations: { lotId: string; cents: number }[]; shortfallCents: number } => {
  const usable = lots
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.remainingCents > 0 && (!l.expiresOn || l.expiresOn > onDate))
    .sort((a, b) =>
      a.l.effectiveDate < b.l.effectiveDate
        ? -1
        : a.l.effectiveDate > b.l.effectiveDate
          ? 1
          : a.i - b.i,
    );
  let left = cents;
  const allocations: { lotId: string; cents: number }[] = [];
  for (const { l } of usable) {
    if (left <= 0) break;
    const take = Math.min(left, l.remainingCents);
    allocations.push({ lotId: l.id, cents: take });
    left -= take;
  }
  return { allocations, shortfallCents: left };
};

// ---------- أيام الطلب ----------
export type DayKind = 'work' | 'weekend' | 'holiday';
export type LeaveDay = { date: string; cents: number; kind: DayKind };

export type DayInput = {
  start: string;
  end: string;
  /** أيام الراحة الأسبوعية: 0=الأحد … 6=السبت */
  weeklyOff: readonly number[];
  holidays: ReadonlySet<string>;
  firstDayHalf?: boolean;
  lastDayHalf?: boolean;
};

const MAX_RANGE_DAYS = 366;

/**
 * تفصيل فترة الإجازة إلى أيام: الراحة الأسبوعية والعطل الرسمية لا تُحتسب (0)،
 * وأيام العمل 1.00 مع نصف يوم اختياري في أول/آخر يوم (إن كان يوم عمل).
 */
export const computeLeaveDays = (
  input: DayInput,
): { days: LeaveDay[]; totalCents: number; workDays: number } => {
  if (input.end < input.start) throw new RangeError('END_BEFORE_START');
  const days: LeaveDay[] = [];
  let cursor = parse(input.start);
  const end = parse(input.end);
  while (cursor <= end) {
    if (days.length >= MAX_RANGE_DAYS) throw new RangeError('RANGE_TOO_LONG');
    const date = fmt(cursor);
    const kind: DayKind = input.weeklyOff.includes(cursor.getUTCDay())
      ? 'weekend'
      : input.holidays.has(date)
        ? 'holiday'
        : 'work';
    const half =
      (input.firstDayHalf && date === input.start) || (input.lastDayHalf && date === input.end);
    days.push({ date, kind, cents: kind === 'work' ? (half ? 50 : 100) : 0 });
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  const totalCents = days.reduce((s, d) => s + d.cents, 0);
  return { days, totalCents, workDays: days.filter((d) => d.kind === 'work').length };
};

/** يقسّم الخصم بحسب السنة التقويمية (إجازة تعبر رأس السنة): تاريخ كل جزء = أول يوم محتسب فيه. */
export const splitByYear = (
  days: readonly LeaveDay[],
): { year: number; date: string; cents: number }[] => {
  const out = new Map<number, { year: number; date: string; cents: number }>();
  for (const d of days) {
    if (d.cents <= 0) continue;
    const year = Number(d.date.slice(0, 4));
    const seg = out.get(year);
    if (seg) seg.cents += d.cents;
    else out.set(year, { year, date: d.date, cents: d.cents });
  }
  return [...out.values()].sort((a, b) => a.year - b.year);
};
