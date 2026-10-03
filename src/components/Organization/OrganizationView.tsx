import React, { useState } from 'react';
import {
  Network,
  Building2,
  MapPin,
  Briefcase,
  PlusCircle,
  Edit2,
  Trash2,
  Check,
  X,
  Layers,
  Users,
  Shield,
  Phone,
  Mail,
  Building
} from 'lucide-react';
import { Company, Branch, Department, JobTitle, Employee } from '../../types/hrms';
import { storage } from '../../services/storage';

interface OrganizationViewProps {
  company: Company;
  branches: Branch[];
  departments: Department[];
  jobTitles: JobTitle[];
  employees: Employee[];
  isDark?: boolean;
  onRefresh: () => void;
}

export const OrganizationView: React.FC<OrganizationViewProps> = ({
  company,
  branches,
  departments,
  jobTitles,
  employees,
  isDark = false,
  onRefresh
}) => {
  const [activeTab, setActiveTab] = useState<'companies' | 'branches' | 'departments' | 'jobs'>('companies');

  const companies = storage.getCompanies();

  // Modals state
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState<Partial<Company>>({});

  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchForm, setBranchForm] = useState<Partial<Branch>>({});

  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState<Partial<Department>>({});

  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JobTitle | null>(null);
  const [jobForm, setJobForm] = useState<Partial<JobTitle>>({});

  // 1. Company Handlers
  const handleOpenAddCompany = () => {
    setEditingCompany(null);
    setCompanyForm({
      id: 'comp-' + Math.random().toString(36).substring(2, 7),
      nameAr: '',
      nameEn: '',
      crNumber: '',
      taxNumber: '',
      socialSecurityNumber: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      country: 'المملكة الأردنية الهاشمية',
      currency: 'JOD',
      currencySymbol: 'د.أ',
      currencyDecimals: 3
    });
    setIsCompanyModalOpen(true);
  };

  const handleSaveCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm.nameAr) return;

    const list = storage.getCompanies();
    if (editingCompany) {
      const updated = list.map(c => c.id === editingCompany.id ? ({ ...c, ...companyForm } as Company) : c);
      storage.saveCompanies(updated);
      storage.logAction('تعديل بيانات شركة', 'update', 'settings', `تم تحديث بيانات الشركة ${companyForm.nameAr}`);
    } else {
      const newComp = companyForm as Company;
      storage.saveCompanies([...list, newComp]);
      storage.logAction('إنشاء شركة جديدة', 'create', 'settings', `تمت إضافة شركة جديدة: ${companyForm.nameAr}`);
    }
    setIsCompanyModalOpen(false);
    onRefresh();
  };

  // 2. Branch Handlers
  const handleOpenAddBranch = () => {
    setEditingBranch(null);
    setBranchForm({
      id: 'br-' + Math.random().toString(36).substring(2, 7),
      companyId: companies[0]?.id || 'comp-01',
      nameAr: '',
      nameEn: '',
      city: 'عمان',
      address: '',
      phone: '',
      isMain: false
    });
    setIsBranchModalOpen(true);
  };

  const handleSaveBranch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchForm.nameAr) return;

    const list = storage.getBranches();
    if (editingBranch) {
      const updated = list.map(b => b.id === editingBranch.id ? ({ ...b, ...branchForm } as Branch) : b);
      storage.saveBranches(updated);
      storage.logAction('تعديل فرع', 'update', 'settings', `تم تحديث بيانات الفرع: ${branchForm.nameAr}`);
    } else {
      const newBr = branchForm as Branch;
      storage.saveBranches([...list, newBr]);
      storage.logAction('إنشاء فرع جديد', 'create', 'settings', `تم إنشاء فرع جديد: ${branchForm.nameAr}`);
    }
    setIsBranchModalOpen(false);
    onRefresh();
  };

  // 3. Department Handlers
  const handleOpenAddDept = () => {
    setEditingDept(null);
    setDeptForm({
      id: 'dept-' + Math.random().toString(36).substring(2, 7),
      branchId: branches[0]?.id || 'br-amm',
      nameAr: '',
      nameEn: '',
      code: `DEPT-${departments.length + 1}`,
      costCenterCode: `CC-10${departments.length + 1}`
    });
    setIsDeptModalOpen(true);
  };

  const handleSaveDept = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.nameAr) return;

    const list = storage.getDepartments();
    if (editingDept) {
      const updated = list.map(d => d.id === editingDept.id ? ({ ...d, ...deptForm } as Department) : d);
      storage.saveDepartments(updated);
      storage.logAction('تعديل قسم', 'update', 'settings', `تم تحديث بيانات قسم: ${deptForm.nameAr}`);
    } else {
      const newDept = deptForm as Department;
      storage.saveDepartments([...list, newDept]);
      storage.logAction('إنشاء قسم جديد', 'create', 'settings', `تم إنشاء قسم جديد: ${deptForm.nameAr}`);
    }
    setIsDeptModalOpen(false);
    onRefresh();
  };

  // 4. Job Title Handlers
  const handleOpenAddJob = () => {
    setEditingJob(null);
    setJobForm({
      id: 'job-' + Math.random().toString(36).substring(2, 7),
      departmentId: departments[0]?.id || 'dept-it',
      titleAr: '',
      titleEn: '',
      grade: 'B1'
    });
    setIsJobModalOpen(true);
  };

  const handleSaveJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobForm.titleAr) return;

    const list = storage.getJobTitles();
    if (editingJob) {
      const updated = list.map(j => j.id === editingJob.id ? ({ ...j, ...jobForm } as JobTitle) : j);
      storage.saveJobTitles(updated);
      storage.logAction('تعديل مسمى وظيفي', 'update', 'settings', `تم تحديث المسمى الوظيفي: ${jobForm.titleAr}`);
    } else {
      const newJob = jobForm as JobTitle;
      storage.saveJobTitles([...list, newJob]);
      storage.logAction('إنشاء مسمى وظيفي جديد', 'create', 'settings', `تمت إضافة دور وظيفي جديد: ${jobForm.titleAr}`);
    }
    setIsJobModalOpen(false);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div>
          <h3 className={`text-base font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            <Network className="w-5 h-5 text-emerald-600" />
            <span>إدارة الهيكل التنظيمي والشركات والفروع والأدوار الوظيفية</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            إضافة وإدارة الشركات الشقيقة، الفروع في المحافظات، الأقسام ومراكز التكلفة، والأدوار والمسميات الوظيفية.
          </p>
        </div>

        {/* Action Button depending on active tab */}
        {activeTab === 'companies' && (
          <button
            onClick={handleOpenAddCompany}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto"
          >
            <PlusCircle className="w-4 h-4" />
            <span>إنشاء شركة جديدة</span>
          </button>
        )}
        {activeTab === 'branches' && (
          <button
            onClick={handleOpenAddBranch}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto"
          >
            <PlusCircle className="w-4 h-4" />
            <span>إضافة فرع جديد</span>
          </button>
        )}
        {activeTab === 'departments' && (
          <button
            onClick={handleOpenAddDept}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto"
          >
            <PlusCircle className="w-4 h-4" />
            <span>إنشاء قسم جديد</span>
          </button>
        )}
        {activeTab === 'jobs' && (
          <button
            onClick={handleOpenAddJob}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs self-start md:self-auto"
          >
            <PlusCircle className="w-4 h-4" />
            <span>إضافة مسمى / دور وظيفي</span>
          </button>
        )}
      </div>

      {/* Tabs Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('companies')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'companies' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4 text-emerald-600" />
          <span>الشركات والمنشآت ({companies.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('branches')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'branches' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <MapPin className="w-4 h-4 text-blue-600" />
          <span>الفروع الجغرافية ({branches.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('departments')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'departments' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4 text-purple-600" />
          <span>الأقسام ومراكز التكلفة ({departments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('jobs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeTab === 'jobs' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Briefcase className="w-4 h-4 text-amber-600" />
          <span>المسميات والأدوار الوظيفية ({jobTitles.length})</span>
        </button>
      </div>

      {/* TAB 1: COMPANIES */}
      {activeTab === 'companies' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {companies.map(comp => (
            <div key={comp.id} className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-3`}>
              <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 flex items-center justify-center font-bold">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>{comp.nameAr}</h4>
                    <p className="text-[11px] text-slate-400 font-mono" dir="ltr">{comp.nameEn}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditingCompany(comp);
                    setCompanyForm({ ...comp });
                    setIsCompanyModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={`p-2 rounded-lg ${isDark ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
                  <span className="text-[10px] text-slate-400 block">السجل التجاري:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{comp.crNumber || '-'}</span>
                </div>
                <div className={`p-2 rounded-lg ${isDark ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
                  <span className="text-[10px] text-slate-400 block">الرقم الضريبي:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{comp.taxNumber || '-'}</span>
                </div>
                <div className={`p-2 rounded-lg ${isDark ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
                  <span className="text-[10px] text-slate-400 block">رقم الضمان:</span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{comp.socialSecurityNumber || '-'}</span>
                </div>
                <div className={`p-2 rounded-lg ${isDark ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
                  <span className="text-[10px] text-slate-400 block">العملة:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{comp.currency} ({comp.currencySymbol})</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 truncate">{comp.address}</p>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: BRANCHES */}
      {activeTab === 'branches' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map(br => (
            <div key={br.id} className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-3`}>
              <div className="flex items-center justify-between border-b pb-2 border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  <h4 className={`font-bold text-xs ${isDark ? 'text-white' : 'text-slate-900'}`}>{br.nameAr}</h4>
                </div>
                <div className="flex items-center gap-1">
                  {br.isMain && (
                    <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">الرئيسي</span>
                  )}
                  <button
                    onClick={() => {
                      setEditingBranch(br);
                      setBranchForm({ ...br });
                      setIsBranchModalOpen(true);
                    }}
                    className="p-1 text-slate-400 hover:text-blue-600 cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="text-xs space-y-1 text-slate-500">
                <p>المدينة: <strong className="text-slate-800 dark:text-slate-200">{br.city}</strong></p>
                <p>العنوان: {br.address}</p>
                <p className="font-mono text-[10px]" dir="ltr">{br.phone}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: DEPARTMENTS */}
      {activeTab === 'departments' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map(dept => {
            const b = branches.find(br => br.id === dept.branchId);
            const manager = employees.find(e => e.id === dept.managerId);
            return (
              <div key={dept.id} className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-3`}>
                <div className="flex items-center justify-between border-b pb-2 border-slate-100 dark:border-slate-700">
                  <h4 className={`font-bold text-xs ${isDark ? 'text-white' : 'text-slate-900'}`}>{dept.nameAr}</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 font-bold">{dept.code}</span>
                    <button
                      onClick={() => {
                        setEditingDept(dept);
                        setDeptForm({ ...dept });
                        setIsDeptModalOpen(true);
                      }}
                      className="p-1 text-slate-400 hover:text-purple-600 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-xs space-y-1 text-slate-500">
                  <p>الفرع: <strong className="text-slate-800 dark:text-slate-200">{b?.nameAr || '-'}</strong></p>
                  <p>مركز التكلفة: <strong className="font-mono text-purple-700 dark:text-purple-400">{dept.costCenterCode}</strong></p>
                  <p>مدير القسم: {manager?.fullNameAr || 'غير محدد'}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 4: JOB TITLES & ROLES */}
      {activeTab === 'jobs' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobTitles.map(job => {
            const d = departments.find(dept => dept.id === job.departmentId);
            return (
              <div key={job.id} className={`p-5 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} shadow-xs space-y-2`}>
                <div className="flex items-center justify-between border-b pb-2 border-slate-100 dark:border-slate-700">
                  <h4 className={`font-bold text-xs ${isDark ? 'text-white' : 'text-slate-900'}`}>{job.titleAr}</h4>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded font-bold">{job.grade}</span>
                    <button
                      onClick={() => {
                        setEditingJob(job);
                        setJobForm({ ...job });
                        setIsJobModalOpen(true);
                      }}
                      className="p-1 text-slate-400 hover:text-amber-600 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 font-mono" dir="ltr">{job.titleEn}</p>
                <p className="text-xs text-slate-500">القسم: <strong className="text-slate-800 dark:text-slate-200">{d?.nameAr || '-'}</strong></p>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: ADD/EDIT COMPANY */}
      {isCompanyModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form onSubmit={handleSaveCompany} className={`rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold">{editingCompany ? 'تعديل بيانات الشركة' : 'إنشاء شركة / منشأة جديدة'}</h3>
              <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">اسم الشركة بالعربية *</label>
                  <input type="text" required value={companyForm.nameAr || ''} onChange={(e) => setCompanyForm({ ...companyForm, nameAr: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold" />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">اسم الشركة بالإنجليزية</label>
                  <input type="text" value={companyForm.nameEn || ''} onChange={(e) => setCompanyForm({ ...companyForm, nameEn: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" dir="ltr" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">السجل التجاري</label>
                  <input type="text" value={companyForm.crNumber || ''} onChange={(e) => setCompanyForm({ ...companyForm, crNumber: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">الرقم الضريبي</label>
                  <input type="text" value={companyForm.taxNumber || ''} onChange={(e) => setCompanyForm({ ...companyForm, taxNumber: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">رقم الضمان</label>
                  <input type="text" value={companyForm.socialSecurityNumber || ''} onChange={(e) => setCompanyForm({ ...companyForm, socialSecurityNumber: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">العنوان التفصيلي</label>
                <input type="text" value={companyForm.address || ''} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="px-4 py-2 border rounded-xl text-xs cursor-pointer">إلغاء</button>
              <button type="submit" className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer">حفظ بيانات الشركة</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: ADD/EDIT BRANCH */}
      {isBranchModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form onSubmit={handleSaveBranch} className={`rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold">{editingBranch ? 'تعديل بيانات الفرع' : 'إضافة فرع جديد'}</h3>
              <button type="button" onClick={() => setIsBranchModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">الشركة المالكة للفرع *</label>
                <select value={branchForm.companyId} onChange={(e) => setBranchForm({ ...branchForm, companyId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold">
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.nameAr}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">اسم الفرع بالعربية *</label>
                  <input type="text" required value={branchForm.nameAr || ''} onChange={(e) => setBranchForm({ ...branchForm, nameAr: e.target.value })} placeholder="مثال: فرع الزرقاء" className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold" />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">المدينة *</label>
                  <input type="text" required value={branchForm.city || ''} onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })} placeholder="عمان / إربد / الزرقاء" className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2" />
                </div>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">العنوان التفصيلي</label>
                <input type="text" value={branchForm.address || ''} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">رقم الهاتف</label>
                <input type="text" value={branchForm.phone || ''} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input type="checkbox" id="is_main_br" checked={branchForm.isMain || false} onChange={(e) => setBranchForm({ ...branchForm, isMain: e.target.checked })} className="rounded text-emerald-600" />
                <label htmlFor="is_main_br" className="text-slate-600 dark:text-slate-300 font-semibold">هل هذا هو الفرع الرئيسي للمنشأة؟</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setIsBranchModalOpen(false)} className="px-4 py-2 border rounded-xl text-xs cursor-pointer">إلغاء</button>
              <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer">حفظ الفرع</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: ADD/EDIT DEPARTMENT */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form onSubmit={handleSaveDept} className={`rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold">{editingDept ? 'تعديل بيانات القسم' : 'إنشاء قسم تنظيمي جديد'}</h3>
              <button type="button" onClick={() => setIsDeptModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">الفرع التابع له القسم *</label>
                <select value={deptForm.branchId} onChange={(e) => setDeptForm({ ...deptForm, branchId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold">
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.nameAr}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">اسم القسم بالعربية *</label>
                <input type="text" required value={deptForm.nameAr || ''} onChange={(e) => setDeptForm({ ...deptForm, nameAr: e.target.value })} placeholder="مثال: إدارة المشتريات واللوجستيات" className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">كود القسم</label>
                  <input type="text" value={deptForm.code || ''} onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">مركز التكلفة</label>
                  <input type="text" value={deptForm.costCenterCode || ''} onChange={(e) => setDeptForm({ ...deptForm, costCenterCode: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">مدير القسم المسؤول</label>
                <select value={deptForm.managerId || ''} onChange={(e) => setDeptForm({ ...deptForm, managerId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                  <option value="">-- لم يتم تعيين مدير بعد --</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.fullNameAr} ({e.employeeNo})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setIsDeptModalOpen(false)} className="px-4 py-2 border rounded-xl text-xs cursor-pointer">إلغاء</button>
              <button type="submit" className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer">حفظ القسم</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: ADD/EDIT JOB TITLE */}
      {isJobModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <form onSubmit={handleSaveJob} className={`rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold">{editingJob ? 'تعديل المسمى الوظيفي' : 'إضافة دور ومسمى وظيفي جديد'}</h3>
              <button type="button" onClick={() => setIsJobModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">القسم التابع له المسمى *</label>
                <select value={jobForm.departmentId} onChange={(e) => setJobForm({ ...jobForm, departmentId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold">
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.nameAr}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">المسمى الوظيفي بالعربية *</label>
                <input type="text" required value={jobForm.titleAr || ''} onChange={(e) => setJobForm({ ...jobForm, titleAr: e.target.value })} placeholder="مثال: مهندس شبكات وأمن معلومات أول" className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold" />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">المسمى الوظيفي بالإنجليزية</label>
                <input type="text" value={jobForm.titleEn || ''} onChange={(e) => setJobForm({ ...jobForm, titleEn: e.target.value })} placeholder="Senior Network & Cyber Security Engineer" className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-mono" dir="ltr" />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">الدرجة الوظيفية (Job Grade):</label>
                <select value={jobForm.grade || 'B1'} onChange={(e) => setJobForm({ ...jobForm, grade: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 font-bold">
                  <option value="M1">M1 (إدارة عليا / مدراء عموم)</option>
                  <option value="M2">M2 (إدارة متوسطة / مدراء أقسام)</option>
                  <option value="A1">A1 (أخصائي رئيسي / أول)</option>
                  <option value="B1">B1 (مهني / أخصائي)</option>
                  <option value="B2">B2 (مبتدئ / مساعد)</option>
                  <option value="C1">C1 (دعم فني / لوجستي / خدمات)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setIsJobModalOpen(false)} className="px-4 py-2 border rounded-xl text-xs cursor-pointer">إلغاء</button>
              <button type="submit" className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer">حفظ المسمى الوظيفي</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
