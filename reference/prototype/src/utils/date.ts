/**
 * Date and time helper functions for HRMS (Gregorian in Arabic)
 */

export const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const ARABIC_MONTHS = [
  'كانون الثاني (يناير)',
  'شباط (فبراير)',
  'آذار (مارس)',
  'نيسان (أبريل)',
  'أيار (مايو)',
  'حزيران (يونيو)',
  'تموز (يوليو)',
  'آب (أغسطس)',
  'أيلول (سبتمبر)',
  'تشرين الأول (أكتوبر)',
  'تشرين الثاني (نوفمبر)',
  'كانون الأول (ديسمبر)'
];

export const getDayName = (dateStr: string): string => {
  const d = new Date(dateStr);
  return ARABIC_DAYS[d.getDay()] || '';
};

export const formatDateAr = (dateStr: string): string => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  const mIndex = parseInt(month, 10) - 1;
  const mName = ARABIC_MONTHS[mIndex] || month;
  return `${parseInt(day, 10)} ${mName} ${year}`;
};

export const getTodayDateString = (): string => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getCurrentTimeString = (): string => {
  const today = new Date();
  const hh = String(today.getHours()).padStart(2, '0');
  const mm = String(today.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

export const getCurrentDateTimeString = (): string => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const hh = String(today.getHours()).padStart(2, '0');
  const mm = String(today.getMinutes()).padStart(2, '0');
  const ss = String(today.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
};

export const parseMinutesFromTimeStr = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
};

export const formatMinutesToHoursStr = (totalMinutes: number): string => {
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  if (hours === 0) return `${mins} دقيقة`;
  if (mins === 0) return `${hours} ساعة`;
  return `${hours} ساعة و ${mins} دقيقة`;
};

/**
 * Checks if a date falls on a weekend in Jordan (default Friday = day index 5)
 */
export const isWeekend = (dateStr: string, weekendDays: number[] = [5]): boolean => {
  const d = new Date(dateStr);
  return weekendDays.includes(d.getDay());
};

/**
 * Calculate business days between two dates inclusive
 */
export const getWorkingDaysBetween = (startDateStr: string, endDateStr: string, weekendDays: number[] = [5]): number => {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (start > end) return 0;
  
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (!weekendDays.includes(cur.getDay())) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};
