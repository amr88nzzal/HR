import { digestJobs } from '../digest/jobs.js';
import { attendanceJobs } from '../modules/attendance/index.js';
import { leaveJobs } from '../modules/leave/index.js';
import { reportJobs } from '../modules/reports/index.js';
import type { FileDeps } from '../shared/stored-files.js';
import { notificationJobs } from '../notifications/jobs.js';
import type { MailProvider, TelegramProvider } from '../notifications/index.js';
import { SYSTEM_JOBS } from './definitions.js';
import { makeRegistry } from './types.js';

/** كل المهام المعرَّفة. mail يخص العامل فقط (الـ API يحتاج التعريف للتحقق عند الإدراج). */
export const buildRegistry = (
  mail: MailProvider | undefined,
  telegram?: TelegramProvider,
  files: FileDeps = { storage: undefined, crypto: undefined },
  publicUrl?: string,
) =>
  makeRegistry([
    ...SYSTEM_JOBS,
    ...notificationJobs(mail, telegram),
    ...digestJobs(),
    ...leaveJobs(),
    ...attendanceJobs(),
    ...reportJobs(files, publicUrl),
  ]);
