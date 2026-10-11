import { z } from 'zod';
import { defineJob } from '../../jobs/types.js';
import { runLeaveMaintenance } from './ledger.js';

/**
 * الصيانة اليومية للإجازات: ترحيل وانتهاء مطلع السنة، انتهاء المرحَّل بعد مدته، والاستحقاق الشهري.
 * آمنة للتكرار (مفاتيح فريدة) وتعوّض الأيام الفائتة.
 */
export const leaveJobs = () => [
  defineJob({
    name: 'leave.daily',
    queue: 'bulk',
    parse: (d) =>
      z
        .object({})
        .strict()
        .parse(d ?? {}) as Record<string, never>,
    handle: (ctx) => runLeaveMaintenance(ctx),
  }),
];
