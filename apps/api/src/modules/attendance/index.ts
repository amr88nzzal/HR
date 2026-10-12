import type { RequestHandler, Router } from 'express';
import type { Db } from '../../db/index.js';
import { createAttendanceRouter } from './records.routes.js';
import {
  createScheduleAssignmentsRouter,
  createSchedulesRouter,
  createShiftsRouter,
} from './schedules.routes.js';

export { attendanceJobs } from './jobs.js';
export { recomputeDays } from './days.js';
export { loadShifts, resolveSchedule, type ResolvedSchedule, type ShiftDto } from './schedule.js';

/** يركّب مسارات الحضور تحت /api/v1 */
export const mountAttendanceRoutes = (api: Router, db: Db, authenticate: RequestHandler): void => {
  api.use('/shifts', createShiftsRouter(db, authenticate));
  api.use('/work-schedules', createSchedulesRouter(db, authenticate));
  api.use('/attendance', createAttendanceRouter(db, authenticate));
  api.use('/schedule-assignments', createScheduleAssignmentsRouter(db, authenticate));
};
