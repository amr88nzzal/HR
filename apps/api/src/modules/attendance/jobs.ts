import { z } from 'zod';
import { defineJob } from '../../jobs/types.js';
import { companyToday, recomputeDays } from './days.js';
import { addDays } from './time.js';

/** إعادة احتساب الحضور اليومية: آخر 3 أيام لكل الموظفين (تغطي البصمات المتأخرة والجداول المعدّلة). */
export const attendanceJobs = () => [
  defineJob({
    name: 'attendance.daily',
    queue: 'bulk',
    parse: (d) =>
      z
        .object({})
        .strict()
        .parse(d ?? {}) as Record<string, never>,
    handle: async (ctx) => {
      const today = await companyToday(ctx);
      return recomputeDays(ctx, 'all', addDays(today, -2), today);
    },
  }),
];
