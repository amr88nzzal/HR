export type AttendanceStatus =
  'present' | 'absent' | 'leave' | 'holiday' | 'off' | 'unscheduled' | 'incomplete' | 'pending';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'present',
  'absent',
  'leave',
  'holiday',
  'off',
  'unscheduled',
  'incomplete',
  'pending',
];

export const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: 'teal',
  absent: 'red',
  leave: 'blue',
  holiday: 'orange',
  off: 'gray',
  unscheduled: 'gray',
  incomplete: 'yellow',
  pending: 'cyan',
};

export type DayRow = {
  id: string;
  employeeId: string;
  dayDate: string;
  computedStatus: AttendanceStatus;
  status: AttendanceStatus;
  shiftId: string | null;
  scheduledMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  surplusMinutes: number;
  overtimeMinutes: number;
  leaveUnits: string;
  isOverridden: boolean;
  overrideNote: string | null;
  diffWarning: boolean;
};

/** صف اللوحة اليومية: يوم الحضور قد يكون غائباً (لم يُحتسب بعد). */
export type DailyRow = Partial<Omit<DayRow, 'employeeId'>> & {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
};

export type DailyData = { rows: DailyRow[]; counts: Record<string, number> };

/** دقائق → "س:د" (مثلاً 455 → 7:35). */
export const hm = (minutes: number | null | undefined): string => {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
};
