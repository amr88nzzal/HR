import { z } from 'zod';

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, 'الرمز أحرف لاتينية وأرقام و - _ فقط');
const nameAr = z.string().trim().min(1).max(200);
const nameEn = z.string().trim().max(200).nullish();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت بصيغة HH:MM');

export const shiftSegmentInput = z.object({
  startTime: hhmm,
  endTime: hhmm,
  /** تنتهي الفترة في اليوم التالي (دوام ليلي) */
  endsNextDay: z.boolean().default(false),
});
export type ShiftSegmentInput = z.infer<typeof shiftSegmentInput>;

const minutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** مجال الفترة بالدقائق من منتصف ليل يوم البدء (النهاية قد تتجاوز 1440). */
export const segmentSpan = (s: ShiftSegmentInput): [number, number] => [
  minutes(s.startTime),
  minutes(s.endTime) + (s.endsNextDay ? 1440 : 0),
];

/** الفترات مرتبة بلا تداخل وكل فترة موجبة الطول. */
export const segmentsValid = (segments: ShiftSegmentInput[]): boolean => {
  const spans = segments.map(segmentSpan);
  if (spans.some(([a, b]) => b <= a)) return false;
  for (let i = 1; i < spans.length; i += 1)
    if ((spans[i]?.[0] ?? 0) < (spans[i - 1]?.[1] ?? 0)) return false;
  return true;
};

export const shiftInput = z.object({
  code,
  nameAr,
  nameEn,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  lateGraceMinutes: z.number().int().min(0).max(240).default(0),
  earlyLeaveGraceMinutes: z.number().int().min(0).max(240).default(0),
  isActive: z.boolean().default(true),
  segments: z
    .array(shiftSegmentInput)
    .min(1)
    .max(4)
    .refine(segmentsValid, 'الفترات متداخلة أو غير مرتبة أو بطول غير موجب'),
});
export type ShiftInput = z.infer<typeof shiftInput>;

export const workScheduleInput = z.object({
  code,
  nameAr,
  nameEn,
  isActive: z.boolean().default(true),
  /** سبعة أيام بالضبط (0=الأحد … 6=السبت)؛ shiftId فارغ = راحة */
  days: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), shiftId: uuid.nullable() }))
    .length(7)
    .refine(
      (d) => new Set(d.map((x) => x.weekday)).size === 7,
      'أيام الأسبوع السبعة مطلوبة بلا تكرار',
    ),
});
export type WorkScheduleInput = z.infer<typeof workScheduleInput>;

export const SCHEDULE_SCOPES = ['company', 'branch', 'department', 'employee'] as const;

export const scheduleAssignmentInput = z
  .object({
    scheduleId: uuid,
    scope: z.enum(SCHEDULE_SCOPES),
    scopeRef: uuid.nullish(),
    validFrom: isoDate,
    validTo: isoDate.nullish(),
  })
  .refine((v) => (v.scope === 'company') === !v.scopeRef, {
    message: 'النطاق غير الشركة يتطلب مرجعاً، وللشركة بلا مرجع',
    path: ['scopeRef'],
  })
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, {
    message: 'تاريخ النهاية قبل البداية',
    path: ['validTo'],
  });

export const PUNCH_DIRECTIONS = ['in', 'out'] as const;

/** بصمة يدوية: التاريخ والوقت محلّيان بتوقيت الشركة. */
export const punchInput = z.object({
  employeeId: uuid,
  date: isoDate,
  time: hhmm,
  direction: z.enum(PUNCH_DIRECTIONS).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export type PunchInput = z.infer<typeof punchInput>;

/** لصق من Excel: كل صف موظف (بالرقم الوظيفي أو المعرّف) + تاريخ + وقت. */
export const punchBulkInput = z.object({
  rows: z
    .array(
      z
        .object({
          employeeNo: z.string().trim().min(1).max(40).optional(),
          employeeId: uuid.optional(),
          date: isoDate,
          time: hhmm,
          direction: z.enum(PUNCH_DIRECTIONS).nullish(),
        })
        .refine((r) => !!r.employeeNo !== !!r.employeeId, 'حدّد الرقم الوظيفي أو المعرّف (واحداً)'),
    )
    .min(1)
    .max(2000),
});

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'leave',
  'holiday',
  'off',
  'unscheduled',
  'incomplete',
  'pending',
] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

export const attendanceRangeQuery = z
  .object({
    employeeId: uuid.optional(),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to >= v.from, { message: 'تاريخ النهاية قبل البداية', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'الفترة أطول من 62 يوماً',
    path: ['to'],
  });

export const attendanceRecomputeInput = z
  .object({
    employeeId: uuid.optional(),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to >= v.from, { message: 'تاريخ النهاية قبل البداية', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'الفترة أطول من 62 يوماً',
    path: ['to'],
  });

export const attendanceOverrideInput = z.object({
  employeeId: uuid,
  date: isoDate,
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().trim().min(1).max(300),
});

export const attendanceClearOverrideInput = z.object({ employeeId: uuid, date: isoDate });
