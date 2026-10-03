import Decimal from 'decimal.js';
import { roundMoney, toDecimal, mulMoney, subMoney, divMoney } from './decimal';

export interface SocialSecurityResult {
  employeeShare: number; // 7.5%
  companyShare: number;  // 14.25%
  totalContribution: number;
  subjectSalary: number;
}

/**
 * Calculates Jordanian Social Security contributions
 */
export const calculateJordanianSocialSecurity = (
  grossSalary: number,
  isSubscribed: boolean = true,
  customSubjectSalary?: number,
  employeeRate: number = 0.075,
  companyRate: number = 0.1425
): SocialSecurityResult => {
  if (!isSubscribed) {
    return { employeeShare: 0, companyShare: 0, totalContribution: 0, subjectSalary: 0 };
  }

  const subject = customSubjectSalary && customSubjectSalary > 0 ? customSubjectSalary : grossSalary;
  const decSubject = toDecimal(subject);

  const empShareDec = decSubject.times(employeeRate);
  const compShareDec = decSubject.times(companyRate);
  const totalDec = empShareDec.plus(compShareDec);

  return {
    employeeShare: roundMoney(empShareDec, 3),
    companyShare: roundMoney(compShareDec, 3),
    totalContribution: roundMoney(totalDec, 3),
    subjectSalary: roundMoney(decSubject, 3)
  };
};

export interface JordanianTaxResult {
  monthlyTaxableIncome: number;
  monthlyExemption: number;
  monthlyTax: number;
  annualEquivalentTax: number;
  taxBracketExplanation: string;
}

/**
 * Calculates monthly Jordanian Income Tax approximation with progressive brackets
 * @param monthlyGross - Monthly gross salary
 * @param monthlySocialSecurity - Social security deducted from employee (tax-deductible in Jordan)
 * @param dependentsCount - Number of dependents (each gives extra exemption up to cap)
 * @param personalExemptionYearly - Default 9,000 JD
 * @param dependentExemptionYearly - Default 9,000 JD
 */
export const calculateJordanianIncomeTax = (
  monthlyGross: number,
  monthlySocialSecurity: number,
  dependentsCount: number = 0,
  personalExemptionYearly: number = 9000,
  dependentExemptionYearly: number = 9000
): JordanianTaxResult => {
  // Annualized gross
  const annualGross = toDecimal(monthlyGross).times(12);
  const annualSS = toDecimal(monthlySocialSecurity).times(12);

  // Total annual exemptions: Personal + Dependents (up to 3,000 per dependent up to 9,000 total)
  let totalAnnualExemption = toDecimal(personalExemptionYearly);
  if (dependentsCount > 0) {
    const depExempt = Math.min(dependentsCount * 3000, dependentExemptionYearly);
    totalAnnualExemption = totalAnnualExemption.plus(depExempt);
  }

  // Taxable Base = Gross - Social Security - Exemptions
  const incomeAfterSS = annualGross.minus(annualSS);
  const annualTaxable = Decimal.max(0, incomeAfterSS.minus(totalAnnualExemption));

  if (annualTaxable.isZero()) {
    return {
      monthlyTaxableIncome: 0,
      monthlyExemption: roundMoney(totalAnnualExemption.dividedBy(12), 3),
      monthlyTax: 0,
      annualEquivalentTax: 0,
      taxBracketExplanation: 'ضمن سقف الإعفاءات السنوية الشخصية والمعالين (معفى من الضريبة)'
    };
  }

  // Calculate tax on annual brackets:
  // Bracket 1: First 5,000 at 5%
  // Bracket 2: Next 5,000 (5,001 - 10,000) at 10%
  // Bracket 3: Next 5,000 (10,001 - 15,000) at 15%
  // Bracket 4: Next 5,000 (15,001 - 20,000) at 20%
  // Bracket 5: Above 20,000 at 25%

  let remaining = annualTaxable;
  let totalAnnualTax = new Decimal(0);
  const brackets = [
    { cap: 5000, rate: 0.05, label: '5%' },
    { cap: 5000, rate: 0.10, label: '10%' },
    { cap: 5000, rate: 0.15, label: '15%' },
    { cap: 5000, rate: 0.20, label: '20%' },
    { cap: Infinity, rate: 0.25, label: '25%' }
  ];

  const explanationParts: string[] = [];

  for (const b of brackets) {
    if (remaining.isZero()) break;
    const taxableInBracket = Decimal.min(remaining, b.cap);
    const taxInBracket = taxableInBracket.times(b.rate);
    totalAnnualTax = totalAnnualTax.plus(taxInBracket);
    explanationParts.push(`${roundMoney(taxableInBracket, 0)} د.أ بسعر ${b.label}`);
    remaining = remaining.minus(taxableInBracket);
  }

  const monthlyTax = totalAnnualTax.dividedBy(12);

  return {
    monthlyTaxableIncome: roundMoney(annualTaxable.dividedBy(12), 3),
    monthlyExemption: roundMoney(totalAnnualExemption.dividedBy(12), 3),
    monthlyTax: roundMoney(monthlyTax, 3),
    annualEquivalentTax: roundMoney(totalAnnualTax, 3),
    taxBracketExplanation: `شرائح ضريبية: ${explanationParts.join(' + ')}`
  };
};

/**
 * Daily rate calculation according to Jordan labor law basis (standard 30 days)
 */
export const calculateDailyWage = (monthlyGross: number, basis: 'fixed_30' | 'actual_month_days' | 'actual_work_days' = 'fixed_30', actualDaysInMonth: number = 30): number => {
  const days = basis === 'fixed_30' ? 30 : actualDaysInMonth;
  return roundMoney(divMoney(monthlyGross, days), 3);
};

export const calculateHourlyWage = (dailyWage: number, workHoursPerDay: number = 8): number => {
  return roundMoney(divMoney(dailyWage, workHoursPerDay), 3);
};
