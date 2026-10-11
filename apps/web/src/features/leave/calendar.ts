export type CalRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  typeNameAr: string;
  typeNameEn: string | null;
  color: string | null;
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved';
  chargedDays: string;
};

export type CalendarData = {
  requests: CalRequest[];
  holidays: { holidayDate: string; nameAr: string; nameEn: string | null }[];
  weeklyOff: number[];
};

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** شبكة شهر من 6 أسابيع (42 يوماً) تبدأ بالأحد، بتواريخ ISO (UTC لتجنب انزياح اليوم). */
export const monthGrid = (year: number, month: number): string[] => {
  const first = Date.UTC(year, month, 1);
  const start = first - new Date(first).getUTCDay() * DAY;
  return Array.from({ length: 42 }, (_, i) => iso(start + i * DAY));
};

/** الطلبات التي تغطي يوماً معيّناً (شاملة الطرفين). */
export const requestsOn = (requests: CalRequest[], date: string): CalRequest[] =>
  requests.filter((r) => r.startDate <= date && r.endDate >= date);

export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
