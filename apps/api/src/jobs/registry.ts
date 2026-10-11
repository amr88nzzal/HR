import { digestJobs } from '../digest/jobs.js';
import { notificationJobs } from '../notifications/jobs.js';
import type { MailProvider } from '../notifications/index.js';
import { SYSTEM_JOBS } from './definitions.js';
import { makeRegistry } from './types.js';

/** كل المهام المعرَّفة. mail يخص العامل فقط (الـ API يحتاج التعريف للتحقق عند الإدراج). */
export const buildRegistry = (mail: MailProvider | undefined) =>
  makeRegistry([...SYSTEM_JOBS, ...notificationJobs(mail), ...digestJobs()]);
