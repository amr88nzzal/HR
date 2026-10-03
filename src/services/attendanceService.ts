import { DailyAttendanceRecord, RawAttendanceLog, Shift, Employee, DayAttendanceStatus } from '../types/hrms';
import { parseMinutesFromTimeStr, isWeekend } from '../utils/date';
import { storage } from './storage';

export class AttendanceService {
  /**
   * Process raw logs and compute/update daily attendance records for a target date (YYYY-MM-DD)
   */
  processDailyAttendance(targetDate: string): DailyAttendanceRecord[] {
    const employees = storage.getEmployees();
    const rawLogs = storage.getRawAttendanceLogs();
    const shifts = storage.getShifts();
    const defaultShift = shifts[0] || {
      id: 'shift-standard',
      nameAr: 'دوام صباحي',
      startTime: '08:30',
      endTime: '17:00',
      graceMinutesLate: 15,
      graceMinutesEarly: 10,
      totalWorkHours: 8.5,
      isNightShift: false
    };

    const existingDays = storage.getDailyAttendanceRecords();
    const leaves = storage.getLeaveRequests().filter(l => l.status === 'approved');
    const settings = storage.getSettings();

    const isDayWeekend = isWeekend(targetDate, settings.weekendDays);

    const updatedRecords: DailyAttendanceRecord[] = [];

    employees.forEach(emp => {
      // Check if existing record is manually overridden
      const existing = existingDays.find(d => d.employeeId === emp.id && d.date === targetDate);
      if (existing && existing.isOverridden) {
        updatedRecords.push(existing);
        return;
      }

      // Check if employee is on approved leave
      const onLeave = leaves.find(l => {
        return l.employeeId === emp.id && targetDate >= l.startDate && targetDate <= l.endDate;
      });

      if (onLeave) {
        updatedRecords.push({
          id: existing?.id || `att-${emp.id}-${targetDate}`,
          employeeId: emp.id,
          date: targetDate,
          totalWorkedMinutes: 0,
          lateMinutes: 0,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          status: 'leave',
          shiftId: defaultShift.id,
          isOverridden: false,
          notes: `إجازة معتمدة (${onLeave.leaveType === 'annual' ? 'سنوية' : onLeave.leaveType === 'sick' ? 'مرضية' : 'أخرى'})`
        });
        return;
      }

      if (isDayWeekend) {
        updatedRecords.push({
          id: existing?.id || `att-${emp.id}-${targetDate}`,
          employeeId: emp.id,
          date: targetDate,
          totalWorkedMinutes: 0,
          lateMinutes: 0,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          status: 'weekend',
          shiftId: defaultShift.id,
          isOverridden: false,
          notes: 'عطلة أسبوعية رسمية'
        });
        return;
      }

      // Find all punches for this employee on this date
      // Match by either employee id or zktecoId
      const empLogs = rawLogs.filter(l => {
        const matchesEmp = l.zktecoEmpId === emp.zktecoId || l.zktecoEmpId === emp.employeeNo;
        const matchesDate = l.timestamp.startsWith(targetDate);
        return matchesEmp && matchesDate;
      }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      if (empLogs.length === 0) {
        // Absent
        updatedRecords.push({
          id: existing?.id || `att-${emp.id}-${targetDate}`,
          employeeId: emp.id,
          date: targetDate,
          totalWorkedMinutes: 0,
          lateMinutes: 0,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          status: 'absent',
          shiftId: defaultShift.id,
          isOverridden: false,
          notes: 'غياب بدون بصمة حضور'
        });
        return;
      }

      // Check first in and last out
      const firstPunch = empLogs[0];
      const lastPunch = empLogs.length > 1 ? empLogs[empLogs.length - 1] : null;

      const firstInTime = firstPunch.timestamp.substring(11, 16); // HH:mm
      const lastOutTime = lastPunch ? lastPunch.timestamp.substring(11, 16) : undefined;

      if (!lastOutTime || firstInTime === lastOutTime) {
        // Single punch -> Incomplete attendance
        const inMins = parseMinutesFromTimeStr(firstInTime);
        const shiftStartMins = parseMinutesFromTimeStr(defaultShift.startTime);
        let lateMins = 0;
        if (inMins > shiftStartMins + defaultShift.graceMinutesLate) {
          lateMins = inMins - shiftStartMins;
        }

        updatedRecords.push({
          id: existing?.id || `att-${emp.id}-${targetDate}`,
          employeeId: emp.id,
          date: targetDate,
          firstIn: firstInTime,
          totalWorkedMinutes: 0,
          lateMinutes: lateMins,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          status: 'incomplete',
          shiftId: defaultShift.id,
          isOverridden: false,
          notes: 'بصمة ناقصة (سُجل دخول فقط دون تسجيل انصراف)'
        });
        return;
      }

      // Complete attendance
      const inMins = parseMinutesFromTimeStr(firstInTime);
      const outMins = parseMinutesFromTimeStr(lastOutTime);
      const shiftStartMins = parseMinutesFromTimeStr(defaultShift.startTime);
      const shiftEndMins = parseMinutesFromTimeStr(defaultShift.endTime);

      let lateMins = 0;
      if (inMins > shiftStartMins + defaultShift.graceMinutesLate) {
        lateMins = inMins - shiftStartMins;
      }

      let earlyDepartureMins = 0;
      if (outMins < shiftEndMins - defaultShift.graceMinutesEarly) {
        earlyDepartureMins = shiftEndMins - outMins;
      }

      let overtimeMins = 0;
      if (outMins > shiftEndMins + 30) {
        overtimeMins = outMins - shiftEndMins;
      }

      const totalWorkedMins = Math.max(0, outMins - inMins);

      updatedRecords.push({
        id: existing?.id || `att-${emp.id}-${targetDate}`,
        employeeId: emp.id,
        date: targetDate,
        firstIn: firstInTime,
        lastOut: lastOutTime,
        totalWorkedMinutes: totalWorkedMins,
        lateMinutes: lateMins,
        earlyDepartureMinutes: earlyDepartureMins,
        overtimeMinutes: overtimeMins,
        status: 'present',
        shiftId: defaultShift.id,
        isOverridden: false,
        notes: lateMins > 0 ? `تأخير صباحي ${lateMins} دقيقة` : undefined
      });
    });

    // Merge into storage
    const remainingDays = existingDays.filter(d => d.date !== targetDate);
    const merged = [...remainingDays, ...updatedRecords];
    storage.saveDailyAttendanceRecords(merged);

    return updatedRecords;
  }

  /**
   * Record manual punch from UI (Live check-in simulation)
   */
  recordLivePunch(employeeId: string, punchType: 'in' | 'out'): RawAttendanceLog {
    const emp = storage.getEmployees().find(e => e.id === employeeId);
    if (!emp) throw new Error('الموظف غير موجود');

    const now = new Date();
    const dateStr = now.toISOString().substring(0, 10);
    const timeStr = now.toTimeString().substring(0, 8);
    const fullTimestamp = `${dateStr} ${timeStr}`;

    const newLog: RawAttendanceLog = {
      id: 'log-' + Math.random().toString(36).substring(2, 9),
      zktecoEmpId: emp.zktecoId,
      companyId: 'COMP-01',
      branchId: emp.branchId,
      departmentId: emp.departmentId,
      timestamp: fullTimestamp,
      punchType,
      source: 'web_punch',
      importedAt: now.toISOString()
    };

    storage.appendRawAttendanceLogs([newLog]);
    storage.logAction(
      'تسجيل حركة حضور/انصراف فورية',
      'create',
      'attendance',
      `تم تسجيل حركة ${punchType === 'in' ? 'دخول' : 'خروج'} للموظف ${emp.fullNameAr} الساعة ${timeStr}`
    );

    // Reprocess day
    this.processDailyAttendance(dateStr);

    return newLog;
  }

  /**
   * Manual override of a day record by HR
   */
  overrideDayRecord(recordId: string, updates: Partial<DailyAttendanceRecord>, reason: string): DailyAttendanceRecord {
    const records = storage.getDailyAttendanceRecords();
    const target = records.find(r => r.id === recordId);
    if (!target) throw new Error('سجل الحضور غير موجود');

    const updated: DailyAttendanceRecord = {
      ...target,
      ...updates,
      isOverridden: true,
      overrideReason: reason,
      overrideBy: storage.getUserSession().name
    };

    const newRecords = records.map(r => r.id === recordId ? updated : r);
    storage.saveDailyAttendanceRecords(newRecords);

    storage.logAction(
      'تجاوز يدوي لسجل حضور وانصراف',
      'override',
      'attendance',
      `تم تعديل سجل الحضور ليوم ${target.date} للموظف بمعرفة ${storage.getUserSession().name}. السبب: ${reason}`
    );

    return updated;
  }
}

export const attendanceService = new AttendanceService();
