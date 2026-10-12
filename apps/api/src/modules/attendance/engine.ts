/**
 * محرك الحضور (نقي بلا قاعدة بيانات). كل الأزمنة بالدقائق من منتصف ليل يوم الحضور المحلي؛
 * قد تكون سالبة (قبل منتصف الليل) أو أكبر من 1440 (بعده) للدوام الليلي.
 */
export type Segment = { start: number; end: number };

export type Punch<T = unknown> = { minute: number; direction: 'in' | 'out' | null; ref: T };

export type DayKind = 'none' | 'off' | 'work';

export type DayInput<T = unknown> = {
  /** none = لا جدول، off = راحة بالجدول، work = يوم عمل */
  kind: DayKind;
  segments: Segment[];
  lateGrace: number;
  earlyLeaveGrace: number;
  holiday: boolean;
  /** أيام الإجازة المعتمدة لهذا اليوم (1 = كاملة، 0.5 = نصف) */
  leaveUnits: number;
  /** اليوم مضى كاملاً (فغياب البصمة غياب؛ وإلا بانتظار) */
  isPast: boolean;
  punches: Punch<T>[];
};

export type DayStatus =
  'present' | 'absent' | 'leave' | 'holiday' | 'off' | 'unscheduled' | 'incomplete' | 'pending';

export type DayResult<T = unknown> = {
  status: DayStatus;
  scheduledMinutes: number;
  firstIn: Punch<T> | null;
  lastOut: Punch<T> | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  surplusMinutes: number;
};

/** أطول فترة بين الدخول والخروج تُقبل؛ ما فوقها يُعدّ بصمة ناقصة/خاطئة */
export const MAX_SPAN_MINUTES = 18 * 60;

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** أول دخول وآخر خروج: باحترام النوع إن وُجد، وإلا الأولى دخول والأخيرة خروج. */
export const pair = <T>(punches: Punch<T>[]): { inP: Punch<T> | null; outP: Punch<T> | null } => {
  const sorted = [...punches].sort((a, b) => a.minute - b.minute);
  if (sorted.length === 0) return { inP: null, outP: null };
  const hasType = sorted.some((p) => p.direction !== null);
  if (hasType) {
    const ins = sorted.filter((p) => p.direction === 'in');
    const outs = sorted.filter((p) => p.direction === 'out');
    const inP = ins[0] ?? null;
    const outP = outs[outs.length - 1] ?? null;
    // خروج قبل أول دخول لا يصلح
    return { inP, outP: inP && outP && outP.minute > inP.minute ? outP : null };
  }
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  return { inP: first, outP: sorted.length > 1 ? last : null };
};

export const computeDay = <T>(input: DayInput<T>): DayResult<T> => {
  const segs = [...input.segments].sort((a, b) => a.start - b.start);
  const scheduledMinutes =
    input.kind === 'work' ? segs.reduce((n, s) => n + (s.end - s.start), 0) : 0;
  const { inP, outP } = pair(input.punches);
  const span = inP && outP ? outP.minute - inP.minute : 0;
  const valid = !!inP && !!outP && span > 0 && span <= MAX_SPAN_MINUTES;

  const base = (status: DayStatus): DayResult<T> => ({
    status,
    scheduledMinutes,
    firstIn: inP,
    lastOut: valid ? outP : null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    surplusMinutes: 0,
  });

  // يوم غير عمل (راحة/عطلة/بلا جدول) أو إجازة كاملة: ما بين البصمتين يُسجَّل عملاً فعلياً دون احتساب نقص
  const nonWorking = (status: DayStatus) => {
    const r = base(status);
    if (valid) r.workedMinutes = span;
    return r;
  };
  if (input.leaveUnits >= 1) return nonWorking('leave');
  if (input.holiday) return nonWorking('holiday');
  if (input.kind === 'none') return nonWorking('unscheduled');
  if (input.kind === 'off') return nonWorking('off');

  // يوم عمل
  if (input.punches.length === 0)
    return base(input.leaveUnits > 0 ? 'leave' : input.isPast ? 'absent' : 'pending');
  if (!valid) return base('incomplete');

  const worked = segs.reduce(
    (n, s) => n + overlap(inP.minute, (outP as Punch<T>).minute, s.start, s.end),
    0,
  );
  const first = segs[0] as Segment;
  const last = segs[segs.length - 1] as Segment;
  const lateBy = inP.minute - first.start;
  const earlyBy = last.end - (outP as Punch<T>).minute;
  const r = base('present');
  r.workedMinutes = worked;
  r.lateMinutes = lateBy > input.lateGrace ? lateBy : 0;
  r.earlyLeaveMinutes = earlyBy > input.earlyLeaveGrace ? earlyBy : 0;
  r.surplusMinutes = Math.max(0, span - worked);
  return r;
};
