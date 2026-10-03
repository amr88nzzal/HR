import React, { useState } from 'react';
import {
  Clock,
  Fingerprint,
  Calendar,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  RefreshCw,
  Edit3,
  Sliders,
  ChevronLeft,
  X,
  Play
} from 'lucide-react';
import { Employee, DailyAttendanceRecord, Shift, RawAttendanceLog } from '../../types/hrms';
import { storage } from '../../services/storage';
import { attendanceService } from '../../services/attendanceService';
import { parseZKTecoLogs, generateSampleZKTecoFile, ZKTecoParseResult } from '../../utils/zktecoParser';
import { getTodayDateString, formatDateAr, getDayName, formatMinutesToHoursStr } from '../../utils/date';

interface AttendanceViewProps {
  employees: Employee[];
  attendanceDays: DailyAttendanceRecord[];
  shifts: Shift[];
  onRefresh: () => void;
  openZKTecoByDefault?: boolean;
}

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  employees,
  attendanceDays,
  shifts,
  onRefresh,
  openZKTecoByDefault = false
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'daily' | 'zkteco' | 'live' | 'shifts'>(
    openZKTecoByDefault ? 'zkteco' : 'daily'
  );

  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());

  // ZKTeco import state
  const [zktecoText, setZktecoText] = useState<string>('');
  const [zktecoSeparator, setZktecoSeparator] = useState<string>(';');
  const [zktecoInCode, setZktecoInCode] = useState<string>('1');
  const [zktecoOutCode, setZktecoOutCode] = useState<string>('0');
  const [parseResult, setParseResult] = useState<ZKTecoParseResult | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  // Manual Override state
  const [overrideRecord, setOverrideRecord] = useState<DailyAttendanceRecord | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<DailyAttendanceRecord['status']>('present');
  const [overrideFirstIn, setOverrideFirstIn] = useState('');
  const [overrideLastOut, setOverrideLastOut] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Daily records for selected date
  const dayRecords = attendanceDays.filter(d => d.date === selectedDate);

  // Ensure daily attendance is computed for selected date
  const handleCalculateDay = () => {
    attendanceService.processDailyAttendance(selectedDate);
    onRefresh();
  };

  // Generate Sample ZKTeco text
  const handleGenerateSampleZKTeco = () => {
    const list = employees.map(e => ({ zkId: e.zktecoId, name: e.fullNameAr }));
    const sample = generateSampleZKTecoFile(list, selectedDate);
    setZktecoText(sample);
    setParseResult(null);
    setImportSuccessMsg(null);
  };

  // Process ZKTeco logs
  const handleProcessZKTeco = () => {
    if (!zktecoText.trim()) return;

    const res = parseZKTecoLogs(zktecoText, {
      separator: zktecoSeparator,
      inCode: zktecoInCode,
      outCode: zktecoOutCode,
      breakInCode: '3',
      breakOutCode: '4'
    });

    setParseResult(res);

    if (res.successfulLogs.length > 0) {
      storage.appendRawAttendanceLogs(res.successfulLogs);
      // Recompute selected date attendance
      attendanceService.processDailyAttendance(selectedDate);
      storage.logAction(
        'استيراد بصمات ZKTeco',
        'import',
        'attendance',
        `تم استيراد ${res.successfulLogs.length} حركة بصمة من جهاز ZKTeco ومعالجتها بنجاح`
      );
      setImportSuccessMsg(`تم استيراد ومعالجة ${res.successfulLogs.length} حركة بنجاح، وتحديث سجلات الحضور.`);
      onRefresh();
    }
  };

  // Open Override Modal
  const handleOpenOverride = (record: DailyAttendanceRecord) => {
    setOverrideRecord(record);
    setOverrideStatus(record.status);
    setOverrideFirstIn(record.firstIn || '08:30');
    setOverrideLastOut(record.lastOut || '17:00');
    setOverrideReason('');
  };

  const handleSaveOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideRecord) return;
    if (!overrideReason.trim()) {
      alert('يرجى ذكر سبب التعديل اليدوي للتوثيق في سجل التدقيق');
      return;
    }

    attendanceService.overrideDayRecord(
      overrideRecord.id,
      {
        status: overrideStatus,
        firstIn: overrideFirstIn,
        lastOut: overrideLastOut,
        lateMinutes: 0
      },
      overrideReason
    );

    setOverrideRecord(null);
    onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Sub Tabs Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('daily')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'daily'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span>سجل الحضور اليومي</span>
          </button>

          <button
            onClick={() => setActiveSubTab('zkteco')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'zkteco'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5 text-emerald-600" />
            <span>استيراد ملفات ZKTeco</span>
          </button>

          <button
            onClick={() => setActiveSubTab('shifts')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'shifts'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-600" />
            <span>الورديات ومواعيد العمل</span>
          </button>
        </div>

        {/* Date Selector for daily view */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">تاريخ اليوم المختار:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={handleCalculateDay}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition cursor-pointer"
            title="إعادة احتساب دوام اليوم"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TAB 1: DAILY ATTENDANCE LOG */}
      {activeSubTab === 'daily' && (
        <div className="space-y-4">
          {/* Day overview summary */}
          <div className="bg-emerald-900 text-white rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
            <div>
              <p className="text-xs text-emerald-200 font-medium">
                {getDayName(selectedDate)}، {formatDateAr(selectedDate)}
              </p>
              <h3 className="text-base font-bold mt-0.5">
                سجل دوام الموظفين للوردية الصباحية الرسمية (08:30 - 17:00)
              </h3>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700 font-bold">
                حاضر: {dayRecords.filter(r => r.status === 'present').length}
              </span>
              <span className="bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700 font-bold text-rose-300">
                غياب: {dayRecords.filter(r => r.status === 'absent').length}
              </span>
              <span className="bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700 font-bold text-amber-300">
                بصمة ناقصة: {dayRecords.filter(r => r.status === 'incomplete').length}
              </span>
              <span className="bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700 font-bold text-blue-300">
                إجازة: {dayRecords.filter(r => r.status === 'leave').length}
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">رقم الموظف</th>
                    <th className="py-3 px-4">اسم الموظف</th>
                    <th className="py-3 px-4">معرّف البصمة</th>
                    <th className="py-3 px-4">وقت الدخول الأول</th>
                    <th className="py-3 px-4">وقت الانصراف الأخير</th>
                    <th className="py-3 px-4">التأخير الصباحي</th>
                    <th className="py-3 px-4">ساعات العمل</th>
                    <th className="py-3 px-4">الإضافي</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-center">تعديل يدوي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {employees.map(emp => {
                    const record = dayRecords.find(r => r.employeeId === emp.id);
                    const status = record?.status || 'absent';

                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-4 font-mono font-bold text-slate-800">{emp.employeeNo}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">{emp.fullNameAr}</td>
                        <td className="py-3 px-4 font-mono text-slate-500">{emp.zktecoId}</td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                          {record?.firstIn || '-'}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                          {record?.lastOut || '-'}
                        </td>
                        <td className="py-3 px-4">
                          {record?.lateMinutes && record.lateMinutes > 0 ? (
                            <span className="text-rose-600 font-bold">
                              {record.lateMinutes} دقيقة
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {record?.totalWorkedMinutes && record.totalWorkedMinutes > 0 ? (
                            <span className="font-semibold text-slate-800">
                              {formatMinutesToHoursStr(record.totalWorkedMinutes)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {record?.overtimeMinutes && record.overtimeMinutes > 0 ? (
                            <span className="text-emerald-700 font-bold">
                              {record.overtimeMinutes} دقيقة
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {status === 'present' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              حاضر
                            </span>
                          )}
                          {status === 'absent' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                              غائب
                            </span>
                          )}
                          {status === 'leave' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                              إجازة رسمية
                            </span>
                          )}
                          {status === 'incomplete' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              بصمة ناقصة
                            </span>
                          )}
                          {status === 'weekend' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                              عطلة أسبوعية (جمعة)
                            </span>
                          )}
                          {record?.isOverridden && (
                            <span className="mr-1 text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">
                              يدوي
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => record && handleOpenOverride(record)}
                            disabled={!record}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer disabled:opacity-30"
                            title="تعديل يدوي موثق"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ZKTECO IMPORT ENGINE */}
      {activeSubTab === 'zkteco' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 shadow-xs">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Fingerprint className="w-5 h-5 text-emerald-600" />
              <span>معالج استيراد ملفات أجهزة البصمة ZKTeco</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              متوافق تماماً مع التنسيق المعتمد لأجهزة ZKTeco مع إمكانية ضبط الفواصل والرموز بدقة 100%.
            </p>
          </div>

          {/* Guide Banner */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs text-slate-700">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>هيكل السجل في الملف (ZKTeco Raw Log Format):</span>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 font-mono text-[11px] text-emerald-900 overflow-x-auto text-left" dir="ltr">
              Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ
            </div>
            <p className="text-[11px] text-slate-500">
              حيث: <strong>1: دخول (In)</strong> • <strong>0: خروج (Out)</strong> • <strong>3: خروج استراحة</strong> • <strong>4: عودة من استراحة</strong>
            </p>
          </div>

          {/* Custom Settings Config */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50/60 p-3.5 rounded-xl border border-slate-100">
            <div>
              <label className="block text-slate-500 mb-1">الفاصل المستخدم:</label>
              <select
                value={zktecoSeparator}
                onChange={(e) => setZktecoSeparator(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-mono font-bold"
              >
                <option value=";">فاصلة منقوطة (;)</option>
                <option value=",">فاصلة عادية (,)</option>
                <option value="&#9;">جدولة (Tab)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-500 mb-1">رمز الدخول (In):</label>
              <input
                type="text"
                value={zktecoInCode}
                onChange={(e) => setZktecoInCode(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-mono font-bold text-center"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">رمز الانصراف (Out):</label>
              <input
                type="text"
                value={zktecoOutCode}
                onChange={(e) => setZktecoOutCode(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-mono font-bold text-center"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleGenerateSampleZKTeco}
                className="w-full py-2 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold border border-emerald-200 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>توليد بيانات تجريبية للموظفين</span>
              </button>
            </div>
          </div>

          {/* Text Area for file content */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <label>محتوى ملف البصمة (الصق المحتوى أو قم بتحميله):</label>
              <span className="text-slate-400 font-mono">
                {zktecoText.split('\n').filter(Boolean).length} أسطر
              </span>
            </div>
            <textarea
              rows={8}
              value={zktecoText}
              onChange={(e) => setZktecoText(e.target.value)}
              placeholder="Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ&#10;COMP-01;BR-AMM;DEPT-IT;101;2026-10-01 08:24:10;1&#10;COMP-01;BR-AMM;DEPT-IT;101;2026-10-01 17:05:30;0"
              className="w-full bg-slate-900 text-emerald-300 font-mono text-xs p-3 rounded-xl border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-left"
              dir="ltr"
            />
          </div>

          {importSuccessMsg && (
            <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{importSuccessMsg}</span>
            </div>
          )}

          {parseResult && parseResult.failedLines.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-xs space-y-1">
              <p className="font-bold">تنبيه: تعذر قراءة بعض الأسطر ({parseResult.failedLines.length}):</p>
              <ul className="list-disc list-inside text-[11px] space-y-0.5">
                {parseResult.failedLines.slice(0, 3).map((f, i) => (
                  <li key={i}>سطر {f.lineNumber}: {f.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Button */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={handleProcessZKTeco}
              disabled={!zktecoText.trim()}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md transition flex items-center gap-2 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>تحليل ومعالجة حركات البصمة فورياً</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: SHIFTS CONFIG */}
      {activeSubTab === 'shifts' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">إعدادات الورديات وساعات العمل الرسمية</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              أسبوع العمل في الأردن: من السبت إلى الخميس (الجمعة عطلة أسبوعية رسمية).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shifts.map(shift => (
              <div key={shift.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-slate-900">{shift.nameAr}</h4>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    نشطة
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 text-[10px]">موعد بدء الدوام:</span>
                    <p className="font-bold font-mono text-slate-800">{shift.startTime}</p>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 text-[10px]">موعد نهاية الدوام:</span>
                    <p className="font-bold font-mono text-slate-800">{shift.endTime}</p>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 text-[10px]">سماح التأخير الصباحي:</span>
                    <p className="font-semibold text-slate-800">{shift.graceMinutesLate} دقيقة</p>
                  </div>
                  <div className="p-2.5 bg-white rounded-xl border border-slate-200">
                    <span className="text-slate-400 text-[10px]">ساعات العمل المقررة:</span>
                    <p className="font-semibold text-slate-800">{shift.totalWorkHours} ساعات</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Override Modal */}
      {overrideRecord && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleSaveOverride}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                تعديل يدوي موثق لسجل الحضور
              </h3>
              <button
                type="button"
                onClick={() => setOverrideRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              تاريخ السجل: <strong>{overrideRecord.date}</strong> للموظف (
              {employees.find(e => e.id === overrideRecord.employeeId)?.fullNameAr})
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">الحالة المعتمدة:</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="present">حاضر (Present)</option>
                  <option value="absent">غائب (Absent)</option>
                  <option value="leave">إجازة (Leave)</option>
                  <option value="weekend">عطلة رسمية (Weekend)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1">وقت الدخول:</label>
                  <input
                    type="time"
                    value={overrideFirstIn}
                    onChange={(e) => setOverrideFirstIn(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">وقت الانصراف:</label>
                  <input
                    type="time"
                    value={overrideLastOut}
                    onChange={(e) => setOverrideLastOut(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold text-rose-700">
                  سبب التعديل اليدوي (إلزامي للتوثيق والتدقيق) *:
                </label>
                <textarea
                  rows={3}
                  required
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="مثال: تم التعديل بناءً على مهمة عمل خارجية رسمية معتمدة من مدير القسم..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setOverrideRecord(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                حفظ التعديل الموثق
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
