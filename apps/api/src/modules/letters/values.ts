import { sql } from 'kysely';
import type { LetterLanguage } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

const GENDER = { male: { ar: 'ذكر', en: 'Male' }, female: { ar: 'أنثى', en: 'Female' } } as const;
const EMPLOYMENT = {
  full_time: { ar: 'دوام كامل', en: 'Full time' },
  part_time: { ar: 'دوام جزئي', en: 'Part time' },
  contractor: { ar: 'متعاقد', en: 'Contractor' },
  intern: { ar: 'متدرب', en: 'Intern' },
} as Record<string, { ar: string; en: string }>;

type Row = Record<string, string | null>;

/** قيم المتغيرات لموظف بلغة القالب (القيم الناقصة null فتظهر «—»). */
export const loadLetterValues = async (
  ctx: Ctx,
  employeeId: string,
  language: LetterLanguage,
): Promise<Record<string, string | null>> => {
  const pick = (ar: string | null, en: string | null) => (language === 'en' ? en || ar : ar || en);
  const { rows } = await sql<Row>`
    select e.full_name_ar, e.full_name_en, e.employee_no, e.nationality, e.gender,
           e.birth_date::text as birth_date, e.first_hire_date::text as hire_date,
           b.name_ar as branch_ar, b.name_en as branch_en,
           d.name_ar as dept_ar, d.name_en as dept_en,
           t.name_ar as title_ar, t.name_en as title_en,
           g.name_ar as grade_ar, g.name_en as grade_en,
           m.full_name_ar as mgr_ar, m.full_name_en as mgr_en,
           cur.employment_type,
           c.start_date::text as contract_start, c.end_date::text as contract_end,
           co.name_ar as co_ar, co.name_en as co_en,
           company_today(e.company_id)::text as today
      from employees e
      join companies co on co.id = e.company_id
      left join lateral (
        select * from employments x where x.employee_id = e.id
           and x.valid_from <= company_today(e.company_id)
           and (x.valid_to is null or x.valid_to >= company_today(e.company_id))
         order by x.valid_from desc limit 1) cur on true
      left join branches b on b.id = cur.branch_id
      left join departments d on d.id = cur.department_id
      left join job_titles t on t.id = cur.job_title_id
      left join job_grades g on g.id = cur.job_grade_id
      left join employees m on m.id = cur.manager_employee_id
      left join lateral (
        select * from contracts k where k.employee_id = e.id and k.status = 'active'
         order by k.start_date desc limit 1) c on true
     where e.company_id = ${ctx.companyId} and e.id = ${employeeId}`.execute(ctx.trx);
  const r = rows[0];
  if (!r) throw new AppError('INVALID_REFERENCE', 400, 'الموظف غير موجود');
  const issuer = ctx.userId
    ? (
        await ctx.trx
          .selectFrom('users')
          .select('displayName')
          .where('id', '=', ctx.userId)
          .executeTakeFirst()
      )?.displayName
    : null;
  const gender = r['gender'] ? GENDER[r['gender'] as 'male' | 'female']?.[language] : null;
  const emp = r['employmentType'] ? EMPLOYMENT[r['employmentType']]?.[language] : null;
  return {
    'employee.fullName': pick(r['fullNameAr'] ?? null, r['fullNameEn'] ?? null),
    'employee.fullNameAr': r['fullNameAr'] ?? null,
    'employee.fullNameEn': r['fullNameEn'] ?? null,
    'employee.employeeNo': r['employeeNo'] ?? null,
    'employee.nationality': r['nationality'] ?? null,
    'employee.gender': gender ?? null,
    'employee.birthDate': r['birthDate'] ?? null,
    'employee.hireDate': r['hireDate'] ?? null,
    'job.title': pick(r['titleAr'] ?? null, r['titleEn'] ?? null),
    'job.department': pick(r['deptAr'] ?? null, r['deptEn'] ?? null),
    'job.branch': pick(r['branchAr'] ?? null, r['branchEn'] ?? null),
    'job.grade': pick(r['gradeAr'] ?? null, r['gradeEn'] ?? null),
    'job.manager': pick(r['mgrAr'] ?? null, r['mgrEn'] ?? null),
    'job.employmentType': emp ?? r['employmentType'] ?? null,
    'contract.startDate': r['contractStart'] ?? null,
    'contract.endDate': r['contractEnd'] ?? null,
    'company.name': pick(r['coAr'] ?? null, r['coEn'] ?? null),
    'document.today': r['today'] ?? null,
    'document.issuedBy': issuer ?? null,
  };
};
