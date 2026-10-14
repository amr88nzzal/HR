export type TemplateRow = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  language: 'ar' | 'en';
  format: 'html' | 'docx';
  category: string;
  isActive: boolean;
  version: number;
  activeVersionId: string | null;
  activeVersionNo: number | null;
};

export type VersionRow = {
  id: string;
  versionNo: number;
  bodyHtml: string | null;
  docxFileId: string | null;
  status: 'draft' | 'active' | 'archived';
  note: string | null;
  createdAt: string;
};

export type TemplateDetail = TemplateRow & { versions: VersionRow[] };

export type IssuedRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  templateId: string;
  templateNameAr: string;
  templateVersionNo: number;
  language: 'ar' | 'en';
  title: string;
  docNumber: string | null;
  docxFileId: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type VariableDef = {
  key: string;
  group: string;
  kind: string;
  labelAr: string;
  labelEn: string;
};

export const DEFAULT_BODY_AR =
  '<div style="text-align:center"><h1>شهادة عمل</h1></div>\n<p>تشهد {{company.name}} بأن السيد/ة {{employee.fullName}} (الرقم الوظيفي {{employee.employeeNo}}) يعمل لديها بوظيفة {{job.title}} في {{job.department}} منذ تاريخ {{employee.hireDate}}، وما زال على رأس عمله حتى تاريخه.</p>\n<p>أُعطيت هذه الشهادة بناءً على طلبه دون أدنى مسؤولية على الشركة.</p>\n<p>التاريخ: {{document.today}}</p>';
export const DEFAULT_BODY_EN =
  '<div style="text-align:center"><h1>Employment Certificate</h1></div>\n<p>This is to certify that {{employee.fullName}} (Employee No. {{employee.employeeNo}}) has been employed by {{company.name}} as {{job.title}} in {{job.department}} since {{employee.hireDate}}, and remains in service to date.</p>\n<p>This certificate is issued upon the employee\'s request without any liability on the company.</p>\n<p>Date: {{document.today}}</p>';
