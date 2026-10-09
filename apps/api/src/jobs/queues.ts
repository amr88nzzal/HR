import type { QueueOptions } from 'pg-boss';
import { JOB_QUEUES, type JobQueueName } from '@hrms/shared';

/**
 * الطوابير الأربعة وسياسة إعادة المحاولة بتراجع أسّي (ثوانٍ).
 * critical: مهام قصيرة حرجة (إشعارات الموافقة) · default: العامة · bulk: دفعات ثقيلة · render: التوليد.
 */
export const QUEUE_OPTIONS: Record<JobQueueName, QueueOptions> = {
  critical: {
    retryLimit: 8,
    retryDelay: 15,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 600,
  },
  default: {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 900,
  },
  bulk: {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 3600,
  },
  render: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 1800,
    expireInSeconds: 600,
  },
};

/** عدد المهام المتوازية لكل طابور في عامل واحد */
export const QUEUE_CONCURRENCY: Record<JobQueueName, number> = {
  critical: 4,
  default: 4,
  bulk: 1,
  render: 2,
};

export const ALL_QUEUES = JOB_QUEUES;
