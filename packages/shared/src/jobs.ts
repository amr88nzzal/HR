import { z } from 'zod';

export const JOB_QUEUES = ['critical', 'default', 'bulk', 'render'] as const;
export const JOB_STATUSES = [
  'queued',
  'running',
  'retrying',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type JobQueueName = (typeof JOB_QUEUES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  status: z.enum(JOB_STATUSES).optional(),
  queue: z.enum(JOB_QUEUES).optional(),
  jobName: z.string().trim().min(1).max(100).optional(),
});

/** ما تعرضه واجهة مراقب المهام لكل تشغيل */
export type JobRunDto = {
  id: string;
  jobName: string;
  queue: JobQueueName;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  error: string | null;
  retryOf: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
