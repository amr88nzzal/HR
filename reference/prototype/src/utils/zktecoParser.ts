import { RawAttendanceLog, PunchType } from '../types/hrms';

export interface ZKTecoParseResult {
  successfulLogs: RawAttendanceLog[];
  failedLines: { line: string; lineNumber: number; reason: string }[];
  summary: {
    totalLines: number;
    parsedCount: number;
    failedCount: number;
  };
}

export interface ZKTecoConfig {
  separator: string; // ";"
  inCode: string; // "1"
  outCode: string; // "0"
  breakInCode: string; // "3"
  breakOutCode: string; // "4"
}

export const DEFAULT_ZKTECO_CONFIG: ZKTecoConfig = {
  separator: ';',
  inCode: '1',
  outCode: '0',
  breakInCode: '3',
  breakOutCode: '4'
};

/**
 * Parses ZKTeco raw text export in format:
 * Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ
 */
export const parseZKTecoLogs = (
  rawText: string,
  config: ZKTecoConfig = DEFAULT_ZKTECO_CONFIG
): ZKTecoParseResult => {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const successfulLogs: RawAttendanceLog[] = [];
  const failedLines: { line: string; lineNumber: number; reason: string }[] = [];

  const sep = config.separator || ';';

  lines.forEach((line, index) => {
    // Skip potential header line if contains 'emp' or 'trx'
    if (index === 0 && (line.toLowerCase().includes('emp_id') || line.toLowerCase().includes('company_id'))) {
      return;
    }

    const parts = line.split(sep).map(p => p.trim());
    if (parts.length < 6) {
      // Maybe tab or comma separated fallback
      const altParts = line.split(/[;,\t]/).map(p => p.trim());
      if (altParts.length >= 6) {
        processParts(altParts, line, index + 1);
        return;
      }
      failedLines.push({
        line,
        lineNumber: index + 1,
        reason: `عدد الحقول غير كافٍ (المتوقع 6 حقول على الأقل، وُجد ${parts.length})`
      });
      return;
    }

    processParts(parts, line, index + 1);
  });

  function processParts(parts: string[], originalLine: string, lineNumber: number) {
    const companyId = parts[0];
    const branchId = parts[1];
    const deptId = parts[2];
    const empId = parts[3];
    const dateStr = parts[4];
    const trxTypeRaw = parts[5];

    if (!empId) {
      failedLines.push({ line: originalLine, lineNumber, reason: 'معرّف الموظف (Emp_ID) مفقود' });
      return;
    }

    if (!dateStr) {
      failedLines.push({ line: originalLine, lineNumber, reason: 'تاريخ الحركة (Trx_Date) مفقود' });
      return;
    }

    let punchType: PunchType = 'in';
    if (trxTypeRaw === config.outCode || trxTypeRaw.toLowerCase() === 'out' || trxTypeRaw === '0') {
      punchType = 'out';
    } else if (trxTypeRaw === config.inCode || trxTypeRaw.toLowerCase() === 'in' || trxTypeRaw === '1') {
      punchType = 'in';
    } else if (trxTypeRaw === config.breakInCode || trxTypeRaw.toLowerCase() === 'breakin' || trxTypeRaw === '3') {
      punchType = 'break_in';
    } else if (trxTypeRaw === config.breakOutCode || trxTypeRaw.toLowerCase() === 'breakout' || trxTypeRaw === '4') {
      punchType = 'break_out';
    }

    // Normalize date format if YYYY/MM/DD to YYYY-MM-DD
    const normalizedDate = dateStr.replace(/\//g, '-');

    successfulLogs.push({
      id: 'log-' + Math.random().toString(36).substring(2, 9),
      zktecoEmpId: empId,
      companyId,
      branchId,
      departmentId: deptId,
      timestamp: normalizedDate,
      punchType,
      source: 'zkteco_device',
      rawString: originalLine,
      importedAt: new Date().toISOString()
    });
  }

  return {
    successfulLogs,
    failedLines,
    summary: {
      totalLines: lines.length,
      parsedCount: successfulLogs.length,
      failedCount: failedLines.length
    }
  };
};

/**
 * Generate realistic ZKTeco sample data for testing based on provided employee zkteco IDs
 */
export const generateSampleZKTecoFile = (
  employeeZkIds: { zkId: string; name: string }[],
  targetDate: string = '2026-10-01'
): string => {
  const lines: string[] = [
    'Company_ID;Branch_ID;Departement_ID;Emp_ID;Trx_Date;Trx_typ'
  ];

  employeeZkIds.forEach(emp => {
    // Generate check-in between 08:15 and 08:50
    const inMinute = Math.floor(Math.random() * 35) + 15; // 08:15 to 08:50
    const inMinuteStr = String(inMinute).padStart(2, '0');
    lines.push(`COMP-01;BR-AMM;DEPT-IT;${emp.zkId};${targetDate} 08:${inMinuteStr}:12;1`);

    // Generate check-out between 16:55 and 17:35
    const outMinute = Math.floor(Math.random() * 40); // 17:00 to 17:39
    const outMinuteStr = String(outMinute).padStart(2, '0');
    lines.push(`COMP-01;BR-AMM;DEPT-IT;${emp.zkId};${targetDate} 17:${outMinuteStr}:45;0`);
  });

  return lines.join('\n');
};
