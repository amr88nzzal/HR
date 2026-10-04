import React, { useState } from 'react';
import {
  History,
  ShieldCheck,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  FileCheck,
  Edit2,
  Trash2,
  Fingerprint
} from 'lucide-react';
import { AuditLogItem } from '../../types/hrms';

interface AuditLogViewProps {
  auditLogs: AuditLogItem[];
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ auditLogs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('all');

  const filteredLogs = auditLogs.filter(item => {
    const matchesSearch =
      item.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.userName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesModule = selectedModule === 'all' || item.module === selectedModule;
    return matchesSearch && matchesModule;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-600" />
            <span>سجل التدقيق والحركات الإدارية والمالية (Audit Log)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            سجل غير قابل للتعديل (Append-Only) لتوثيق جميع العمليات الحساسة، التجاوزات اليدوية، والاعتمادات.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث في السجل..."
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800"
          />

          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700"
          >
            <option value="all">جميع الوحدات</option>
            <option value="payroll">الرواتب والمسيرات</option>
            <option value="attendance">الحضور والبصمة</option>
            <option value="leaves">الإجازات</option>
            <option value="employees">شؤون الموظفين</option>
            <option value="settings">الإعدادات</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-3 px-4">التوقيت والتاريخ</th>
                <th className="py-3 px-4">المستخدم المنفّذ</th>
                <th className="py-3 px-4">نوع الحركة</th>
                <th className="py-3 px-4">الوحدة</th>
                <th className="py-3 px-4">تفاصيل الإجراء الموثق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد حركات مطابقة لشروط البحث.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap" dir="ltr">
                      {item.timestamp}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {item.userName}
                    </td>
                    <td className="py-3 px-4">
                      {item.actionType === 'create' && (
                        <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          إنشاء / تسجيل
                        </span>
                      )}
                      {item.actionType === 'update' && (
                        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          تحديث
                        </span>
                      )}
                      {item.actionType === 'override' && (
                        <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          تجاوز يدوي
                        </span>
                      )}
                      {item.actionType === 'approve' && (
                        <span className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          اعتماد رسمي
                        </span>
                      )}
                      {item.actionType === 'delete' && (
                        <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          حذف
                        </span>
                      )}
                      {item.actionType === 'import' && (
                        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          استيراد بيانات
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-600">
                      {item.module === 'payroll' && 'الرواتب'}
                      {item.module === 'attendance' && 'الحضور والبصمة'}
                      {item.module === 'leaves' && 'الإجازات'}
                      {item.module === 'employees' && 'الموظفين'}
                      {item.module === 'settings' && 'الإعدادات'}
                      {item.module === 'documents' && 'الوثائق'}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      <p className="font-semibold text-slate-900">{item.action}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
