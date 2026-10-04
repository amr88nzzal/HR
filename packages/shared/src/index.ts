import { z } from 'zod';

/** غلاف الاستجابة الناجحة: { data, meta? } */
export type ApiEnvelope<T, M = Record<string, unknown>> = { data: T; meta?: M };

/** شكل الخطأ الموحّد */
export type ApiErrorBody = {
  error: {
    code: string;
    status: number;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), z.enum(['up', 'down', 'skipped'])),
});
export type Health = z.infer<typeof healthSchema>;

export * from './org.js';
