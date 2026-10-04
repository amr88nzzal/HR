import { PayrollRun, Payslip, PayslipLine, Employee, Loan, EmployeeDebtInvoice } from '../types/hrms';
import { storage } from './storage';
import {
  calculateJordanianSocialSecurity,
  calculateJordanianIncomeTax,
  calculateDailyWage,
  calculateHourlyWage
} from '../utils/jordanianRules';
import { addMoney, subMoney, mulMoney, roundMoney, formatMoney } from '../utils/decimal';

export class PayrollService {
  /**
   * Generates or recalculates a monthly payroll sheet (كشف الرواتب الشهرية) for a given month (YYYY-MM)
   * Calculation Order:
   * 1. Total Gross (إجمالي الاستحقاقات)
   * 2. Statutory & Attendance Deductions (الاستقطاعات النظامية)
   * 3. Net Salary Before Loans (صافي الراتب قبل السلف والذمم)
   * 4. Loans & Debt Invoices (السلف والأقساط وفواتير الذمم)
   * 5. Final Net Payable (الصافي النهائي المستحق للتسديد)
   */
  calculatePayrollRun(month: string): PayrollRun {
    const employees = storage.getEmployees().filter(e => e.status === 'active' || e.status === 'on_leave');
    const settings = storage.getSettings();
    const attendanceRecords = storage.getDailyAttendanceRecords();
    const loans = storage.getLoans();
    const debts = storage.getDebts();

    const depts = storage.getDepartments();
    const jobTitles = storage.getJobTitles();

    const existingRuns = storage.getPayrollRuns();
    const existingRun = existingRuns.find(r => r.month === month);

    const payslips: Payslip[] = [];

    employees.forEach(emp => {
      // Find department and job title name
      const dept = depts.find(d => d.id === emp.departmentId);
      const job = jobTitles.find(j => j.id === emp.jobTitleId);

      // Check attendance for this month
      const empAttendance = attendanceRecords.filter(a => a.employeeId === emp.id && a.date.startsWith(month));
      const absentDays = empAttendance.filter(a => a.status === 'absent').length;
      const totalLateMins = empAttendance.reduce((acc, cur) => acc + (cur.lateMinutes || 0), 0);
      const totalOvertimeMins = empAttendance.reduce((acc, cur) => acc + (cur.overtimeMinutes || 0), 0);
      const overtimeHours = roundMoney(totalOvertimeMins / 60, 1);

      // Check if employee has an active loan with installment
      const empLoans = loans.filter(l => l.employeeId === emp.id && l.status === 'active');
      const activeLoan = empLoans.length > 0 ? empLoans[0] : null;

      // Check employee debt invoices (فواتير الذمم والمشتريات)
      const empDebts = debts.filter(d => d.employeeId === emp.id && !d.isDeducted);
      const totalEmpDebts = empDebts.reduce((sum, d) => sum + d.amount, 0);

      // 1. Base Components (Gross Earnings)
      const basicSalary = emp.basicSalary;
      const housing = emp.housingAllowance || 0;
      const transport = emp.transportAllowance || 0;
      const otherAllowances = emp.otherAllowances || 0;
      const totalGrossEarnings = addMoney(basicSalary, housing, transport, otherAllowances).toNumber();

      // Daily & hourly rates
      const dailyWage = calculateDailyWage(totalGrossEarnings, settings.salaryDayBasis, 30);
      const hourlyWage = calculateHourlyWage(dailyWage, 8);

      // Attendance deductions / additions
      const absenceDeduction = roundMoney(mulMoney(dailyWage, absentDays), 3);
      
      let lateDeduction = 0;
      if (totalLateMins > (settings.graceMinutesLate || 15) * 4) {
        const lateHours = totalLateMins / 60;
        lateDeduction = roundMoney(mulMoney(hourlyWage, lateHours), 3);
      }

      // Overtime addition: 1.25x hourly wage
      const overtimePay = roundMoney(mulMoney(hourlyWage * (settings.overtimeNormalRate || 1.25), overtimeHours), 3);

      // Statutory Social Security
      const ssResult = calculateJordanianSocialSecurity(
        totalGrossEarnings,
        emp.isSocialSecuritySubscribed,
        emp.customSalarySocialSecurity,
        settings.employeeSocialSecurityRate,
        settings.companySocialSecurityRate
      );

      // Income tax calculation
      const taxResult = calculateJordanianIncomeTax(
        totalGrossEarnings,
        ssResult.employeeShare,
        emp.dependentsCount,
        settings.incomeTaxPersonalExemptionYearly,
        settings.incomeTaxDependentExemptionYearly
      );

      // Build lines: 1. Earnings
      const lines: PayslipLine[] = [
        {
          id: 'line-basic',
          code: 'EARN_BASIC',
          nameAr: 'الراتب الأساسي التعاقدي',
          type: 'earning',
          amount: basicSalary,
          calcExplanation: 'الراتب الأساسي الثابت المنصوص عليه في عقد العمل',
          isManualOverride: false
        }
      ];

      if (housing > 0) {
        lines.push({
          id: 'line-housing',
          code: 'EARN_HOUSING',
          nameAr: 'بدل سكن',
          type: 'earning',
          amount: housing,
          calcExplanation: 'بدل سكن شهري ثابت',
          isManualOverride: false
        });
      }

      if (transport > 0) {
        lines.push({
          id: 'line-transport',
          code: 'EARN_TRANSPORT',
          nameAr: 'بدل انتقال ومواصلات',
          type: 'earning',
          amount: transport,
          calcExplanation: 'بدل مواصلات شهري ثابت',
          isManualOverride: false
        });
      }

      if (otherAllowances > 0) {
        lines.push({
          id: 'line-other',
          code: 'EARN_OTHER',
          nameAr: 'بدلات وعلاوات إضافية',
          type: 'earning',
          amount: otherAllowances,
          calcExplanation: 'بدلات ومكافآت معتمدة إضافية',
          isManualOverride: false
        });
      }

      if (overtimePay > 0) {
        lines.push({
          id: 'line-overtime',
          code: 'EARN_OVERTIME',
          nameAr: `أجر العمل الإضافي (${overtimeHours} ساعة)`,
          type: 'earning',
          amount: overtimePay,
          calcExplanation: `احتساب ${overtimeHours} ساعة إضافي × أجر الساعة (${hourlyWage} د.أ) × ${settings.overtimeNormalRate || 1.25}`,
          isManualOverride: false
        });
      }

      // Build lines: 2. Statutory Deductions
      if (ssResult.employeeShare > 0) {
        lines.push({
          id: 'line-ss-emp',
          code: 'DED_SS_EMP',
          nameAr: `اقتطاع الضمان الاجتماعي (${(settings.employeeSocialSecurityRate * 100).toFixed(1)}%)`,
          type: 'statutory_deduction',
          amount: ssResult.employeeShare,
          calcExplanation: `اقتطاع إلزامي ${settings.employeeSocialSecurityRate * 100}% من الأجر الخاضع للضمان (${ssResult.subjectSalary} د.أ)`,
          isManualOverride: false
        });
      }

      if (taxResult.monthlyTax > 0) {
        lines.push({
          id: 'line-tax',
          code: 'DED_TAX',
          nameAr: 'اقتطاع ضريبة الدخل التقديرية',
          type: 'statutory_deduction',
          amount: taxResult.monthlyTax,
          calcExplanation: taxResult.taxBracketExplanation,
          isManualOverride: false
        });
      }

      if (absenceDeduction > 0) {
        lines.push({
          id: 'line-absent',
          code: 'DED_ABSENCE',
          nameAr: `خصم غياب بدون إجازة (${absentDays} يوم)`,
          type: 'statutory_deduction',
          amount: absenceDeduction,
          calcExplanation: `خصم ${absentDays} أيام غياب × الأجر اليومي (${dailyWage} د.أ)`,
          isManualOverride: false
        });
      }

      if (lateDeduction > 0) {
        lines.push({
          id: 'line-late',
          code: 'DED_LATE',
          nameAr: `خصم التأخير الصباحي (${totalLateMins} دقيقة)`,
          type: 'statutory_deduction',
          amount: lateDeduction,
          calcExplanation: `تجاوز رصيد السماح الشهري للتأخير (${totalLateMins} دقيقة)`,
          isManualOverride: false
        });
      }

      // Calculate Net Salary Before Loans and Receivables
      const totalGross = lines
        .filter(l => l.type === 'earning')
        .reduce((sum, l) => addMoney(sum, l.amount).toNumber(), 0);

      const totalStatutoryDeductions = lines
        .filter(l => l.type === 'statutory_deduction')
        .reduce((sum, l) => addMoney(sum, l.amount).toNumber(), 0);

      const netSalaryBeforeLoans = roundMoney(subMoney(totalGross, totalStatutoryDeductions), 3);

      // Build lines: 3. Loans & Receivables (After Net)
      let loanDeduction = 0;
      if (activeLoan && activeLoan.remainingAmount > 0) {
        loanDeduction = Math.min(activeLoan.monthlyInstallment, activeLoan.remainingAmount);
        lines.push({
          id: 'line-loan',
          code: 'DED_LOAN',
          nameAr: 'قسط السلفة الشهرية',
          type: 'debt_deduction',
          amount: loanDeduction,
          calcExplanation: `استقطاع قسط السلفة بعد احتساب الصافي (المتبقي بعدها: ${roundMoney(activeLoan.remainingAmount - loanDeduction, 3)} د.أ)`,
          isManualOverride: false
        });
      }

      let receivablesDeduction = 0;
      if (totalEmpDebts > 0) {
        receivablesDeduction = roundMoney(totalEmpDebts, 3);
        lines.push({
          id: 'line-debt',
          code: 'DED_RECEIVABLE',
          nameAr: `فواتير الذمم ومشتريات/عهد الموظف (${empDebts.length} فواتير)`,
          type: 'debt_deduction',
          amount: receivablesDeduction,
          calcExplanation: empDebts.map(d => `${d.invoiceNo}: ${d.description} (${d.amount} د.أ)`).join(' • '),
          isManualOverride: false
        });
      }

      const totalDebtsAndLoans = addMoney(loanDeduction, receivablesDeduction).toNumber();

      // Final Net Payable to Employee
      const finalNetPayable = roundMoney(subMoney(netSalaryBeforeLoans, totalDebtsAndLoans), 3);

      // 4. Employer contribution
      if (ssResult.companyShare > 0) {
        lines.push({
          id: 'line-ss-comp',
          code: 'COMP_SS_SHARE',
          nameAr: `مساهمة المنشأة في الضمان (${(settings.companySocialSecurityRate * 100).toFixed(2)}%)`,
          type: 'employer_contribution',
          amount: ssResult.companyShare,
          calcExplanation: `حصة صاحب العمل المقررة في قانون الضمان الاجتماعي (${(settings.companySocialSecurityRate * 100).toFixed(2)}%)`,
          isManualOverride: false
        });
      }

      const warnings: string[] = [];
      if (!emp.bankIban || emp.bankIban.trim().length < 10) {
        warnings.push('رقم الـ IBAN البنكي مفقود أو غير مكتمل');
      }
      if (!emp.nationalId) {
        warnings.push('الرقم الوطني / الإقامة مفقود');
      }
      if (finalNetPayable < 0) {
        warnings.push('تنبيه هام: الصافي النهائي المستحق سالب بسبب زيادة الالتزامات والسلف عن صافي الراتب');
      }

      // Check if existing payslip had manual override
      const existingPayslip = existingRun?.payslips.find(p => p.employeeId === emp.id);
      if (existingPayslip && existingPayslip.isManualOverride) {
        payslips.push(existingPayslip);
      } else {
        payslips.push({
          id: `slip-${emp.id}-${month}`,
          payrollRunId: `run-${month}`,
          employeeId: emp.id,
          employeeName: emp.fullNameAr,
          employeeNo: emp.employeeNo,
          accountingRefNo: emp.accountingRefNo || emp.employeeNo,
          nationalId: emp.nationalId,
          departmentName: dept?.nameAr || '',
          jobTitle: job?.titleAr || '',
          bankName: emp.bankName,
          bankIban: emp.bankIban,
          standardWorkDays: 30,
          actualPresentDays: 30 - absentDays,
          absentDays,
          lateDeductionDays: lateDeduction > 0 ? 1 : 0,
          overtimeHours,
          basicSalary,
          grossEarnings: totalGross,
          statutoryDeductions: totalStatutoryDeductions,
          netSalaryBeforeLoans,
          loanDeduction,
          receivablesDeduction,
          totalDebtsAndLoans,
          finalNetPayable,
          netSalary: finalNetPayable, // compatibility
          companySocialSecurityCost: ssResult.companyShare,
          lines,
          warnings,
          isManualOverride: false
        });
      }
    });

    const totalGross = payslips.reduce((sum, p) => addMoney(sum, p.grossEarnings).toNumber(), 0);
    const totalStatutory = payslips.reduce((sum, p) => addMoney(sum, p.statutoryDeductions).toNumber(), 0);
    const totalNetBeforeLoans = payslips.reduce((sum, p) => addMoney(sum, p.netSalaryBeforeLoans).toNumber(), 0);
    const totalLoansAndDebts = payslips.reduce((sum, p) => addMoney(sum, p.totalDebtsAndLoans).toNumber(), 0);
    const totalFinalNetPayable = payslips.reduce((sum, p) => addMoney(sum, p.finalNetPayable).toNumber(), 0);
    const totalCompanySS = payslips.reduce((sum, p) => addMoney(sum, p.companySocialSecurityCost).toNumber(), 0);

    const updatedRun: PayrollRun = {
      id: existingRun?.id || `run-${month}`,
      month,
      titleAr: `كشف الرواتب الشهرية لشهر ${month}`,
      status: existingRun?.status || 'calculated',
      currency: settings.currency,
      totalEmployees: payslips.length,
      totalGross: roundMoney(totalGross, 3),
      totalStatutoryDeductions: roundMoney(totalStatutory, 3),
      totalNetBeforeLoans: roundMoney(totalNetBeforeLoans, 3),
      totalLoansAndDebts: roundMoney(totalLoansAndDebts, 3),
      totalFinalNetPayable: roundMoney(totalFinalNetPayable, 3),
      totalNet: roundMoney(totalFinalNetPayable, 3),
      totalCompanySocialSecurity: roundMoney(totalCompanySS, 3),
      calculatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      payslips
    };

    const remainingRuns = existingRuns.filter(r => r.month !== month);
    storage.savePayrollRuns([updatedRun, ...remainingRuns]);

    storage.logAction(
      'احتساب كشف الرواتب الشهرية',
      'create',
      'payroll',
      `تم احتساب كشف الرواتب الشهرية لشهر ${month} بإجمالي صافي مستحق للتسديد ${formatMoney(totalFinalNetPayable, 3)} لعدد ${payslips.length} موظف`
    );

    return updatedRun;
  }

  /**
   * Manual override of a payslip line or amount
   */
  overridePayslip(
    payrollRunId: string,
    employeeId: string,
    updatedLines: PayslipLine[],
    notes: string
  ): Payslip {
    const runs = storage.getPayrollRuns();
    const run = runs.find(r => r.id === payrollRunId);
    if (!run) throw new Error('كشف الرواتب غير موجود');

    const slip = run.payslips.find(p => p.employeeId === employeeId);
    if (!slip) throw new Error('قسيمة الراتب غير موجودة');

    const grossEarnings = updatedLines
      .filter(l => l.type === 'earning')
      .reduce((sum, l) => addMoney(sum, l.amount).toNumber(), 0);

    const statutoryDeductions = updatedLines
      .filter(l => l.type === 'statutory_deduction')
      .reduce((sum, l) => addMoney(sum, l.amount).toNumber(), 0);

    const netSalaryBeforeLoans = roundMoney(subMoney(grossEarnings, statutoryDeductions), 3);

    const loanLine = updatedLines.find(l => l.code === 'DED_LOAN');
    const debtLine = updatedLines.find(l => l.code === 'DED_RECEIVABLE');
    const loanDeduction = loanLine ? loanLine.amount : 0;
    const receivablesDeduction = debtLine ? debtLine.amount : 0;
    const totalDebtsAndLoans = addMoney(loanDeduction, receivablesDeduction).toNumber();

    const finalNetPayable = roundMoney(subMoney(netSalaryBeforeLoans, totalDebtsAndLoans), 3);

    const updatedSlip: Payslip = {
      ...slip,
      lines: updatedLines,
      grossEarnings,
      statutoryDeductions,
      netSalaryBeforeLoans,
      loanDeduction,
      receivablesDeduction,
      totalDebtsAndLoans,
      finalNetPayable,
      netSalary: finalNetPayable,
      isManualOverride: true,
      notes: `تم التعديل اليدوي: ${notes}`
    };

    run.payslips = run.payslips.map(p => p.employeeId === employeeId ? updatedSlip : p);

    // Recompute run totals
    run.totalGross = run.payslips.reduce((sum, p) => addMoney(sum, p.grossEarnings).toNumber(), 0);
    run.totalStatutoryDeductions = run.payslips.reduce((sum, p) => addMoney(sum, p.statutoryDeductions).toNumber(), 0);
    run.totalNetBeforeLoans = run.payslips.reduce((sum, p) => addMoney(sum, p.netSalaryBeforeLoans).toNumber(), 0);
    run.totalLoansAndDebts = run.payslips.reduce((sum, p) => addMoney(sum, p.totalDebtsAndLoans).toNumber(), 0);
    run.totalFinalNetPayable = run.payslips.reduce((sum, p) => addMoney(sum, p.finalNetPayable).toNumber(), 0);
    run.totalNet = run.totalFinalNetPayable;

    storage.savePayrollRuns(runs);

    storage.logAction(
      'تجاوز يدوي في قسيمة راتب',
      'override',
      'payroll',
      `تم تعديل قسيمة راتب الموظف ${slip.employeeName} لشهر ${run.month}. الملاحظات: ${notes}`
    );

    return updatedSlip;
  }

  /**
   * Approve monthly payroll sheet
   */
  approvePayrollRun(runId: string): PayrollRun {
    const runs = storage.getPayrollRuns();
    const run = runs.find(r => r.id === runId);
    if (!run) throw new Error('كشف الرواتب غير موجود');

    run.status = 'approved';
    run.approvedBy = storage.getUserSession().name;
    run.approvedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    storage.savePayrollRuns(runs);

    storage.logAction(
      'اعتماد كشف الرواتب الشهرية',
      'approve',
      'payroll',
      `تم اعتماد كشف رواتب شهر ${run.month} رسمياً بصافي مستحق للتسديد ${formatMoney(run.totalFinalNetPayable, 3)}`
    );

    return run;
  }

  /**
   * Mark monthly payroll sheet as paid, update loans, mark debts as deducted
   */
  markAsPaid(runId: string): PayrollRun {
    const runs = storage.getPayrollRuns();
    const run = runs.find(r => r.id === runId);
    if (!run) throw new Error('كشف الرواتب غير موجود');

    run.status = 'paid';
    run.paidAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Update active loans
    const loans = storage.getLoans();
    let loansUpdated = false;

    // Update debts
    const debts = storage.getDebts();
    let debtsUpdated = false;

    run.payslips.forEach(slip => {
      // Deduct loans
      const loanLine = slip.lines.find(l => l.code === 'DED_LOAN');
      if (loanLine && loanLine.amount > 0) {
        const empLoan = loans.find(l => l.employeeId === slip.employeeId && l.status === 'active');
        if (empLoan) {
          empLoan.remainingAmount = roundMoney(Math.max(0, empLoan.remainingAmount - loanLine.amount), 3);
          if (empLoan.remainingAmount <= 0) {
            empLoan.status = 'completed';
          }
          loansUpdated = true;
        }
      }

      // Deduct invoices
      const debtLine = slip.lines.find(l => l.code === 'DED_RECEIVABLE');
      if (debtLine && debtLine.amount > 0) {
        debts.forEach(d => {
          if (d.employeeId === slip.employeeId && !d.isDeducted) {
            d.isDeducted = true;
            debtsUpdated = true;
          }
        });
      }
    });

    if (loansUpdated) storage.saveLoans(loans);
    if (debtsUpdated) storage.saveDebts(debts);

    storage.savePayrollRuns(runs);

    storage.logAction(
      'صرف الرواتب وتحديث السلف والذمم',
      'update',
      'payroll',
      `تم صرف كشف رواتب شهر ${run.month} وتحويل المستحقات وتسوية أرصدة السلف وفواتير الذمم`
    );

    return run;
  }
}

export const payrollService = new PayrollService();
