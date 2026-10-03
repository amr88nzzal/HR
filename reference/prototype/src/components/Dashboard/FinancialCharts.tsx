import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import { PayrollRun, Employee, Department } from '../../types/hrms';
import { formatMoney } from '../../utils/decimal';
import {
  TrendingUp,
  AlertCircle,
  PieChart as PieIcon,
  BarChart2,
  ShieldCheck,
  DollarSign,
  Receipt,
  CreditCard,
  Building,
  Info,
  CheckCircle2,
  ArrowDownRight
} from 'lucide-react';

interface FinancialChartsProps {
  payrollRun?: PayrollRun;
  departments: Department[];
  employees: Employee[];
  isDark?: boolean;
  language?: 'ar' | 'en';
}

const PALETTE = {
  emerald: '#10b981',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
  indigo: '#6366f1',
  slate: '#64748b'
};

const PIE_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#14b8a6'
];

export const FinancialCharts: React.FC<FinancialChartsProps> = ({
  payrollRun,
  departments,
  employees,
  isDark = false,
  language = 'ar'
}) => {
  const isEn = language === 'en';
  const [activeChartTab, setActiveChartTab] = useState<'overview' | 'deductions' | 'departments'>('overview');

  if (!payrollRun || payrollRun.payslips.length === 0) {
    return (
      <div className={`p-8 rounded-2xl border text-center ${isDark ? 'bg-slate-800/80 border-slate-700 text-slate-400' : 'bg-white border-slate-200 text-slate-500'}`}>
        <Info className="w-8 h-8 mx-auto mb-2 text-slate-400" />
        <p className="text-xs font-semibold">
          {isEn
            ? 'Please calculate the monthly payroll register first to visualize financial analytics and charts.'
            : 'يرجى احتساب كشف رواتب الشهر أولاً لعرض التحليلات والرسوم البيانية المالية المتقدمة.'}
        </p>
      </div>
    );
  }

  // 1. Five-stage Accounting Flow Data
  const flowData = [
    {
      name: isEn ? '1. Gross Salary' : '1. إجمالي الرواتب',
      amount: payrollRun.totalGross,
      color: PALETTE.blue,
      desc: isEn ? 'Basic + Allowances' : 'الأساسي + البدلات'
    },
    {
      name: isEn ? '2. Statutory Deds' : '2. الاستقطاعات',
      amount: payrollRun.totalStatutoryDeductions,
      color: PALETTE.rose,
      desc: isEn ? 'Social Sec + Tax' : 'الضمان + الضريبة'
    },
    {
      name: isEn ? '3. Net Pre-Loans' : '3. الصافي قبل السلف',
      amount: payrollRun.totalNetBeforeLoans,
      color: PALETTE.cyan,
      desc: isEn ? 'Before debt settlement' : 'قبل خصم السلف والذمم'
    },
    {
      name: isEn ? '4. Loans & Debts' : '4. السلف والذمم',
      amount: payrollRun.totalLoansAndDebts,
      color: PALETTE.purple,
      desc: isEn ? 'Recovered installments' : 'الأقساط وفواتير الذمم المستردة'
    },
    {
      name: isEn ? '5. Final Net Payable' : '5. الصافي للتسديد',
      amount: payrollRun.totalFinalNetPayable,
      color: PALETTE.emerald,
      desc: isEn ? 'Bank wire transfer' : 'التحويل البنكي الفعلي'
    }
  ];

  // 2. Detailed Deductions Breakdown (Social Security vs Income Tax vs Penalties vs Loans vs Debts)
  let totalSS = 0;
  let totalTax = 0;
  let totalPenalties = 0;
  let totalLoans = 0;
  let totalDebts = 0;

  payrollRun.payslips.forEach(slip => {
    slip.lines.forEach(line => {
      if (line.code === 'DED_SS_EMP') totalSS += line.amount;
      else if (line.code === 'DED_TAX') totalTax += line.amount;
      else if (line.code === 'DED_ABSENCE' || line.code === 'DED_LATE') totalPenalties += line.amount;
      else if (line.code.startsWith('LOAN_')) totalLoans += line.amount;
      else if (line.code.startsWith('DEBT_')) totalDebts += line.amount;
    });
  });

  const deductionsBreakdownData = [
    {
      name: isEn ? 'Social Security (7.5%)' : 'اشتراك الضمان (7.5%)',
      value: Math.round(totalSS * 1000) / 1000,
      color: '#3b82f6'
    },
    {
      name: isEn ? 'Income Tax' : 'ضريبة الدخل',
      value: Math.round(totalTax * 1000) / 1000,
      color: '#f43f5e'
    },
    {
      name: isEn ? 'Absence & Late' : 'خصم الغياب والتأخير',
      value: Math.round(totalPenalties * 1000) / 1000,
      color: '#f59e0b'
    },
    {
      name: isEn ? 'Loans & Advances' : 'أقساط السلف الشهرية',
      value: Math.round(totalLoans * 1000) / 1000,
      color: '#8b5cf6'
    },
    {
      name: isEn ? 'Debt Invoices' : 'فواتير الذمم المستردة',
      value: Math.round(totalDebts * 1000) / 1000,
      color: '#ec4899'
    }
  ].filter(d => d.value > 0);

  // 3. Department Breakdown Data
  const deptDataMap: Record<string, {
    name: string;
    gross: number;
    statutory: number;
    loansAndDebts: number;
    netPayable: number;
    count: number;
  }> = {};

  departments.forEach(d => {
    deptDataMap[d.id] = {
      name: isEn ? (d.nameEn || d.nameAr) : d.nameAr,
      gross: 0,
      statutory: 0,
      loansAndDebts: 0,
      netPayable: 0,
      count: 0
    };
  });

  payrollRun.payslips.forEach(slip => {
    const emp = employees.find(e => e.id === slip.employeeId);
    if (emp && deptDataMap[emp.departmentId]) {
      const entry = deptDataMap[emp.departmentId];
      entry.gross += slip.grossEarnings;
      entry.statutory += slip.statutoryDeductions;
      entry.loansAndDebts += slip.totalDebtsAndLoans;
      entry.netPayable += slip.finalNetPayable;
      entry.count += 1;
    }
  });

  const deptChartData = Object.values(deptDataMap).filter(d => d.count > 0);

  // 4. Decision Support Financial Metrics
  const debtRatio = payrollRun.totalGross > 0
    ? ((payrollRun.totalLoansAndDebts / payrollRun.totalGross) * 100).toFixed(1)
    : '0';

  const totalDeductions = payrollRun.totalStatutoryDeductions + payrollRun.totalLoansAndDebts;
  const totalDeductionPercent = payrollRun.totalGross > 0
    ? ((totalDeductions / payrollRun.totalGross) * 100).toFixed(1)
    : '0';

  const averageNetPay = payrollRun.totalEmployees > 0
    ? payrollRun.totalFinalNetPayable / payrollRun.totalEmployees
    : 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className={`p-3 rounded-xl shadow-xl border text-xs ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
          <p className="font-bold mb-1.5 border-b pb-1 border-slate-200 dark:border-slate-700">{label || payload[0]?.name}</p>
          {payload.map((item: any, idx: number) => (
            <p key={idx} className="flex items-center justify-between gap-4 py-0.5" style={{ color: item.color || item.fill }}>
              <span>{item.name}:</span>
              <span className="font-mono font-bold">{formatMoney(item.value, 3)} د.أ</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Financial Decision Support KPIs Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Net Cash Flow Required */}
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-800/90 border-slate-700' : 'bg-white border-slate-200'} shadow-xs`}>
          <div className="flex items-center justify-between text-xs">
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
              {isEn ? 'Net Bank Liquidity Needed' : 'صافي السيولة النقدية للتحويل'}
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <h4 className={`text-xl font-bold mt-2 font-mono ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
            {formatMoney(payrollRun.totalFinalNetPayable, 3)}
          </h4>
          <p className="text-[10px] text-slate-400 mt-1">
            {isEn ? 'Total wire transfer payout' : 'إجمالي الحوالات البنكية الصافية للموظفين'}
          </p>
        </div>

        {/* Metric 2: Recovered Loans & Invoices */}
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-800/90 border-slate-700' : 'bg-white border-slate-200'} shadow-xs`}>
          <div className="flex items-center justify-between text-xs">
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
              {isEn ? 'Recovered Loans & Debts' : 'السلف والذمم المستردة للخزينة'}
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <h4 className={`text-xl font-bold mt-2 font-mono ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
            {formatMoney(payrollRun.totalLoansAndDebts, 3)}
          </h4>
          <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
            <span className="font-semibold text-purple-600">{debtRatio}%</span>
            <span>{isEn ? 'of gross payroll' : 'من إجمالي فاتورة الرواتب'}</span>
          </p>
        </div>

        {/* Metric 3: Company Social Security Obligation (14.25%) */}
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-800/90 border-slate-700' : 'bg-white border-slate-200'} shadow-xs`}>
          <div className="flex items-center justify-between text-xs">
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
              {isEn ? 'Employer Social Security (14.25%)' : 'التزام الضمان لصاحب العمل'}
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <h4 className={`text-xl font-bold mt-2 font-mono ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
            {formatMoney(payrollRun.totalCompanySocialSecurity, 3)}
          </h4>
          <p className="text-[10px] text-slate-400 mt-1">
            {isEn ? 'Monthly mandatory employer liability' : 'التكلفة الإلزامية للمنشأة لدى مؤسسة الضمان'}
          </p>
        </div>

        {/* Metric 4: Average Net Salary per Employee */}
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-800/90 border-slate-700' : 'bg-white border-slate-200'} shadow-xs`}>
          <div className="flex items-center justify-between text-xs">
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
              {isEn ? 'Average Net Salary' : 'متوسط الراتب الصافي'}
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <h4 className={`text-xl font-bold mt-2 font-mono ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
            {formatMoney(averageNetPay, 3)}
          </h4>
          <p className="text-[10px] text-slate-400 mt-1">
            {isEn ? `Across ${payrollRun.totalEmployees} employees` : `لكل موظف من أصل ${payrollRun.totalEmployees} موظف`}
          </p>
        </div>
      </div>

      {/* Chart View Selection Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-100 dark:bg-slate-800/60 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveChartTab('overview')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeChartTab === 'overview'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart2 className="w-4 h-4 text-emerald-600" />
            <span>{isEn ? '5-Stage Payroll Flow' : 'المراحل الخمس لتوزيع الرواتب'}</span>
          </button>

          <button
            onClick={() => setActiveChartTab('deductions')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeChartTab === 'deductions'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <PieIcon className="w-4 h-4 text-purple-600" />
            <span>{isEn ? 'Deductions & Debts Breakdown' : 'تحليل الخصومات والسلف والذمم'}</span>
          </button>

          <button
            onClick={() => setActiveChartTab('departments')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeChartTab === 'departments'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Building className="w-4 h-4 text-blue-600" />
            <span>{isEn ? 'Department Payroll Comparison' : 'مقارنة رواتب الأقسام ومراكز التكلفة'}</span>
          </button>
        </div>

        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 px-2">
          {isEn ? 'Currency: JOD (3 decimals)' : 'العملة: دينار أردني (3 خانات عشرية)'}
        </span>
      </div>

      {/* Main Charts Area */}
      {activeChartTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main 5-Stage Bar Chart */}
          <div className={`lg:col-span-2 p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-3`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
              <h4 className={`text-xs font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <BarChart2 className="w-4 h-4 text-emerald-500" />
                <span>{isEn ? '5-Stage Payroll Flow & Deductions' : 'مخطط التدفق المحاسبي للرواتب (المراحل الخمس المعتمدة)'}</span>
              </h4>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                {payrollRun.month}
              </span>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flowData} margin={{ top: 15, right: 15, left: 15, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#f1f5f9'} />
                  <XAxis
                    dataKey="name"
                    stroke={isDark ? '#94a3b8' : '#64748b'}
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-10}
                    textAnchor="end"
                  />
                  <YAxis stroke={isDark ? '#94a3b8' : '#64748b'} tick={{ fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="amount" radius={[8, 8, 0, 0]} name={isEn ? 'Amount' : 'المبلغ'}>
                    {flowData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/80 text-[11px]">
              {flowData.map((item, idx) => (
                <div key={idx} className={`p-2 rounded-xl border ${isDark ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-[10px] text-slate-400 block truncate">{item.name}</span>
                  <strong className="font-mono block mt-0.5" style={{ color: item.color }}>
                    {formatMoney(item.amount, 3)}
                  </strong>
                  <span className="text-[9px] text-slate-400 block truncate">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Insights & Balance Card */}
          <div className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-4`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
              <h4 className={`text-xs font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Info className="w-4 h-4 text-blue-500" />
                <span>{isEn ? 'Decision-Making Insights' : 'إرشادات المحاسب المالي للقرار'}</span>
              </h4>
            </div>

            <div className="space-y-3 text-xs">
              <div className={`p-3 rounded-xl border ${isDark ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{isEn ? 'Payroll Health Status' : 'سلامة كشف الرواتب والمطابقة'}</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {isEn
                    ? 'Total gross equals net plus all deductions, social security, and recovered loans with 0 variance.'
                    : 'مطابقة تامة: مجموع الصافي النهائي + الاستقطاعات القانونية + السلف والذمم يعادل 100% من إجمالي الرواتب والبدلات دون أي فروقات.'}
                </p>
              </div>

              <div className={`p-3 rounded-xl border ${isDark ? 'bg-purple-950/30 border-purple-800/40 text-purple-200' : 'bg-purple-50 border-purple-200 text-purple-900'}`}>
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <CreditCard className="w-4 h-4 text-purple-600" />
                  <span>{isEn ? 'Loans Collection Target' : 'كفاءة تحصيل السلف والذمم'}</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {isEn
                    ? `Deductions burden is ${debtRatio}% of gross wages. All active loan schedules deducted smoothly.`
                    : `نسبة السلف والذمم المحصلة تشكل ${debtRatio}% من إجمالي الرواتب. تم خصم أقساط جميع السلف النشطة وفواتير الذمم المستحقة آلياً.`}
                </p>
              </div>

              <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <span className="text-[10px] text-slate-400 block">{isEn ? 'Net Disbursement Readiness' : 'جاهزية التحويل البنكي:'}</span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1 block">
                  {isEn ? 'Bank file ready for ISO20022 / IBAN routing' : 'ملف التحويل جاهز بصيغة الآيبان الأردني (JO...)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DEDUCTIONS & DEBTS TAB */}
      {activeChartTab === 'deductions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart of Deductions */}
          <div className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-3`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
              <h4 className={`text-xs font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <PieIcon className="w-4 h-4 text-purple-500" />
                <span>{isEn ? 'Deductions & Debt Invoices Distribution' : 'توزيع الاستقطاعات والخصومات والسلف والذمم'}</span>
              </h4>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deductionsBreakdownData}
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    innerRadius={45}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {deductionsBreakdownData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700 text-xs">
              {deductionsBreakdownData.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }}></span>
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="font-mono font-bold">{formatMoney(item.value, 3)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bar Comparison: Statutory vs Loans/Debts */}
          <div className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-3`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
              <h4 className={`text-xs font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Receipt className="w-4 h-4 text-rose-500" />
                <span>{isEn ? 'Statutory vs Non-Statutory Deductions' : 'مقارنة الخصومات القانونية مقابل السلف والذمم'}</span>
              </h4>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    {
                      category: isEn ? 'Deductions Types' : 'أنواع الاستقطاعات',
                      [isEn ? 'Social Security' : 'الضمان الاجتماعي']: totalSS,
                      [isEn ? 'Income Tax' : 'ضريبة الدخل']: totalTax,
                      [isEn ? 'Loans & Debts' : 'السلف والذمم']: totalLoans + totalDebts,
                      [isEn ? 'Penalties' : 'الغياب والتأخير']: totalPenalties
                    }
                  ]}
                  margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#f1f5f9'} />
                  <XAxis dataKey="category" stroke={isDark ? '#94a3b8' : '#64748b'} />
                  <YAxis stroke={isDark ? '#94a3b8' : '#64748b'} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey={isEn ? 'Social Security' : 'الضمان الاجتماعي'} fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  <Bar dataKey={isEn ? 'Income Tax' : 'ضريبة الدخل'} fill="#f43f5e" radius={[6, 6, 0, 0]} />
                  <Bar dataKey={isEn ? 'Loans & Debts' : 'السلف والذمم'} fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                  <Bar dataKey={isEn ? 'Penalties' : 'الغياب والتأخير'} fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-slate-100 dark:border-slate-700">
              {isEn
                ? 'Statutory deductions (Social Security and Tax) are governed by Jordanian Law. Loans and debts are internal company receivables recovered upon net payroll.'
                : 'الاستقطاعات القانونية (الضمان الاجتماعي وضريبة الدخل) ملزمة بموجب القانون الأردني، بينما السلف وفواتير الذمم هي استرداد لمستحقات الشركة الداخلية يتم إجراؤها بعد تبيان الصافي النظامي.'}
            </p>
          </div>
        </div>
      )}

      {/* DEPARTMENTS TAB */}
      {activeChartTab === 'departments' && (
        <div className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-4`}>
          <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
            <h4 className={`text-xs font-bold flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
              <Building className="w-4 h-4 text-blue-500" />
              <span>{isEn ? 'Department-wise Gross vs Net Payroll & Deductions' : 'مقارنة إجمالي وصافي الرواتب والخصومات حسب القسم'}</span>
            </h4>
          </div>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptChartData} margin={{ top: 20, right: 20, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#f1f5f9'} />
                <XAxis dataKey="name" stroke={isDark ? '#94a3b8' : '#64748b'} tick={{ fontSize: 11 }} />
                <YAxis stroke={isDark ? '#94a3b8' : '#64748b'} tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="gross" name={isEn ? 'Gross Salary' : 'إجمالي الراتب (Gross)'} fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="loansAndDebts" name={isEn ? 'Loans & Debts' : 'السلف والذمم'} fill="#9333ea" radius={[6, 6, 0, 0]} />
                <Bar dataKey="netPayable" name={isEn ? 'Net Payable' : 'الصافي المستحق للتسديد'} fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};
