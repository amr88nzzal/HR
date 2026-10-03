import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Eye,
  Edit2,
  Trash2,
  Building,
  Briefcase,
  Phone,
  Mail,
  CreditCard,
  Calendar,
  ShieldCheck,
  Check,
  X,
  Fingerprint
} from 'lucide-react';
import { Employee, Branch, Department, JobTitle, EmploymentType } from '../../types/hrms';
import { formatMoney } from '../../utils/decimal';
import { storage } from '../../services/storage';

interface EmployeesViewProps {
  employees: Employee[];
  branches: Branch[];
  departments: Department[];
  jobTitles: JobTitle[];
  onRefresh: () => void;
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  employees,
  branches,
  departments,
  jobTitles,
  onRefresh
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);

  // Form state
  const initialFormState: Omit<Employee, 'id'> = {
    employeeNo: `EMP-${employees.length + 101}`,
    zktecoId: `${employees.length + 101}`,
    accountingRefNo: `ACC-${employees.length + 501}`,
    nationalId: '',
    firstNameAr: '',
    secondNameAr: '',
    thirdNameAr: '',
    lastNameAr: '',
    fullNameAr: '',
    fullNameEn: '',
    email: '',
    phone: '',
    gender: 'male',
    birthDate: '1990-01-01',
    nationality: 'أردني',
    maritalStatus: 'single',
    dependentsCount: 0,
    branchId: branches[0]?.id || 'br-amm',
    departmentId: departments[0]?.id || 'dept-it',
    jobTitleId: jobTitles[0]?.id || 'job-1',
    hireDate: '2024-01-01',
    employmentType: 'full_time',
    status: 'active',
    basicSalary: 600.000,
    housingAllowance: 50.000,
    transportAllowance: 50.000,
    otherAllowances: 0,
    bankName: 'البنك العربي',
    bankIban: 'JO',
    isSocialSecuritySubscribed: true,
    annualLeaveBalance: 14,
    sickLeaveBalance: 14
  };

  const [formData, setFormData] = useState<Omit<Employee, 'id'>>(initialFormState);
  const [formError, setFormError] = useState('');

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch =
      emp.fullNameAr.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.fullNameEn.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employeeNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.zktecoId.includes(searchTerm) ||
      emp.nationalId.includes(searchTerm) ||
      (emp.accountingRefNo && emp.accountingRefNo.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesDept = selectedDept === 'all' || emp.departmentId === selectedDept;
    const matchesBranch = selectedBranch === 'all' || emp.branchId === selectedBranch;

    return matchesSearch && matchesDept && matchesBranch;
  });

  const handleOpenAdd = () => {
    setFormData({
      ...initialFormState,
      employeeNo: `EMP-${employees.length + 101}`,
      zktecoId: `${employees.length + 101}`,
      accountingRefNo: `ACC-${employees.length + 501}`
    });
    setEditingEmployee(null);
    setFormError('');
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormData({ ...emp });
    setFormError('');
    setIsAddModalOpen(true);
  };

  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstNameAr || !formData.lastNameAr || !formData.employeeNo) {
      setFormError('يرجى ملء الحقول الإلزامية (الاسم ورقم الموظف)');
      return;
    }

    const computedFullNameAr = formData.fullNameAr || `${formData.firstNameAr} ${formData.secondNameAr} ${formData.thirdNameAr} ${formData.lastNameAr}`.replace(/\s+/g, ' ').trim();

    if (editingEmployee) {
      const updated: Employee = {
        ...editingEmployee,
        ...formData,
        fullNameAr: computedFullNameAr
      };
      storage.updateEmployee(updated);
      storage.logAction('تعديل بيانات موظف', 'update', 'employees', `تم تحديث بيانات الموظف ${computedFullNameAr}`);
    } else {
      const newEmp: Employee = {
        id: 'emp-' + Math.random().toString(36).substring(2, 9),
        ...formData,
        fullNameAr: computedFullNameAr
      };
      storage.addEmployee(newEmp);
      storage.logAction('إضافة موظف جديد', 'create', 'employees', `تم إضافة الموظف الجديد ${computedFullNameAr} برقم ${formData.employeeNo}`);
    }

    setIsAddModalOpen(false);
    onRefresh();
  };

  const handleDeleteEmployee = (emp: Employee) => {
    if (confirm(`هل أنت متأكد من حذف الموظف ${emp.fullNameAr} نهائياً؟`)) {
      storage.deleteEmployee(emp.id);
      storage.logAction('حذف موظف', 'delete', 'employees', `تم حذف الموظف ${emp.fullNameAr} من النظام`);
      onRefresh();
    }
  };

  return (
    <div className="space-y-5">
      {/* Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث بالاسم، رقم الموظف، الرقم الوطني، معرّف البصمة..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Filters and Add button */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">جميع الفروع</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.nameAr}</option>
            ))}
          </select>

          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">جميع الأقسام</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.nameAr}</option>
            ))}
          </select>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة موظف جديد</span>
          </button>
        </div>
      </div>

      {/* Employees Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-3.5 px-4">رقم الموظف</th>
                <th className="py-3.5 px-4">اسم الموظف</th>
                <th className="py-3.5 px-4">القسم والمسمى الوظيفي</th>
                <th className="py-3.5 px-4">الفرع</th>
                <th className="py-3.5 px-4">الراتب الأساسي</th>
                <th className="py-3.5 px-4">معرّف البصمة</th>
                <th className="py-3.5 px-4">المرجع المحاسبي</th>
                <th className="py-3.5 px-4">الحالة</th>
                <th className="py-3.5 px-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    لا يوجد موظفون مطابقون لشروط البحث المحددة.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => {
                  const dept = departments.find(d => d.id === emp.departmentId);
                  const branch = branches.find(b => b.id === emp.branchId);
                  const job = jobTitles.find(j => j.id === emp.jobTitleId);

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {emp.employeeNo}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs border border-slate-200">
                            {emp.fullNameAr.substring(0, 1)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{emp.fullNameAr}</p>
                            <p className="text-[10px] text-slate-400" dir="ltr">{emp.fullNameEn}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-800">{dept?.nameAr || '-'}</p>
                        <p className="text-[11px] text-slate-500">{job?.titleAr || '-'}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {branch?.nameAr || '-'}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-800">
                        {formatMoney(emp.basicSalary, 3)}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {emp.zktecoId}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {emp.accountingRefNo || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          نشط
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setViewingEmployee(emp)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                            title="عرض الملف الكامل"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(emp)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition cursor-pointer"
                            title="تعديل البيانات"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteEmployee(emp)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition cursor-pointer"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Full Employee Profile Modal */}
      {viewingEmployee && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-lg font-bold">
                  {viewingEmployee.fullNameAr.substring(0, 1)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{viewingEmployee.fullNameAr}</h3>
                  <p className="text-xs text-slate-500">{viewingEmployee.fullNameEn} • {viewingEmployee.employeeNo}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingEmployee(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-slate-400 text-[10px]">الرقم الوطني / الإقامة</p>
                <p className="font-bold text-slate-800 mt-0.5">{viewingEmployee.nationalId || 'غير محدد'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-slate-400 text-[10px]">معرّف جهاز البصمة (ZKTeco)</p>
                <p className="font-bold font-mono text-emerald-700 mt-0.5">{viewingEmployee.zktecoId}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-slate-400 text-[10px]">المرجع المحاسبي</p>
                <p className="font-bold font-mono text-blue-700 mt-0.5">{viewingEmployee.accountingRefNo || '-'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-slate-400 text-[10px]">الفرع</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {branches.find(b => b.id === viewingEmployee.branchId)?.nameAr}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-slate-400 text-[10px]">القسم</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {departments.find(d => d.id === viewingEmployee.departmentId)?.nameAr}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-slate-400 text-[10px]">المسمى الوظيفي</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {jobTitles.find(j => j.id === viewingEmployee.jobTitleId)?.titleAr}
                </p>
              </div>
            </div>

            {/* Financial Details */}
            <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-100 space-y-2">
              <h4 className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-emerald-700" />
                <span>البيانات المالية والبنكية</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                <div>
                  <span className="text-slate-500 text-[10px]">الراتب الأساسي:</span>
                  <p className="font-bold text-slate-800">{formatMoney(viewingEmployee.basicSalary, 3)}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px]">بدل سكن:</span>
                  <p className="font-semibold text-slate-800">{formatMoney(viewingEmployee.housingAllowance, 3)}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px]">بدل مواصلات:</span>
                  <p className="font-semibold text-slate-800">{formatMoney(viewingEmployee.transportAllowance, 3)}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px]">إجمالي الراتب التعاقدي:</span>
                  <p className="font-bold text-emerald-800">
                    {formatMoney(
                      viewingEmployee.basicSalary +
                        viewingEmployee.housingAllowance +
                        viewingEmployee.transportAllowance +
                        viewingEmployee.otherAllowances,
                      3
                    )}
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-emerald-200/60 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-600 gap-1">
                <span>البنك: {viewingEmployee.bankName}</span>
                <span className="font-mono text-[11px] text-slate-800" dir="ltr">{viewingEmployee.bankIban}</span>
              </div>
            </div>

            {/* Leave Balances */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <span className="text-slate-500">رصيد الإجازات السنوية المتاح</span>
                <p className="text-lg font-bold text-emerald-700 mt-0.5">{viewingEmployee.annualLeaveBalance} يوم</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <span className="text-slate-500">رصيد الإجازات المرضية المتاح</span>
                <p className="text-lg font-bold text-blue-700 mt-0.5">{viewingEmployee.sickLeaveBalance} يوم</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewingEmployee(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form
            onSubmit={handleSaveEmployee}
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingEmployee ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد إلى السجل'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {formError}
              </div>
            )}

            {/* Section 1: Basic & Personal */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-1">
                1. البيانات الشخصية
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">الاسم الأول *</label>
                  <input
                    type="text"
                    required
                    value={formData.firstNameAr}
                    onChange={(e) => setFormData({ ...formData, firstNameAr: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">اسم الأب</label>
                  <input
                    type="text"
                    value={formData.secondNameAr}
                    onChange={(e) => setFormData({ ...formData, secondNameAr: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">اسم الجد</label>
                  <input
                    type="text"
                    value={formData.thirdNameAr}
                    onChange={(e) => setFormData({ ...formData, thirdNameAr: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">اسم العائلة *</label>
                  <input
                    type="text"
                    required
                    value={formData.lastNameAr}
                    onChange={(e) => setFormData({ ...formData, lastNameAr: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">الرقم الوطني / الإقامة *</label>
                  <input
                    type="text"
                    required
                    value={formData.nationalId}
                    onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">الاسم بالإنجليزية</label>
                  <input
                    type="text"
                    value={formData.fullNameEn}
                    onChange={(e) => setFormData({ ...formData, fullNameEn: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">رقم الهاتف</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Employment & Devices */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-1">
                2. البيانات الوظيفية وأجهزة البصمة والمحاسبة
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">رقم الموظف *</label>
                  <input
                    type="text"
                    required
                    value={formData.employeeNo}
                    onChange={(e) => setFormData({ ...formData, employeeNo: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold text-emerald-800">معرّف جهاز البصمة ZKTeco *</label>
                  <input
                    type="text"
                    required
                    value={formData.zktecoId}
                    onChange={(e) => setFormData({ ...formData, zktecoId: e.target.value })}
                    placeholder="Emp_ID في جهاز البصمة"
                    className="w-full bg-emerald-50/50 border border-emerald-300 rounded-lg p-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">المرجع المحاسبي</label>
                  <input
                    type="text"
                    value={formData.accountingRefNo}
                    onChange={(e) => setFormData({ ...formData, accountingRefNo: e.target.value })}
                    placeholder="رقم الحساب في برنامج المحاسبة"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">الفرع</label>
                  <select
                    value={formData.branchId}
                    onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.nameAr}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">القسم</label>
                  <select
                    value={formData.departmentId}
                    onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.nameAr}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">المسمى الوظيفي</label>
                  <select
                    value={formData.jobTitleId}
                    onChange={(e) => setFormData({ ...formData, jobTitleId: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    {jobTitles.map(j => (
                      <option key={j.id} value={j.id}>{j.titleAr}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 3: Salary and Jordanian Social Security */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-1">
                3. الراتب والبدلات والضمان الاجتماعي (د.أ - JOD)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">الراتب الأساسي الشهري (د.أ) *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={formData.basicSalary}
                    onChange={(e) => setFormData({ ...formData, basicSalary: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-bold focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">بدل السكن (د.أ)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={formData.housingAllowance}
                    onChange={(e) => setFormData({ ...formData, housingAllowance: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">بدل الانتقال (د.أ)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={formData.transportAllowance}
                    onChange={(e) => setFormData({ ...formData, transportAllowance: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">اسم البنك</label>
                  <input
                    type="text"
                    value={formData.bankName}
                    onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">رقم الآيبان (IBAN الأردني: JO...)</label>
                  <input
                    type="text"
                    value={formData.bankIban}
                    onChange={(e) => setFormData({ ...formData, bankIban: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 text-xs">
                <input
                  type="checkbox"
                  id="ss_sub"
                  checked={formData.isSocialSecuritySubscribed}
                  onChange={(e) => setFormData({ ...formData, isSocialSecuritySubscribed: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="ss_sub" className="text-slate-700 font-medium">
                  خاضع للضمان الاجتماعي الأردني (اقتطاع 7.5% من الموظف + 14.25% من المنشأة)
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                {editingEmployee ? 'حفظ التعديلات' : 'إضافة الموظف الآن'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
