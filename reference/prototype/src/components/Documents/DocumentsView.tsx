import React, { useState } from 'react';
import {
  FileText,
  Printer,
  QrCode,
  Building,
  CheckCircle2,
  Calendar,
  User,
  ShieldCheck,
  Download
} from 'lucide-react';
import { Employee, Company } from '../../types/hrms';
import { formatMoney } from '../../utils/decimal';
import { formatDateAr, getTodayDateString } from '../../utils/date';

interface DocumentsViewProps {
  employees: Employee[];
  company: Company;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({
  employees,
  company
}) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [letterType, setLetterType] = useState<'employment_cert' | 'salary_cert' | 'experience_cert'>('employment_cert');
  const [addressedTo, setAddressedTo] = useState<string>('لمن يهمه الأمر');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');

  const selectedEmp = employees.find(e => e.id === selectedEmpId) || employees[0];
  const todayStr = getTodayDateString();
  const serialNo = `HR/JO/2026/${selectedEmp?.employeeNo.replace('EMP-', '') || '101'}`;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Control Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4 no-print">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-600" />
            <span>إصدار الشهادات والوثائق والنماذج الرسمية المعتمدة</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            توليد مباشر للشهادات الرسمية مع ترويسة الشركة والرقم التسلسلي ورمز QR للتحقق السريع.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-600 mb-1 font-semibold">اختر الموظف:</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-800"
            >
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.fullNameAr} ({e.employeeNo})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-600 mb-1 font-semibold">نوع الوثيقة:</label>
            <select
              value={letterType}
              onChange={(e) => setLetterType(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-800"
            >
              <option value="employment_cert">شهادة إثبات عمل (لمن يهمه الأمر)</option>
              <option value="salary_cert">شهادة إثبات وتحويل راتب (للبنوك)</option>
              <option value="experience_cert">شهادة خبرة وكفاءة عمل</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-600 mb-1 font-semibold">الجهة الموجه إليها الخطاب:</label>
            <input
              type="text"
              value={addressedTo}
              onChange={(e) => setAddressedTo(e.target.value)}
              placeholder="مثال: بنك الاتحاد / السفارة..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handlePrint}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة الوثيقة الرسمية</span>
            </button>
          </div>
        </div>
      </div>

      {/* Official Printable Certificate Paper */}
      <div className="bg-white rounded-2xl border border-slate-300 p-10 max-w-4xl mx-auto shadow-lg space-y-8 printable-area min-h-[700px] flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-slate-900 pb-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{company.nameAr}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{company.address}</p>
              <p className="text-xs text-slate-500 font-mono" dir="ltr">Tel: {company.phone} • Email: {company.email}</p>
            </div>
            <div className="text-left" dir="ltr">
              <span className="text-base font-bold text-slate-900 block">{company.nameEn}</span>
              <span className="text-xs text-slate-500 block">Kingdom of Jordan</span>
              <span className="text-[11px] font-mono text-emerald-800 font-bold block mt-1">Ref: {serialNo}</span>
            </div>
          </div>

          {/* Date and Ref */}
          <div className="flex items-center justify-between text-xs text-slate-600 pt-4">
            <p>التاريخ: <strong className="text-slate-900">{formatDateAr(todayStr)}</strong></p>
            <p>الرقم الإشاري: <strong className="font-mono text-slate-900">{serialNo}</strong></p>
          </div>

          {/* Letter Body */}
          <div className="py-8 space-y-6">
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-900 underline underline-offset-8">
                {letterType === 'employment_cert' && 'شهادة إثبات عمل لمن يهمه الأمر'}
                {letterType === 'salary_cert' && 'شهادة تفصيل وإثبات راتب رسمي'}
                {letterType === 'experience_cert' && 'شهادة خبرة وكفاءة مهنية'}
              </h3>
            </div>

            <div className="text-sm font-semibold text-slate-800">
              السادة / {addressedTo} المحترمين،<br />
              تحية طيبة وبعد،،
            </div>

            <div className="text-sm text-slate-800 leading-relaxed space-y-4 text-justify">
              <p>
                تشهد <strong>{company.nameAr}</strong> المسجلة في وزارة الصناعة والتجارة الأردنية تحت السجل التجاري رقم (<strong>{company.crNumber}</strong>) بأن السيد/السيدة:
              </p>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">الاسم الكامل:</span>
                  <p className="font-bold text-slate-900">{selectedEmp?.fullNameAr}</p>
                </div>
                <div>
                  <span className="text-slate-500">الرقم الوطني / الإقامة:</span>
                  <p className="font-bold font-mono text-slate-900">{selectedEmp?.nationalId}</p>
                </div>
                <div>
                  <span className="text-slate-500">تاريخ بدء العمل:</span>
                  <p className="font-bold font-mono text-slate-900">{selectedEmp?.hireDate}</p>
                </div>
                <div>
                  <span className="text-slate-500">المسمى الوظيفي:</span>
                  <p className="font-bold text-slate-900">{selectedEmp?.jobTitleId}</p>
                </div>
              </div>

              {letterType === 'employment_cert' && (
                <p>
                  يعمل لدينا ولا يزال على رأس عمله حتى تاريخ تحرير هذا الكتاب بكفاءة والتزام تام. وقد أُعطيت له هذه الشهادة بناءً على طلبه لتقديمها إلى <strong>{addressedTo}</strong> دون أدنى مسؤولية مالية أو قانونية على الشركة تجاه حقوق الغير.
                </p>
              )}

              {letterType === 'salary_cert' && (
                <>
                  <p>
                    ويتقاضى راتباً شهرياً إجمالياً مفصلاً على النحو التالي بالدينار الأردني (JOD):
                  </p>
                  <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-200 text-xs grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-slate-500">الراتب الأساسي:</span>
                      <p className="font-bold text-slate-900">{formatMoney(selectedEmp?.basicSalary || 0, 3)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">إجمالي البدلات الثابتة:</span>
                      <p className="font-bold text-slate-900">
                        {formatMoney((selectedEmp?.housingAllowance || 0) + (selectedEmp?.transportAllowance || 0), 3)}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">إجمالي الراتب التعاقدي:</span>
                      <p className="font-bold text-emerald-800">
                        {formatMoney((selectedEmp?.basicSalary || 0) + (selectedEmp?.housingAllowance || 0) + (selectedEmp?.transportAllowance || 0), 3)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    رقم الحساب البنكي المعتمد لتحويل الرواتب (IBAN): <strong className="font-mono" dir="ltr">{selectedEmp?.bankIban}</strong> لدى ({selectedEmp?.bankName}).
                  </p>
                </>
              )}

              {letterType === 'experience_cert' && (
                <p>
                  وقد اتصف خلال فترة عمله لدينا بالأمانة وحسن السيرة والتعاون وأداء الواجبات المنوطة به بكل مهنية وإخلاص واقتدار. ونتمنى له دوام التوفيق والنجاح.
                </p>
              )}

              <p className="font-semibold pt-2">
                وتفضلوا بقبول فائق الاحترام والتقدير،،
              </p>
            </div>
          </div>
        </div>

        {/* Footer with Signatures & QR Code */}
        <div className="border-t border-slate-200 pt-6 flex items-end justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold text-slate-800">إدارة الموارد البشرية وشؤون الموظفين</p>
            <p className="text-xs text-slate-500">{company.nameAr}</p>
            <div className="w-32 h-14 border border-dashed border-slate-300 rounded flex items-center justify-center text-[10px] text-slate-400 mt-2">
              (التوقيع والختم الرسمي)
            </div>
          </div>

          {/* Verifiable QR Code Representation */}
          <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <div className="w-16 h-16 bg-white border border-slate-300 rounded p-1 flex items-center justify-center shadow-xs">
              <QrCode className="w-14 h-14 text-slate-900" />
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <span className="font-bold text-slate-800 block">رمز التحقق الإلكتروني (QR)</span>
              <span>امسح الرمز للتأكد من صحة الوثيقة</span>
              <span className="font-mono text-emerald-700 block font-semibold">VERIFY-{selectedEmp?.employeeNo}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
